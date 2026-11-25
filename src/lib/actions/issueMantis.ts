"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { decryptSecret, encryptSecret } from "@/lib/secretBox";
import { issueUrl, normalizeBaseUrl, type MantisProject, type MantisUser } from "@/lib/mantis";
import { ENUM_CONFIG_OPTIONS, enumsFromMantis, type MantisEnums } from "@/lib/mantisMapping";
import { MantisError, fetchMantisProjects, mantisGet, type SyncSummary } from "@/lib/mantisSync";
import { parseIssueMapping, validateIssueMapping, type IssueMantisMapping } from "@/lib/issueMantis";
import { requireIssueActor } from "@/lib/issueServer";
import { canEditHandlingFields, canManageIssues } from "@/lib/issueAccess";
import { createCaseInMantis, linkCaseToMantis, loadConnection, syncIssueMantis, syncOneCaseFromMantis } from "@/lib/issueMantisServer";

/**
 * ISSUE TRACKER 與 MantisBT 的連線設定(系統管理員)與案件上的 Mantis 動作(建立到 Mantis、連結既有單號、立即同步這筆)。
 * API token 加密後存放,不會回傳給畫面。
 */

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足:只有系統管理員可以設定 Mantis 連線");
  return session;
}

export type IssueMantisConnectionRow = {
  baseUrl: string;
  projectId: number;
  projectName: string;
  enabled: boolean;
  /** 已經連到 Mantis 的案件數。 */
  linkedCount: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  summary: SyncSummary | null;
  writeBack: IssueMantisMapping["writeBack"];
};

export async function getIssueMantisConnection(): Promise<IssueMantisConnectionRow | null> {
  await requireAdmin();
  const [conn, linkedCount] = await Promise.all([loadConnection(), prisma.issueCase.count({ where: { mantisId: { not: null }, deletedAt: null } })]);
  if (!conn) return null;
  return {
    baseUrl: conn.baseUrl,
    projectId: conn.projectId,
    projectName: conn.projectName,
    enabled: conn.enabled,
    linkedCount,
    lastSyncAt: conn.lastSyncAt?.toISOString() ?? null,
    lastSyncError: conn.lastSyncError,
    summary: (conn.lastSyncSummary as SyncSummary | null) ?? null,
    writeBack: parseIssueMapping(conn.mapping).writeBack,
  };
}

/** 用網址與 token 讀出可選的 Mantis 專案。token 留白代表用已經存著的那一個。 */
export async function loadIssueMantisProjects(input: { baseUrl: string; token: string }): Promise<{ projects: MantisProject[]; baseUrl: string } | { error: string }> {
  await requireAdmin();
  const normalized = normalizeBaseUrl(input.baseUrl);
  if ("error" in normalized) return normalized;
  let token = input.token.trim();
  if (!token) {
    const stored = await loadConnection();
    token = stored ? (decryptSecret(stored.tokenEnc) ?? "") : "";
  }
  if (!token) return { error: "請輸入 Mantis 的 API token" };
  try {
    const projects = await fetchMantisProjects(normalized.url, token);
    if (projects.length === 0) return { error: "這個 token 看不到任何 Mantis 專案" };
    return { projects, baseUrl: normalized.url };
  } catch (err) {
    return { error: err instanceof MantisError ? err.message : "讀取 Mantis 專案失敗" };
  }
}

export async function saveIssueMantisConnection(input: {
  baseUrl: string;
  /** 留白 = 沿用已經存著的 token。 */
  token: string;
  projectId: number;
  projectName: string;
  enabled: boolean;
}): Promise<{ error?: string; sync?: { ok: true; summary: SyncSummary } | { ok: false; error: string } }> {
  const session = await requireAdmin();
  const normalized = normalizeBaseUrl(input.baseUrl);
  if ("error" in normalized) return normalized;
  if (!Number.isInteger(input.projectId) || input.projectId <= 0) return { error: "請選擇 Mantis 專案" };
  const existing = await loadConnection();
  const token = input.token.trim();
  if (!token && !existing) return { error: "請輸入 Mantis 的 API token" };
  const data = {
    baseUrl: normalized.url,
    projectId: input.projectId,
    projectName: input.projectName.trim() || `專案 ${input.projectId}`,
    tokenEnc: token ? encryptSecret(token) : existing!.tokenEnc,
    enabled: input.enabled,
  };
  // 換了 Mantis 專案(或網站):舊專案的單號對不上新的,案件上的連結要清掉,不然寫回會打到別的單。
  const switched = existing && (existing.baseUrl !== data.baseUrl || existing.projectId !== data.projectId);
  await prisma.$transaction([
    ...(switched ? [prisma.issueCase.updateMany({ where: { mantisId: { not: null } }, data: { mantisId: null, mantisUpdatedAt: null } })] : []),
    prisma.issueMantisConnection.upsert({ where: { id: "global" }, create: { id: "global", ...data }, update: { ...data, ...(switched ? { users: [] } : {}) } }),
  ]);
  await logAudit("SETTINGS", session.userId, `${existing ? "更新" : "建立"} ISSUE TRACKER 與 Mantis 的連線:${data.baseUrl} 專案「${data.projectName}」${data.enabled ? "" : "(停用)"}${switched ? "(換了專案,案件上的 Mantis 連結已清除)" : ""}`);
  // 存好馬上同步一次,管理者當場就看得到結果(失敗也看得到原因)。
  const sync = data.enabled ? await syncIssueMantis() : undefined;
  revalidatePath("/issues", "layout");
  return { sync };
}

export async function setIssueMantisEnabled(enabled: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin();
  if (!(await loadConnection())) return { error: "還沒有設定 Mantis 連線" };
  await prisma.issueMantisConnection.update({ where: { id: "global" }, data: { enabled } });
  await logAudit("SETTINGS", session.userId, `${enabled ? "啟用" : "停用"} ISSUE TRACKER 與 Mantis 的同步`);
  revalidatePath("/issues", "layout");
  return {};
}

/** 設定畫面「欄位對應與寫回」要用的資料。 */
export async function getIssueMantisMapping(): Promise<
  | {
      mapping: IssueMantisMapping;
      mantisUsers: MantisUser[];
      localUsers: { id: string; name: string; email: string }[];
      products: { id: string; name: string }[];
    }
  | { error: string }
> {
  await requireAdmin();
  const conn = await loadConnection();
  if (!conn) return { error: "還沒有設定 Mantis 連線" };
  const [localUsers, products] = await Promise.all([
    prisma.user.findMany({ where: { OR: [{ role: "ADMIN" }, { issueRole: { not: null } }] }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    prisma.issueOption.findMany({ where: { kind: "PRODUCT" }, select: { id: true, name: true }, orderBy: [{ order: "asc" }, { name: "asc" }] }),
  ]);
  return { mapping: parseIssueMapping(conn.mapping), mantisUsers: Array.isArray(conn.users) ? (conn.users as MantisUser[]) : [], localUsers, products };
}

/** 從 Mantis 讀它的狀態、嚴重度、優先權、resolution 列舉值(給對應表的下拉選單)。讀不到就用 Mantis 內建的,並說明。 */
export async function loadIssueMantisEnums(): Promise<{ enums: MantisEnums; fromMantis: boolean; note?: string } | { error: string }> {
  await requireAdmin();
  const conn = await loadConnection();
  if (!conn) return { error: "還沒有設定 Mantis 連線" };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return { error: "API token 解不開,請重新輸入 token" };
  const query = ENUM_CONFIG_OPTIONS.map((o) => `option[]=${o}`).join("&");
  try {
    const config = await mantisGet(conn.baseUrl, token, `config?${query}`);
    const lang = await mantisGet(conn.baseUrl, token, `lang?${ENUM_CONFIG_OPTIONS.map((o) => `string[]=${o}`).join("&")}`).catch(() => null);
    return { enums: enumsFromMantis(config, lang), fromMantis: true };
  } catch (err) {
    return { enums: enumsFromMantis(null), fromMantis: false, note: `${err instanceof MantisError ? err.message : "讀取失敗"}——先用 Mantis 內建的列舉值;你的 Mantis 有改過的話,可能對不上。` };
  }
}

/** 這個 Mantis 專案的分類(建立問題單時必填),給設定畫面的下拉選單。讀不到回空清單,讓使用者手動輸入名稱。 */
export async function loadIssueMantisCategories(): Promise<{ categories: string[]; note?: string }> {
  await requireAdmin();
  const conn = await loadConnection();
  if (!conn) return { categories: [], note: "還沒有設定 Mantis 連線" };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return { categories: [], note: "API token 解不開,請重新輸入 token" };
  try {
    const json = (await mantisGet(conn.baseUrl, token, `projects/${conn.projectId}`)) as { projects?: unknown } | null;
    const project = Array.isArray(json?.projects) ? (json!.projects[0] as { categories?: unknown } | undefined) : undefined;
    const names = Array.isArray(project?.categories)
      ? (project!.categories as { name?: unknown }[]).map((c) => (typeof c?.name === "string" ? c.name.trim() : "")).filter(Boolean)
      : [];
    return names.length > 0 ? { categories: [...new Set(names)] } : { categories: [], note: "讀不到這個專案的分類,請手動輸入分類名稱(要跟 Mantis 上的完全一樣)。" };
  } catch (err) {
    return { categories: [], note: `${err instanceof MantisError ? err.message : "讀取失敗"}——請手動輸入分類名稱。` };
  }
}

/** 存欄位對應與寫回設定。存好馬上同步一次,讓新的對應套用到已經同步下來的案件。 */
export async function saveIssueMantisMapping(input: unknown): Promise<{ error?: string; sync?: { ok: true; summary: SyncSummary } | { ok: false; error: string } }> {
  const session = await requireAdmin();
  const conn = await loadConnection();
  if (!conn) return { error: "還沒有設定 Mantis 連線" };
  const checked = validateIssueMapping(input);
  if ("error" in checked) return checked;
  const before = parseIssueMapping(conn.mapping);
  await prisma.issueMantisConnection.update({ where: { id: "global" }, data: { mapping: checked.mapping } });
  const wb = checked.mapping.writeBack;
  await logAudit("SETTINGS", session.userId, `更新 ISSUE TRACKER 與 Mantis 的欄位對應${wb.enabled !== before.writeBack.enabled ? (wb.enabled ? "(開啟寫回 Mantis)" : "(關閉寫回 Mantis)") : ""}`);
  const sync = conn.enabled ? await syncIssueMantis() : undefined;
  revalidatePath("/issues", "layout");
  return { sync };
}

export async function syncIssueMantisNow(): Promise<{ error?: string; summary?: SyncSummary }> {
  await requireAdmin();
  const outcome = await syncIssueMantis();
  revalidatePath("/issues", "layout");
  return outcome.ok ? { summary: outcome.summary } : { error: outcome.error };
}

/** 刪除連線。已經連到 Mantis 的案件保留,但不再同步與寫回(連結清掉,變成一般案件)。 */
export async function deleteIssueMantisConnection(): Promise<{ error?: string }> {
  const session = await requireAdmin();
  if (!(await loadConnection())) return { error: "還沒有設定 Mantis 連線" };
  await prisma.$transaction([
    prisma.issueCase.updateMany({ where: { mantisId: { not: null } }, data: { mantisId: null, mantisUpdatedAt: null } }),
    prisma.issueMantisConnection.delete({ where: { id: "global" } }),
  ]);
  await logAudit("SETTINGS", session.userId, "刪除 ISSUE TRACKER 與 Mantis 的連線(已連結的案件保留成一般案件)");
  revalidatePath("/issues", "layout");
  return {};
}

// ── 案件上的 Mantis 動作 ──────────────────────────────────

/** 建立到 Mantis、連結既有單號、立即同步這筆:ISSUE TRACKER 的管理者與負責的(或還沒人負責的)處理人。 */
async function requireCaseMantisAccess(caseId: string) {
  const { role, userId } = await requireIssueActor();
  const c = await prisma.issueCase.findFirst({
    where: { id: caseId, deletedAt: null },
    select: { id: true, caseNo: true, reporterId: true, confirmedAt: true, assignees: { select: { userId: true } } },
  });
  if (!c) throw new UserError("找不到這個案件(可能已經被刪除)");
  const facts = { reporterId: c.reporterId, assigneeIds: c.assignees.map((a) => a.userId), locked: c.confirmedAt !== null };
  if (!canManageIssues(role) && !canEditHandlingFields(role, userId, facts)) throw new UserError("權限不足:只有管理者與負責的處理人可以操作 Mantis");
  return { userId, caseNo: c.caseNo };
}

export async function createInMantisAction(caseId: string): Promise<{ error?: string; warnings?: string[]; mantisId?: number }> {
  const { userId, caseNo } = await requireCaseMantisAccess(caseId);
  const result = await createCaseInMantis(caseId, userId);
  if ("error" in result) return { error: result.error };
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${caseNo} 建立到 Mantis #${result.mantisId}`);
  revalidatePath("/issues", "layout");
  return { mantisId: result.mantisId, warnings: result.warnings };
}

export async function linkToMantisAction(caseId: string, mantisId: number): Promise<{ error?: string }> {
  const { userId, caseNo } = await requireCaseMantisAccess(caseId);
  const result = await linkCaseToMantis(caseId, mantisId);
  if ("error" in result) return { error: result.error };
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${caseNo} 連結到 Mantis #${mantisId}`);
  revalidatePath("/issues", "layout");
  return {};
}

export async function syncCaseNowAction(caseId: string): Promise<{ error?: string; updated?: boolean }> {
  await requireCaseMantisAccess(caseId);
  const result = await syncOneCaseFromMantis(caseId);
  if ("error" in result) return { error: result.error };
  revalidatePath("/issues", "layout");
  return { updated: result.updated };
}

/** Mantis 單號對應的網址(案件頁的連結用)。 */
export async function mantisIssueLink(mantisId: number): Promise<string | null> {
  await requireIssueActor();
  const conn = await loadConnection();
  return conn ? issueUrl(conn.baseUrl, mantisId) : null;
}
