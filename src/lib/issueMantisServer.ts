import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secretBox";
import { toTaipei } from "@/lib/googleCalendar";
import { taipeiTodayIso } from "@/lib/timesheet";
import { collectMantisUsers, issueUrl, type MantisIssue, type MantisUser } from "@/lib/mantis";
import { ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import { allocateCaseNo } from "@/lib/issueCaseNoServer";
import { notifyFlowById } from "@/lib/issueFlowServer";
import { notifyIssueAssigned } from "@/lib/issueNotify";
import { matchLocalPerson } from "@/lib/mantisPeople";
import {
  MantisError,
  explainEmptyResult,
  fetchAllIssues,
  fetchMantisIssue,
  mergeMantisUsers,
  patchMantisIssue,
  postMantisIssue,
  type SyncOutcome,
  type SyncSummary,
} from "@/lib/mantisSync";
import {
  buildIssueCreate,
  buildIssuePatch,
  forcedWriteMapping,
  mantisTextMatchesCase,
  mantisToCaseFields,
  parseIssueMapping,
  type IssueMantisChange,
  type IssueMantisMapping,
} from "@/lib/issueMantis";

/**
 * ISSUE TRACKER ↔ MantisBT(伺服器端):同步進來、寫回、建立到 Mantis、手動連結。
 * 每一步失敗都回「看得懂的原因」而不是丟例外——排程跑完只回一句成功、其實什麼都沒同步,比沒有同步更糟。
 * 不在 "use server" 檔案裡:那裡的匯出都會變成對外的 Server Action。
 */

export const ISSUE_MANTIS_SYNC_INTERVAL_MS = 15 * 60 * 1000;

type Connection = NonNullable<Awaited<ReturnType<typeof loadConnection>>>;

export function loadConnection() {
  return prisma.issueMantisConnection.findUnique({ where: { id: "global" } });
}

/** 連線可用:有連線、啟用中、token 解得開。回 { conn, token, mapping } 或一句說明。 */
export async function usableConnection(): Promise<{ conn: Connection; token: string; mapping: IssueMantisMapping } | { error: string }> {
  const conn = await loadConnection();
  if (!conn) return { error: "還沒有設定 Mantis 連線(ISSUE TRACKER 設定 → Mantis)" };
  if (!conn.enabled) return { error: "Mantis 連線目前停用中" };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return { error: "Mantis 的 API token 解不開,請管理者重新輸入 token" };
  return { conn, token, mapping: parseIssueMapping(conn.mapping) };
}

const errText = (err: unknown, fallback: string) => (err instanceof MantisError ? err.message : fallback);

async function rememberUsers(conn: Connection, seen: MantisUser[]): Promise<MantisUser[]> {
  const merged = mergeMantisUsers(conn.users, seen);
  if (seen.length > 0 && JSON.stringify(merged) !== JSON.stringify(Array.isArray(conn.users) ? conn.users : [])) {
    await prisma.issueMantisConnection.update({ where: { id: conn.id }, data: { users: merged } });
  }
  return merged;
}

// ── 同步進來 ─────────────────────────────────────────────

type LocalUser = { id: string; name: string; email: string };

type CaseRow = Prisma.IssueCaseGetPayload<{ include: { assignees: { select: { userId: true } } } }>;

/** Mantis 的一筆問題 → 套用到案件(沒有就建立)。回 created / updated / unchanged。 */
async function applyIssue(
  issue: MantisIssue,
  old: CaseRow | undefined,
  ctx: { mapping: IssueMantisMapping; locals: LocalUser[] }
): Promise<"created" | "updated" | "unchanged"> {
  const f = mantisToCaseFields(issue, ctx.mapping);
  const ownerId = f.handler ? (matchLocalPerson({ id: f.handler.id, name: f.handler.name, realName: f.handler.realName, email: f.handler.email }, ctx.locals, ctx.mapping.handlerOverrides)?.userId ?? null) : null;

  if (!old) {
    const reporterId = f.reporter ? (matchLocalPerson({ id: f.reporter.id, name: f.reporter.name, realName: f.reporter.realName, email: f.reporter.email }, ctx.locals)?.userId ?? null) : null;
    const issueDate = f.issueDate ?? taipeiTodayIso();
    const closed = f.status === "TC" || f.status === "PC";
    const created = await prisma.$transaction(async (tx) => {
      const caseNo = await allocateCaseNo(tx, issueDate);
      return tx.issueCase.create({
        data: {
          caseNo,
          kind: "ISSUE",
          priority: f.priority,
          issueDate,
          description: f.description,
          behavior: f.behavior,
          status: f.status,
          closeDate: closed ? (f.updatedDate && f.updatedDate >= issueDate ? f.updatedDate : issueDate) : null,
          reporterId,
          mantisId: issue.id,
          mantisUpdatedAt: f.mantisUpdatedAt,
          // Mantis 專案是給 RD 的:還沒解決 = RD 處理中;RD 已經處理 = 回到 FAE 回報結果。
          stage: f.status === "OPEN" ? "RD_WORKING" : "FAE_REVIEW",
          assignees: ownerId ? { create: [{ userId: ownerId }] } : undefined,
          logs: { create: [{ kind: "NOTE", content: `從 Mantis 同步建立(Mantis #${issue.id})`, authorId: null }] },
        },
        select: { id: true, caseNo: true, description: true },
      });
    });
    // Mantis 上指派給誰,就通知誰(系統同步,沒有操作者)。
    if (ownerId) await notifyIssueAssigned(created, [ownerId], null);
    return "created";
  }

  // Mantis 那邊沒動過:不重複寫(排程每 15 分鐘掃一次,絕大多數都是這一種)。
  if (old.mantisUpdatedAt && f.mantisUpdatedAt && old.mantisUpdatedAt.getTime() === f.mantisUpdatedAt.getTime()) return "unchanged";

  const data: Prisma.IssueCaseUpdateInput = { mantisUpdatedAt: f.mantisUpdatedAt };
  const logs: string[] = [];
  // 「不適用 NA」是本系統自己的判斷,Mantis 沒有對應:Mantis 還沒解決就不蓋掉它。
  const keepNa = old.status === "NA" && f.status === "OPEN";
  if (!keepNa && old.status !== f.status) {
    data.status = f.status;
    logs.push(`Mantis 同步:狀態 ${ISSUE_STATUS_LABELS[old.status]} → ${ISSUE_STATUS_LABELS[f.status]}`);
    if (f.status === "OPEN") data.closeDate = null;
    else if (!old.closeDate) data.closeDate = f.updatedDate && f.updatedDate >= old.issueDate ? f.updatedDate : old.issueDate;
  }
  if (old.priority !== f.priority) {
    data.priority = f.priority;
    logs.push(`Mantis 同步:優先級 ${old.priority} → ${f.priority}`);
  }
  // 文字:送去 Mantis 會跟現在一樣的就不蓋(不吃掉使用者在本系統多寫的字)。
  if (!mantisTextMatchesCase(issue, old)) {
    data.description = f.description;
    data.behavior = f.behavior;
  } else if (old.behavior !== f.behavior && !old.behavior.includes("── Mantis 備註")) {
    // 說明沒變,但 Mantis 多了備註:把最近備註接在規格與行為後面。
    data.behavior = f.behavior;
  }
  const added = ownerId && !old.assignees.some((a) => a.userId === ownerId) ? ownerId : null;
  if (added) data.assignees = { create: [{ userId: added }] };

  // RD 處理中的案件 Mantis 有動靜:通知 FAE 看一下。RD 把單解決 / 關閉了就把案件交回 FAE(流程圖:RD 回應 → FAE 回報結果)。
  const rdActive = old.stage === "RD_WORKING" && old.kind === "ISSUE";
  const rdDone = rdActive && data.status !== undefined && data.status !== "OPEN";
  if (rdDone) {
    data.stage = "FAE_REVIEW";
    data.stageAt = new Date();
    data.stuckNotifiedAt = null;
  }

  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: old.id }, data }),
    ...logs.map((content) => prisma.issueLog.create({ data: { caseId: old.id, kind: "NOTE", content, authorId: null } })),
    ...(rdDone ? [prisma.issueLog.create({ data: { caseId: old.id, kind: "STAGE" as const, content: "RD 在 Mantis 已處理:RD 處理中 → FAE 評估(請 FAE 回報結果)", authorId: null } })] : []),
  ]);
  if (rdActive) await notifyFlowById(old.id, { type: "RD_UPDATED" }, null);
  if (added) await notifyIssueAssigned({ id: old.id, caseNo: old.caseNo, description: old.description }, [added], null);
  return "updated";
}

async function accessUsers(): Promise<LocalUser[]> {
  // 只能把案件指派給有 ISSUE TRACKER 權限的人。
  return prisma.user.findMany({ where: { OR: [{ role: "ADMIN" }, { issueRole: { not: null } }] }, select: { id: true, name: true, email: true } });
}

/** 同步整個 Mantis 專案。結果(成功的統計或失敗的原因)也記在連線上,設定畫面讀得到。 */
export async function syncIssueMantis(): Promise<SyncOutcome> {
  const conn = await loadConnection();
  if (!conn) return { ok: false, error: "還沒有設定 Mantis 連線" };
  const record = async (outcome: SyncOutcome): Promise<SyncOutcome> => {
    await prisma.issueMantisConnection.update({
      where: { id: conn.id },
      data: { lastSyncAt: new Date(), lastSyncError: outcome.ok ? null : outcome.error, ...(outcome.ok ? { lastSyncSummary: outcome.summary } : {}) },
    });
    return outcome;
  };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return record({ ok: false, error: "API token 解不開(可能是伺服器的 AUTH_SECRET 換過),請重新輸入 token" });

  let fetched: { issues: MantisIssue[]; truncated: boolean };
  try {
    fetched = await fetchAllIssues(conn.baseUrl, token, conn.projectId);
  } catch (err) {
    return record({ ok: false, error: errText(err, "同步失敗") });
  }
  const mapping = parseIssueMapping(conn.mapping);
  await rememberUsers(conn, collectMantisUsers(fetched.issues));
  const [locals, rows] = await Promise.all([
    accessUsers(),
    prisma.issueCase.findMany({ where: { mantisId: { in: fetched.issues.map((i) => i.id) } }, include: { assignees: { select: { userId: true } } } }),
  ]);
  const existing = new Map(rows.map((r) => [r.mantisId!, r]));
  const summary: SyncSummary = { total: fetched.issues.length, created: 0, updated: 0, unchanged: 0, truncated: fetched.truncated };
  if (fetched.issues.length === 0) summary.note = await explainEmptyResult(conn.baseUrl, token, conn.projectId);
  for (const issue of fetched.issues) {
    try {
      summary[await applyIssue(issue, existing.get(issue.id), { mapping, locals })]++;
    } catch (err) {
      // 同一個問題被排程與「立即同步」同時建立:唯一鍵擋下來,算沒變。
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        summary.unchanged++;
        continue;
      }
      throw err;
    }
  }
  return record({ ok: true, summary });
}

/** 排程心跳:啟用中、而且上次同步已經超過間隔的就同步。 */
export async function runIssueMantisSyncTick(): Promise<{ synced: number; failed: number }> {
  const conn = await loadConnection();
  if (!conn || !conn.enabled) return { synced: 0, failed: 0 };
  if (conn.lastSyncAt && Date.now() - conn.lastSyncAt.getTime() < ISSUE_MANTIS_SYNC_INTERVAL_MS) return { synced: 0, failed: 0 };
  try {
    const outcome = await syncIssueMantis();
    return outcome.ok ? { synced: 1, failed: 0 } : { synced: 0, failed: 1 };
  } catch {
    return { synced: 0, failed: 1 };
  }
}

/** 單一案件「立即同步」:把 Mantis 上這一筆的最新內容套回來。 */
export async function syncOneCaseFromMantis(caseId: string): Promise<{ ok: true; updated: boolean } | { error: string }> {
  const usable = await usableConnection();
  if ("error" in usable) return usable;
  const c = await prisma.issueCase.findFirst({ where: { id: caseId, deletedAt: null }, include: { assignees: { select: { userId: true } } } });
  if (!c || c.mantisId === null) return { error: "這個案件沒有連到 Mantis" };
  let issue: MantisIssue | null;
  try {
    issue = await fetchMantisIssue(usable.conn.baseUrl, usable.token, c.mantisId);
  } catch (err) {
    return { error: errText(err, "讀取 Mantis 失敗") };
  }
  if (!issue) return { error: "Mantis 上找不到這一筆問題(可能已被刪除或搬走)" };
  await rememberUsers(usable.conn, collectMantisUsers([issue]));
  const outcome = await applyIssue(issue, c, { mapping: usable.mapping, locals: await accessUsers() });
  return { ok: true, updated: outcome !== "unchanged" };
}

// ── 寫回 ────────────────────────────────────────────────

export type PushResult = { ok: true; wrote: boolean; summary: string[]; note?: string } | { error: string };

/**
 * 在本系統改了一個已連到 Mantis 的案件,存檔當下寫回 Mantis(寫回的欄位與對應見 issueMantis.ts)。
 * 沒有連線、連線停用、或這個案件沒連到 Mantis:什麼都不做(本系統照常存)。
 * 順序:先讀 Mantis 現況,發現這一筆在 Mantis 上被別人改過就擋下;再只送有變的欄位;Mantis 拒絕就整個回錯誤,呼叫端什麼都不存;
 * 成功之後記下 Mantis 最新的 updated_at(下一次同步不會把自己剛寫的當成別人改的)。
 */
export async function pushCaseToMantis(caseId: string, change: IssueMantisChange): Promise<PushResult> {
  const c = await prisma.issueCase.findUnique({ where: { id: caseId }, select: { id: true, mantisId: true, mantisUpdatedAt: true } });
  if (!c || c.mantisId === null) return { ok: true, wrote: false, summary: [] };
  const conn = await loadConnection();
  if (!conn || !conn.enabled) return { ok: true, wrote: false, summary: [] };
  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return { error: "Mantis 的 API token 解不開,請管理者重新輸入 token" };
  const mapping = parseIssueMapping(conn.mapping);

  let current: MantisIssue | null;
  try {
    current = await fetchMantisIssue(conn.baseUrl, token, c.mantisId);
  } catch (err) {
    return { error: errText(err, "讀取 Mantis 失敗") };
  }
  if (!current) return { error: "Mantis 上找不到這一筆問題(可能已被刪除或搬走),請先按「立即同步這筆」" };

  // 別人剛在 Mantis 上改過:先同步、看過最新內容再改,不要蓋掉對方。
  const theirs = current.updated_at ? Date.parse(current.updated_at) : NaN;
  if (c.mantisUpdatedAt && !Number.isNaN(theirs) && theirs !== c.mantisUpdatedAt.getTime()) {
    const when = toTaipei(theirs);
    const hhmm = `${String(Math.floor(when.minute / 60)).padStart(2, "0")}:${String(when.minute % 60).padStart(2, "0")}`;
    return { error: `Mantis 上這一筆在 ${when.date} ${hhmm} 被改過,本系統還沒同步到。為了不蓋掉那個修改,這次沒有寫回——請先按案件頁的「立即同步這筆」,看過最新內容再改一次。` };
  }

  const mantisUsers = Array.isArray(conn.users) ? (conn.users as MantisUser[]) : [];
  const patch = buildIssuePatch(change, { mapping, issue: current, mantisUsers });
  if ("error" in patch) return patch;
  if (Object.keys(patch.payload).length === 0) return { ok: true, wrote: false, summary: [] };

  try {
    await patchMantisIssue(conn.baseUrl, token, c.mantisId, patch.payload);
  } catch (err) {
    return { error: `寫回 Mantis 失敗,這次的修改沒有存:${errText(err, "未知的錯誤")}` };
  }
  await recordMantisStamp(conn, token, c.id, c.mantisId);
  return { ok: true, wrote: true, summary: patch.summary };
}

/** 讀回 Mantis 最新的 updated_at 記在案件上。讀不到就算了(下一次同步會對上)。 */
async function recordMantisStamp(conn: Connection, token: string, caseId: string, mantisId: number): Promise<void> {
  try {
    const refreshed = await fetchMantisIssue(conn.baseUrl, token, mantisId);
    const ms = refreshed?.updated_at ? Date.parse(refreshed.updated_at) : NaN;
    if (!Number.isNaN(ms)) await prisma.issueCase.update({ where: { id: caseId }, data: { mantisUpdatedAt: new Date(ms) } });
  } catch {
    /* 寫回已經成功;時間戳之後同步會補 */
  }
}

// ── 建立到 Mantis / 手動連結 ─────────────────────────────

export type CreateResult = { ok: true; mantisId: number; url: string; warnings: string[] } | { error: string };

/** 把一個還沒連到 Mantis 的案件建立成 Mantis 的問題單,並把單號記回案件。 */
export async function createCaseInMantis(caseId: string, actorId: string | null = null): Promise<CreateResult> {
  const usable = await usableConnection();
  if ("error" in usable) return usable;
  const { conn, token, mapping } = usable;
  const c = await prisma.issueCase.findFirst({
    where: { id: caseId, deletedAt: null },
    include: { assignees: { select: { user: { select: { id: true, name: true, email: true } } } } },
  });
  if (!c) return { error: "找不到這個案件(可能已經被刪除)" };
  if (c.mantisId !== null) return { error: `這個案件已經連到 Mantis #${c.mantisId}` };

  const built = buildIssueCreate({ description: c.description, behavior: c.behavior, productId: c.productId, priority: c.priority }, { mapping, projectId: conn.projectId });
  if ("error" in built) return built;
  let created: MantisIssue | null;
  try {
    created = await postMantisIssue(conn.baseUrl, token, built.payload);
  } catch (err) {
    return { error: `建立到 Mantis 失敗:${errText(err, "未知的錯誤")}` };
  }
  if (!created) return { error: "Mantis 回應了,但沒有回傳問題單號,請到 Mantis 確認有沒有建立成功,再用「連結既有 Mantis 單」把單號接回來" };

  // 單號馬上記下來:後面補狀態、負責人就算失敗,案件跟那張單的連結也不會丟。
  const createdMs = created.updated_at ? Date.parse(created.updated_at) : NaN;
  await prisma.issueCase.update({ where: { id: c.id }, data: { mantisId: created.id, mantisUpdatedAt: Number.isNaN(createdMs) ? null : new Date(createdMs) } });

  // 建立時只帶摘要、說明、分類、嚴重度:狀態與負責人建立後再補(不看「允許寫回」開關,這是使用者明確要求建立)。
  const warnings: string[] = [];
  const first = c.assignees[0]?.user;
  const patch = buildIssuePatch({ status: c.status, ...(first ? { owner: first } : {}) }, { mapping: forcedWriteMapping(mapping), issue: created, mantisUsers: Array.isArray(conn.users) ? (conn.users as MantisUser[]) : [] });
  if ("error" in patch) warnings.push(patch.error);
  else if (Object.keys(patch.payload).length > 0) {
    try {
      await patchMantisIssue(conn.baseUrl, token, created.id, patch.payload);
    } catch (err) {
      warnings.push(`單已建立,但補狀態 / 負責人失敗:${errText(err, "未知的錯誤")}`);
    }
  }
  await recordMantisStamp(conn, token, c.id, created.id);
  await prisma.issueLog.create({ data: { caseId: c.id, kind: "NOTE", content: `建立到 Mantis:#${created.id}`, authorId: null } });
  // 建到 Mantis = 請 RD 協助(流程圖:FAE 評估「需要 RD 協助」→ Mantis):問題案件還在通報 / FAE 評估的,階段進到「RD 處理中」並通知 RD。
  if (c.kind === "ISSUE" && (c.stage === "REPORTED" || c.stage === "FAE_REVIEW")) {
    await prisma.$transaction([
      prisma.issueCase.update({ where: { id: c.id }, data: { stage: "RD_WORKING", stageAt: new Date(), stuckNotifiedAt: null } }),
      prisma.issueLog.create({ data: { caseId: c.id, kind: "STAGE", content: `建立到 Mantis,請 RD 協助:${c.stage === "REPORTED" ? "已通報" : "FAE 評估"} → RD 處理中`, authorId: actorId } }),
    ]);
    await notifyFlowById(c.id, { type: "STAGE", to: "RD_WORKING", direction: "FORWARD" }, actorId);
  }
  return { ok: true, mantisId: created.id, url: issueUrl(conn.baseUrl, created.id), warnings };
}

/** 把案件連到 Mantis 上已經存在的單號(之後同步與寫回都跟著這一張單)。不會改案件或 Mantis 的內容。 */
export async function linkCaseToMantis(caseId: string, mantisId: number): Promise<{ ok: true } | { error: string }> {
  const usable = await usableConnection();
  if ("error" in usable) return usable;
  const c = await prisma.issueCase.findFirst({ where: { id: caseId, deletedAt: null }, select: { id: true, mantisId: true } });
  if (!c) return { error: "找不到這個案件(可能已經被刪除)" };
  if (c.mantisId !== null) return { error: `這個案件已經連到 Mantis #${c.mantisId}` };
  if (!Number.isInteger(mantisId) || mantisId <= 0) return { error: "請輸入 Mantis 的單號(數字)" };
  const other = await prisma.issueCase.findFirst({ where: { mantisId }, select: { caseNo: true } });
  if (other) return { error: `Mantis #${mantisId} 已經連到案件 ${other.caseNo}` };

  let issue: MantisIssue | null;
  try {
    issue = await fetchMantisIssue(usable.conn.baseUrl, usable.token, mantisId);
  } catch (err) {
    // 單號不存在時 Mantis 也回 404,跟「REST API 沒開」分不出來,兩種原因都講。
    if (err instanceof Error && err.message.includes("(404)")) return { error: `Mantis 上找不到 #${mantisId}(如果單號沒錯,請確認網址與 REST API 已啟用)` };
    return { error: errText(err, "讀取 Mantis 失敗") };
  }
  if (!issue) return { error: `Mantis 上找不到 #${mantisId}` };
  if (issue.project?.id !== undefined && issue.project.id !== usable.conn.projectId) {
    return { error: `Mantis #${mantisId} 不在設定的 Mantis 專案「${usable.conn.projectName}」裡,不能連結` };
  }
  const ms = issue.updated_at ? Date.parse(issue.updated_at) : NaN;
  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: c.id }, data: { mantisId, mantisUpdatedAt: Number.isNaN(ms) ? null : new Date(ms) } }),
    prisma.issueLog.create({ data: { caseId: c.id, kind: "NOTE", content: `連結到 Mantis #${mantisId}`, authorId: null } }),
  ]);
  return { ok: true };
}
