"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { decryptSecret, encryptSecret } from "@/lib/secretBox";
import { normalizeBaseUrl, type MantisProject, type MantisUser } from "@/lib/mantis";
import { ENUM_CONFIG_OPTIONS, enumsFromMantis, parseMapping, validateMapping, type MantisEnums, type MantisMapping } from "@/lib/mantisMapping";
import { fetchMantisProjects, mantisGet, MantisError, syncMantisConnection, type SyncSummary } from "@/lib/mantisSync";
import { createItem } from "./item";

/**
 * 看板與 MantisBT 專案的連線設定(管理者)。一個看板對一個 Mantis 專案,單向:Mantis → 本系統。
 * API token 加密後存放,不會回傳給畫面。
 */
export type MantisConnectionRow = {
  boardId: string;
  boardName: string;
  baseUrl: string;
  projectId: number;
  projectName: string;
  enabled: boolean;
  issueItemId: string | null;
  /** 這個看板上來自 Mantis 的議題數、其中未結案的。 */
  issueCount: number;
  openCount: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  summary: SyncSummary | null;
  /** 這個連線是不是開了「寫回 Mantis」,以及寫回哪幾類欄位(設定畫面標示用)。 */
  writeBack: MantisMapping["writeBack"];
};

async function requireAdmin() {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  return session;
}

export async function listMantisConnections(): Promise<{
  connections: MantisConnectionRow[];
  /** 還沒有連線的看板,新增時選。 */
  boards: { id: string; name: string }[];
}> {
  await requireAdmin();
  const [connections, boards, counts] = await Promise.all([
    prisma.mantisConnection.findMany({ include: { board: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.board.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.riskEntry.groupBy({ by: ["boardId", "status"], where: { mantisId: { not: null } }, _count: { _all: true } }),
  ]);
  const connected = new Set(connections.map((c) => c.boardId));
  return {
    connections: connections.map((c) => {
      const mine = counts.filter((r) => r.boardId === c.boardId);
      return {
        boardId: c.boardId,
        boardName: c.board.name,
        baseUrl: c.baseUrl,
        projectId: c.projectId,
        projectName: c.projectName,
        enabled: c.enabled,
        issueItemId: c.issueItemId,
        issueCount: mine.reduce((sum, r) => sum + r._count._all, 0),
        openCount: mine.filter((r) => r.status !== "CLOSED").reduce((sum, r) => sum + r._count._all, 0),
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
        lastSyncError: c.lastSyncError,
        summary: (c.lastSyncSummary as SyncSummary | null) ?? null,
        writeBack: parseMapping(c.mapping).writeBack,
      };
    }),
    boards: boards.filter((b) => !connected.has(b.id)),
  };
}

/** 用網址與 token 讀出可選的 Mantis 專案。token 留白代表用這個看板已經存著的那一個。 */
export async function loadMantisProjects(input: {
  baseUrl: string;
  token: string;
  boardId: string | null;
}): Promise<{ projects: MantisProject[]; baseUrl: string } | { error: string }> {
  await requireAdmin();
  const normalized = normalizeBaseUrl(input.baseUrl);
  if ("error" in normalized) return normalized;

  let token = input.token.trim();
  if (!token && input.boardId) {
    const stored = await prisma.mantisConnection.findUnique({ where: { boardId: input.boardId }, select: { tokenEnc: true } });
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

/** 同步下來的議題都掛在看板上一個叫「ISSUE」的工作項底下;沒有就建立(放在第一個分組)。 */
async function ensureIssueItem(boardId: string, currentId: string | null): Promise<string | null> {
  if (currentId) {
    const still = await prisma.item.findFirst({ where: { id: currentId, deletedAt: null }, select: { id: true } });
    if (still) return still.id;
  }
  const named = await prisma.item.findFirst({
    where: { boardId, name: "ISSUE", parentId: null, deletedAt: null },
    select: { id: true },
  });
  if (named) return named.id;
  const group = await prisma.group.findFirst({ where: { boardId }, orderBy: { order: "asc" }, select: { id: true } });
  if (!group) return null;
  const item = await createItem(boardId, group.id, "ISSUE");
  return item.id;
}

export async function saveMantisConnection(input: {
  boardId: string;
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

  const board = await prisma.board.findFirst({ where: { id: input.boardId, deletedAt: null }, select: { id: true, name: true } });
  if (!board) return { error: "找不到這個看板" };

  // 一個 Mantis 專案只對應一個看板——兩個看板各抓一份,同一個問題會重複出現在兩邊。
  const taken = await prisma.mantisConnection.findFirst({
    where: { baseUrl: normalized.url, projectId: input.projectId, boardId: { not: input.boardId } },
    include: { board: { select: { name: true } } },
  });
  if (taken) return { error: `這個 Mantis 專案已經對應到看板「${taken.board.name}」,一個 Mantis 專案只能對應一個看板` };

  const existing = await prisma.mantisConnection.findUnique({ where: { boardId: input.boardId } });
  const token = input.token.trim();
  if (!token && !existing) return { error: "請輸入 Mantis 的 API token" };
  const tokenEnc = token ? encryptSecret(token) : existing!.tokenEnc;

  const issueItemId = await ensureIssueItem(input.boardId, existing?.issueItemId ?? null);
  const data = {
    baseUrl: normalized.url,
    projectId: input.projectId,
    projectName: input.projectName.trim() || `專案 ${input.projectId}`,
    tokenEnc,
    enabled: input.enabled,
    issueItemId,
  };
  const saved = await prisma.mantisConnection.upsert({
    where: { boardId: input.boardId },
    create: { boardId: input.boardId, ...data },
    update: data,
  });
  await logAudit(
    "BOARD",
    session.userId,
    `${existing ? "更新" : "建立"}與 Mantis 的連線:看板「${board.name}」↔ ${data.baseUrl} 專案「${data.projectName}」${data.enabled ? "" : "(停用)"}`,
    input.boardId
  );

  // 存好馬上同步一次,管理者當場就看得到結果(失敗也看得到原因)。
  const sync = data.enabled ? await syncMantisConnection(saved.id) : undefined;
  revalidatePath("/settings");
  revalidatePath(`/boards/${input.boardId}`);
  return { sync };
}

export async function setMantisEnabled(boardId: string, enabled: boolean): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, include: { board: { select: { name: true } } } });
  if (!conn) return { error: "找不到這個連線" };
  await prisma.mantisConnection.update({ where: { boardId }, data: { enabled } });
  await logAudit("BOARD", session.userId, `${enabled ? "啟用" : "停用"}與 Mantis 的同步:看板「${conn.board.name}」`, boardId);
  revalidatePath("/settings");
  return {};
}

/** 設定畫面「欄位對應與寫回」要用的資料:這個連線的對應設定、同步時收集到的 Mantis 使用者、本系統的使用者。 */
export async function getMantisMapping(boardId: string): Promise<
  | {
      mapping: MantisMapping;
      mantisUsers: MantisUser[];
      localUsers: { id: string; name: string; email: string }[];
      /** 每位 Mantis 使用者(編號)是這個看板上幾筆問題的處理人。 */
      handlerCounts: Record<number, number>;
    }
  | { error: string }
> {
  await requireAdmin();
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, select: { mapping: true, users: true } });
  if (!conn) return { error: "找不到這個連線" };
  const [localUsers, counts] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    prisma.riskEntry.groupBy({ by: ["mantisHandlerId"], where: { boardId, mantisId: { not: null }, mantisHandlerId: { not: null } }, _count: { _all: true } }),
  ]);
  return {
    mapping: parseMapping(conn.mapping),
    mantisUsers: Array.isArray(conn.users) ? (conn.users as MantisUser[]) : [],
    localUsers,
    handlerCounts: Object.fromEntries(counts.map((c) => [c.mantisHandlerId!, c._count._all])),
  };
}

/** 從這個連線的 Mantis 讀它的狀態、嚴重度、優先權、resolution 列舉值(給對應表的下拉選單)。讀不到就用 Mantis 內建的,並說明。 */
export async function loadMantisEnums(boardId: string): Promise<{ enums: MantisEnums; fromMantis: boolean; note?: string } | { error: string }> {
  await requireAdmin();
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, select: { baseUrl: true, tokenEnc: true } });
  if (!conn) return { error: "找不到這個連線" };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return { error: "API token 解不開,請重新輸入 token" };
  const query = ENUM_CONFIG_OPTIONS.map((o) => `option[]=${o}`).join("&");
  try {
    const config = await mantisGet(conn.baseUrl, token, `config?${query}`);
    // 翻成使用者語言的顯示文字是加分項,讀不到就只用英文名稱。
    const lang = await mantisGet(conn.baseUrl, token, `lang?${ENUM_CONFIG_OPTIONS.map((o) => `string[]=${o}`).join("&")}`).catch(() => null);
    return { enums: enumsFromMantis(config, lang), fromMantis: true };
  } catch (err) {
    return {
      enums: enumsFromMantis(null),
      fromMantis: false,
      note: `${err instanceof MantisError ? err.message : "讀取失敗"}——先用 Mantis 內建的列舉值;你的 Mantis 有改過的話,可能對不上。`,
    };
  }
}

/** 存欄位對應與寫回設定。存好馬上同步一次,讓新的對應套用到已經同步下來的問題。 */
export async function saveMantisMapping(
  boardId: string,
  input: unknown
): Promise<{ error?: string; sync?: { ok: true; summary: SyncSummary } | { ok: false; error: string } }> {
  const session = await requireAdmin();
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, include: { board: { select: { name: true } } } });
  if (!conn) return { error: "找不到這個連線" };
  const checked = validateMapping(input);
  if ("error" in checked) return checked;
  const before = parseMapping(conn.mapping);
  await prisma.mantisConnection.update({ where: { boardId }, data: { mapping: checked.mapping } });
  const wb = checked.mapping.writeBack;
  await logAudit(
    "BOARD",
    session.userId,
    `更新與 Mantis 的欄位對應:看板「${conn.board.name}」${
      wb.enabled !== before.writeBack.enabled ? (wb.enabled ? "(開啟寫回 Mantis)" : "(關閉寫回 Mantis)") : ""
    }`,
    boardId
  );
  const sync = conn.enabled ? await syncMantisConnection(conn.id) : undefined;
  revalidatePath("/settings");
  revalidatePath(`/boards/${boardId}`);
  return { sync };
}

export async function syncMantisNow(boardId: string): Promise<{ error?: string; summary?: SyncSummary }> {
  await requireAdmin();
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, select: { id: true } });
  if (!conn) return { error: "找不到這個連線" };
  const outcome = await syncMantisConnection(conn.id);
  revalidatePath("/settings");
  revalidatePath(`/boards/${boardId}`);
  return outcome.ok ? { summary: outcome.summary } : { error: outcome.error };
}

/**
 * 刪除連線。已經同步下來的議題保留,但不再是唯讀、也不再同步——變成一般的議題,可以自己維護。
 */
export async function deleteMantisConnection(boardId: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, include: { board: { select: { name: true } } } });
  if (!conn) return { error: "找不到這個連線" };
  await prisma.$transaction([
    prisma.riskEntry.updateMany({
      where: { boardId, mantisId: { not: null } },
      data: { mantisId: null, mantisUrl: null, mantisStatus: null, mantisHandler: null, mantisUpdatedAt: null },
    }),
    prisma.mantisConnection.delete({ where: { boardId } }),
  ]);
  await logAudit("BOARD", session.userId, `刪除與 Mantis 的連線:看板「${conn.board.name}」(已同步的問題保留成一般議題)`, boardId);
  revalidatePath("/settings");
  revalidatePath(`/boards/${boardId}`);
  return {};
}
