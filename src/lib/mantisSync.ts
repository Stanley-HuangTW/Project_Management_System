import { Prisma, type RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/secretBox";
import { RISK_STATUS_LABELS } from "@/lib/riskRegister";
import { notifyRiskAssigned } from "@/lib/notify";
import {
  collectMantisUsers,
  mapMantisIssue,
  parseIssuesPage,
  parseProjects,
  resolveLocalStatus,
  type MantisIssue,
  type MantisProject,
  type MappedIssue,
  type MantisUser,
} from "@/lib/mantis";
import { parseMapping } from "@/lib/mantisMapping";
import { matchLocalPerson } from "@/lib/mantisPeople";

/**
 * MantisBT → 風險與議題的單向同步(伺服器端)。
 *
 * 只讀 Mantis(GET),從不寫回去。同步下來的議題在這邊是唯讀的:下一次同步會用 Mantis 上的內容蓋回來。
 * 每一步失敗都回「看得懂的原因」而不是丟例外——排程跑完只回一句成功、其實什麼都沒同步,比沒有同步更糟。
 */

const PAGE_SIZE = 50;
/** 一個專案最多抓幾頁(50 × 100 = 5000 筆),再多就截斷並在結果裡說明。 */
const MAX_PAGES = 100;
const TIMEOUT_MS = 20_000;
/** 排程每隔多久同步一次同一個連線。 */
export const MANTIS_SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** 帶著可以直接給人看的訊息。 */
export class MantisError extends Error {}

type Method = "GET" | "PATCH";

async function request(method: Method, baseUrl: string, token: string, path: string, params: Record<string, string>, auth: "bearer" | "bare", body?: unknown) {
  const url = new URL(`${baseUrl}/api/rest/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url, {
    method,
    headers: {
      authorization: auth === "bearer" ? `Bearer ${token}` : token,
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    // 被轉址(例如 http 轉 https、轉去登入頁)不要默默跟過去,請管理者改用最終的網址。
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** 每個 Mantis 網站上次成功的驗證寫法。舊版 Mantis 每個請求都先試一次必定 401 的 Bearer 太浪費,記住就直接用。 */
const authSchemeByBaseUrl = new Map<string, "bearer" | "bare">();

/** Mantis 回的錯誤 JSON({ message, localized }):有就取出來,讓使用者看到 Mantis 說的原因。 */
async function mantisMessage(response: Response): Promise<string> {
  try {
    const json = (await response.json()) as { localized?: unknown; message?: unknown } | null;
    const text = typeof json?.localized === "string" && json.localized.trim() ? json.localized : json?.message;
    return typeof text === "string" ? text.trim().slice(0, 300) : "";
  } catch {
    return "";
  }
}

/**
 * {GET|PATCH} {網址}/api/rest/{path},回解析好的 JSON。
 * 先用 Bearer(Mantis 2.29 起的標準寫法);舊版只認不加 Bearer 的 token,401 時換另一種寫法重試一次,
 * 哪一種成功就記起來,同一個網站下次直接用。
 */
export async function mantisCall(
  method: Method,
  baseUrl: string,
  token: string,
  path: string,
  params: Record<string, string> = {},
  body?: unknown
): Promise<unknown> {
  let response: Response;
  try {
    const preferred = authSchemeByBaseUrl.get(baseUrl) ?? "bearer";
    const other = preferred === "bearer" ? "bare" : "bearer";
    response = await request(method, baseUrl, token, path, params, preferred, body);
    if (response.status === 401) {
      const retry = await request(method, baseUrl, token, path, params, other, body);
      if (retry.status !== 401) authSchemeByBaseUrl.set(baseUrl, other);
      response = retry;
    } else if (response.ok) {
      authSchemeByBaseUrl.set(baseUrl, preferred);
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new MantisError(timedOut ? "連線 Mantis 逾時,請確認網址、網路與防火牆" : "連不上 Mantis,請確認網址、網路與防火牆");
  }
  if (response.status >= 300 && response.status < 400) {
    throw new MantisError(`網址被轉址到 ${response.headers.get("location") ?? "別處"},請改用最終的網址`);
  }
  if (response.status === 401 || response.status === 403) {
    if (method !== "GET") {
      const detail = await mantisMessage(response);
      throw new MantisError(
        "Mantis 拒絕了這次修改:這個連線的 API token 對應的帳號沒有修改這一筆問題的權限(或 token 已經失效)。" + (detail ? `Mantis 說:${detail}` : "")
      );
    }
    throw new MantisError(
      "Mantis 拒絕了這個 API token:請確認 token 沒有過期、貼對了,而且那個帳號對這個專案有檢視權限。" +
        "(token 確定沒錯的話,可能是網站伺服器沒有把 Authorization 標頭傳給 Mantis——Apache 搭配 FastCGI 時常見,要請 Mantis 管理者設定。)"
    );
  }
  if (response.status === 404) {
    throw new MantisError(
      method === "GET"
        ? "找不到 Mantis 的 REST API(404):請確認網址、Mantis 版本(建議 2.20 以上)與 REST API 已啟用"
        : "Mantis 說找不到這一筆問題(404):可能已經在 Mantis 上被刪掉或搬到別的專案,請先按「立即同步」"
    );
  }
  if (!response.ok) {
    const detail = await mantisMessage(response);
    throw new MantisError(`Mantis 回應錯誤(HTTP ${response.status})${detail ? `:${detail}` : ""}`);
  }
  const text = await response.text();
  // 修改成功時有些版本回 204 或空內容;讀資料就一定要有 JSON。
  if (method !== "GET" && !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new MantisError("Mantis 的回應不是 JSON(可能被導到登入頁,或網址不對)");
  }
}

export async function mantisGet(baseUrl: string, token: string, path: string, params: Record<string, string> = {}): Promise<unknown> {
  return mantisCall("GET", baseUrl, token, path, params);
}

/** 讀單一一筆問題(寫回前確認它沒被別人改過、寫回後讀回最新的值)。 */
export async function fetchMantisIssue(baseUrl: string, token: string, id: number): Promise<MantisIssue | null> {
  const json = await mantisGet(baseUrl, token, `issues/${id}`);
  const single = (json as { issue?: unknown } | null)?.issue;
  const list = single && typeof single === "object" ? [single as MantisIssue] : parseIssuesPage(json);
  return list.find((i) => i.id === id) ?? list[0] ?? null;
}

/** 修改一筆問題(只送有變的欄位)。成功時 Mantis 有的會回修改後的問題,有的回空內容。 */
export async function patchMantisIssue(baseUrl: string, token: string, id: number, payload: Record<string, unknown>): Promise<void> {
  await mantisCall("PATCH", baseUrl, token, `issues/${id}`, {}, payload);
}

/** 這個 token 看得到的 Mantis 專案,管理者設定時挑一個。 */
export async function fetchMantisProjects(baseUrl: string, token: string): Promise<MantisProject[]> {
  return parseProjects(await mantisGet(baseUrl, token, "projects"));
}

async function fetchAllIssues(baseUrl: string, token: string, projectId: number): Promise<{ issues: MantisIssue[]; truncated: boolean }> {
  const issues: MantisIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = parseIssuesPage(
      await mantisGet(baseUrl, token, "issues", { project_id: String(projectId), page_size: String(PAGE_SIZE), page: String(page) })
    );
    issues.push(...batch);
    if (batch.length < PAGE_SIZE) return { issues, truncated: false };
  }
  return { issues, truncated: true };
}

export type SyncSummary = {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  truncated: boolean;
  /** 同步成功但有要提醒的事(例如一筆問題都沒取到時,用的是哪個帳號);沒有就不放。 */
  note?: string;
};

/**
 * Mantis 回應成功卻一筆問題都沒給:多半是 token 對應的帳號看不到這個專案(或只看得到公開的),
 * 光看「0 筆」分不出是專案真的沒有、還是帳號沒權限。問一下 Mantis「我是誰、看得到哪些專案」,把答案寫進提示。
 */
export async function explainEmptyResult(baseUrl: string, token: string, projectId: number): Promise<string> {
  const head = "Mantis 回應成功,但這個專案一筆問題都沒取到。";
  try {
    const me = (await mantisGet(baseUrl, token, "users/me")) as {
      name?: string;
      real_name?: string;
      access_level?: { label?: string; name?: string };
      projects?: { id?: number }[];
    } | null;
    const who = me?.real_name?.trim() || me?.name?.trim();
    if (who) {
      const level = me?.access_level?.label || me?.access_level?.name;
      const sees = Array.isArray(me?.projects) ? me.projects.some((p) => p?.id === projectId) : null;
      return (
        `${head}目前是用「${who}」${level ? `(權限:${level})` : ""}的身分在讀` +
        (sees === false
          ? ",而且這個帳號看不到這個專案——請改用有檢視權限的帳號建 token。"
          : "——請確認專案裡真的有問題,而且這個帳號有權限看(私人的問題要夠高的權限才看得到)。")
      );
    }
  } catch {
    // 問不到就用下面通用的說法
  }
  return `${head}請確認 token 對應的帳號對這個專案有檢視權限,而且專案裡真的有問題。`;
}
/** 同步 / 寫回後讀回的問題,對應成風險與議題那一列要寫的欄位。 */
export function riskFieldsFromMapped(m: MappedIssue, ownerId: string | null, itemId: string | null, status: RiskStatus) {
  return {
    title: m.title,
    description: m.description || null,
    status,
    probability: m.probability,
    impact: m.impact,
    dueDate: m.dueDate,
    ownerId,
    itemId,
    mantisUrl: m.mantisUrl,
    mantisStatus: m.mantisStatus,
    mantisHandler: m.mantisHandler,
    mantisUpdatedAt: m.mantisUpdatedAt,
    mantisSeverity: m.mantisSeverity,
    mantisPriority: m.mantisPriority,
    mantisCategory: m.mantisCategory,
    mantisReporter: m.mantisReporter,
    mantisStatusId: m.mantisStatusId,
    mantisSeverityId: m.mantisSeverityId,
    mantisPriorityId: m.mantisPriorityId,
    mantisHandlerId: m.mantisHandlerId,
  };
}

/** 這個連線收集到的 Mantis 使用者:這次看到的蓋掉舊的,沒再出現的保留(處理人要寫回時還要用)。 */
export function mergeMantisUsers(stored: unknown, seen: MantisUser[]): MantisUser[] {
  const byId = new Map<number, MantisUser>();
  const list = Array.isArray(stored) ? stored : [];
  for (const u of list) {
    if (u && typeof u === "object" && Number.isInteger((u as MantisUser).id)) byId.set((u as MantisUser).id, u as MantisUser);
  }
  for (const u of seen) byId.set(u.id, u);
  return [...byId.values()].sort((a, b) => a.id - b.id).slice(0, 2000);
}

async function rememberMantisUsers(connectionId: string, stored: unknown, seen: MantisUser[]): Promise<void> {
  if (seen.length === 0) return;
  const merged = mergeMantisUsers(stored, seen);
  if (JSON.stringify(merged) === JSON.stringify(Array.isArray(stored) ? stored : [])) return;
  await prisma.mantisConnection.update({ where: { id: connectionId }, data: { users: merged } });
}

export type SyncOutcome = { ok: true; summary: SyncSummary } | { ok: false; error: string };

/** 同步一個連線。結果(成功的統計或失敗的原因)也記在連線上,設定畫面讀得到。 */
export async function syncMantisConnection(connectionId: string): Promise<SyncOutcome> {
  const conn = await prisma.mantisConnection.findUnique({ where: { id: connectionId } });
  if (!conn) return { ok: false, error: "找不到這個連線" };

  const record = async (outcome: SyncOutcome): Promise<SyncOutcome> => {
    await prisma.mantisConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncAt: new Date(),
        lastSyncError: outcome.ok ? null : outcome.error,
        ...(outcome.ok ? { lastSyncSummary: outcome.summary } : {}),
      },
    });
    return outcome;
  };

  const token = decryptSecret(conn.tokenEnc);
  if (token === null) return record({ ok: false, error: "API token 解不開(可能是伺服器的 AUTH_SECRET 換過),請重新輸入 token" });

  let fetched: { issues: MantisIssue[]; truncated: boolean };
  try {
    fetched = await fetchAllIssues(conn.baseUrl, token, conn.projectId);
  } catch (err) {
    return record({ ok: false, error: err instanceof MantisError ? err.message : "同步失敗" });
  }

  const mapping = parseMapping(conn.mapping);
  const mapped = fetched.issues.map((i) => mapMantisIssue(i, conn.baseUrl, mapping));
  await rememberMantisUsers(conn.id, conn.users, collectMantisUsers(fetched.issues));
  const [existingRows, users] = await Promise.all([
    prisma.riskEntry.findMany({
      where: { boardId: conn.boardId, mantisId: { in: mapped.map((m) => m.mantisId) } },
      select: {
        id: true,
        mantisId: true,
        mantisUpdatedAt: true,
        title: true,
        status: true,
        impact: true,
        ownerId: true,
        itemId: true,
        mantisSeverity: true,
        mantisPriority: true,
        mantisCategory: true,
        mantisReporter: true,
        mantisStatusId: true,
        mantisSeverityId: true,
        mantisPriorityId: true,
        mantisHandlerId: true,
      },
    }),
    prisma.user.findMany({ select: { id: true, email: true, name: true } }),
  ]);
  const existing = new Map(existingRows.map((r) => [r.mantisId!, r]));
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  const summary: SyncSummary = { total: mapped.length, created: 0, updated: 0, unchanged: 0, truncated: fetched.truncated };
  if (mapped.length === 0) summary.note = await explainEmptyResult(conn.baseUrl, token, conn.projectId);
  for (const m of mapped) {
    const ownerId =
      matchLocalPerson(
        { id: m.mantisHandlerId, name: m.handlerName, realName: m.handlerRealName, email: m.handlerEmail },
        users,
        mapping.handlerOverrides
      )?.userId ?? null;
    const old = existing.get(m.mantisId);
    // 「待審核」是本系統自己的流程,Mantis 沒有對應的狀態:只要 Mantis 還沒結案,就不能被同步蓋回處理中。
    const status = resolveLocalStatus(old?.status, m.status, m.mantisStatusId, mapping.statusOut.PENDING_REVIEW?.id);
    const fields = riskFieldsFromMapped(m, ownerId, conn.issueItemId, status);
    try {
      if (!old) {
        const created = await prisma.riskEntry.create({
          data: { ...fields, kind: "ISSUE", boardId: conn.boardId, mantisId: m.mantisId, ...(m.createdAt ? { createdAt: m.createdAt } : {}) },
          select: { id: true },
        });
        await prisma.activityLogEntry.create({
          data: {
            riskId: created.id,
            boardId: conn.boardId,
            category: "RISK",
            message: `從 Mantis 同步建立議題 #${m.mantisId}「${m.title}」(${RISK_STATUS_LABELS[status]})${
              ownerId ? `,指派給 ${userNameById.get(ownerId) ?? ""}` : ""
            }`,
          },
        });
        // Mantis 上這個問題指派給誰,就通知誰(系統同步,沒有操作者)。
        if (ownerId) await notifyRiskAssigned(created.id, null, { title: m.title, kindLabel: `Mantis #${m.mantisId} 議題` }, { ownerId });
        summary.created++;
        continue;
      }
      const same =
        old.mantisUpdatedAt?.getTime() === m.mantisUpdatedAt?.getTime() &&
        old.title === m.title &&
        old.status === status &&
        old.impact === m.impact &&
        old.ownerId === ownerId &&
        old.itemId === conn.issueItemId &&
        old.mantisSeverity === m.mantisSeverity &&
        old.mantisPriority === m.mantisPriority &&
        old.mantisCategory === m.mantisCategory &&
        old.mantisReporter === m.mantisReporter &&
        old.mantisStatusId === m.mantisStatusId &&
        old.mantisSeverityId === m.mantisSeverityId &&
        old.mantisPriorityId === m.mantisPriorityId &&
        old.mantisHandlerId === m.mantisHandlerId;
      if (same) {
        summary.unchanged++;
        continue;
      }
      await prisma.riskEntry.update({ where: { id: old.id }, data: fields });
      // 指派給誰變了(Mantis 上改了處理人):記一筆「指派」,並通知新的負責人。
      if (old.ownerId !== ownerId) {
        await prisma.activityLogEntry.create({
          data: {
            riskId: old.id,
            boardId: conn.boardId,
            category: "RISK",
            message: ownerId
              ? `Mantis #${m.mantisId}「${m.title}」指派給 ${userNameById.get(ownerId) ?? ""}${
                  old.ownerId ? `(原負責人:${userNameById.get(old.ownerId) ?? ""})` : ""
                }`
              : `Mantis #${m.mantisId}「${m.title}」取消指派(原負責人:${old.ownerId ? (userNameById.get(old.ownerId) ?? "") : "未指派"})`,
          },
        });
        // Mantis 上這一筆沒動過、只是本系統對得上人了(例如管理者剛補了處理人對應):記紀錄,但不通知——不然一次補對應就轟炸一輪。
        const mantisChanged = old.mantisUpdatedAt?.getTime() !== m.mantisUpdatedAt?.getTime();
        if (ownerId && mantisChanged) await notifyRiskAssigned(old.id, null, { title: m.title, kindLabel: `Mantis #${m.mantisId} 議題` }, { ownerId });
      }
      if (old.status !== status) {
        await prisma.activityLogEntry.create({
          data: {
            riskId: old.id,
            boardId: conn.boardId,
            category: "RISK",
            message: `Mantis #${m.mantisId}「${m.title}」狀態:${RISK_STATUS_LABELS[old.status]} → ${RISK_STATUS_LABELS[status]}`,
          },
        });
      }
      summary.updated++;
    } catch (err) {
      // 同一個問題被兩個同步同時建立(排程與「立即同步」撞在一起):唯一鍵擋下來,算沒變。
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        summary.unchanged++;
        continue;
      }
      throw err;
    }
  }
  return record({ ok: true, summary });
}

/** 排程心跳:該同步的(啟用中、而且上次同步已經超過間隔的)連線逐一同步。一個失敗不影響其他。 */
export async function runMantisSyncTick(): Promise<{ synced: number; failed: number }> {
  const due = await prisma.mantisConnection.findMany({
    where: {
      enabled: true,
      board: { deletedAt: null },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(Date.now() - MANTIS_SYNC_INTERVAL_MS) } }],
    },
    select: { id: true },
  });
  let synced = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const outcome = await syncMantisConnection(id);
      if (outcome.ok) synced++;
      else failed++;
    } catch {
      failed++;
    }
  }
  return { synced, failed };
}
