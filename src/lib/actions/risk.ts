"use server";

import { revalidatePath } from "next/cache";
import type { RiskKind, RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { requireBoardAccess } from "@/lib/boardAccess";
import { clampLevel, RISK_STATUS_LABELS } from "@/lib/riskRegister";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { logAudit } from "@/lib/activityLog";
import { notifyRiskAssigned } from "@/lib/notify";
import { attributeAudit } from "@/lib/impersonation";
import { descriptionWasTruncated, splitMantisDescription } from "@/lib/mantis";
import { parseMapping, type WriteField } from "@/lib/mantisMapping";
import type { MantisChange } from "@/lib/mantisPatch";
import { pushMantisChanges } from "@/lib/mantisWriteBack";
import {
  allReviewersApproved,
  describeRiskChanges,
  isWorkingStatus,
  mantisPermissions,
  riskPermissions,
  type RiskPermissions,
  type RiskSnapshot,
} from "@/lib/riskWorkflow";

/**
 * 風險與議題。分工與結案流程見 lib/riskWorkflow.ts:建立者寫對策與驗收標準、指定負責人與審核人,
 * 負責人寫進度更新並申請結案,所有審核人同意才結案。
 *
 * 錯誤一律用回傳值帶回去,不用丟例外——production 的 Next.js 會把丟出來的訊息洗成一句通用的話,
 * 使用者就看不到「為什麼不行」。
 */
export type RiskInput = {
  kind: RiskKind;
  status: RiskStatus;
  title: string;
  description: string;
  probability: number;
  impact: number;
  /** 發生的話要多少錢。null = 還沒有人估過。 */
  costImpact: number | null;
  /** 機率的百分比,填了就蓋過 1-5 的級距。 */
  probabilityPct: number | null;
  /** 對策與驗收標準:由指派的人寫,做什麼、做到什麼程度才算解除。 */
  mitigation: string;
  ownerId: string | null;
  /** 審核人。申請結案之後每一位都同意才算解除。 */
  reviewerIds: string[];
  dueDate: string | null;
  itemId: string | null;
  /** 只有 Mantis 同步來的問題用:Mantis 優先權的編號(開了寫回「嚴重度與優先權」才能改)。 */
  mantisPriorityId?: number | null;
};

export type RiskReviewerRow = { userId: string; name: string; approvedAt: string | null };

/** 從 MantisBT 同步來的議題帶的來源資訊;手動建立的是 null。 */
export type RiskMantisInfo = {
  id: number;
  url: string | null;
  /** Mantis 上的狀態原文,例如 assigned。 */
  status: string | null;
  handler: string | null;
  updatedAt: string | null;
  /** 這個連線開了寫回的欄位類別(畫面據此決定哪些欄位可以改);沒開寫回就是空的。 */
  writable: WriteField[];
  /** Mantis 優先權目前的編號,以及可選的優先權清單。 */
  priorityId: number | null;
  priorityOptions: { id: number; text: string }[];
  /** 接在說明後面的 Mantis 備註區塊(唯讀,寫回說明時不會送出去)。 */
  notes: string;
  /** 本系統只存了說明的前面一段:為了不蓋掉 Mantis 上完整的說明,說明不開放修改。 */
  descriptionTruncated: boolean;
};

export type RiskRow = RiskInput & {
  id: string;
  mantis: RiskMantisInfo | null;
  ownerName: string | null;
  itemName: string | null;
  createdAt: string;
  createdById: string | null;
  createdByName: string | null;
  reviewers: RiskReviewerRow[];
  /** 目前登入的人對這一筆能做什麼(同一份規則,server 也會再檢查一次)。 */
  permissions: RiskPermissions;
};

export type RiskUpdateRow = { id: string; authorName: string | null; body: string; createdAt: string };
export type RiskHistoryRow = { id: string; actorName: string | null; message: string; createdAt: string };

type Result = { error?: string };

const uniq = (ids: string[]) => [...new Set(ids.filter(Boolean))];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

function permissionsFor(
  risk: {
    status: RiskStatus;
    createdById: string | null;
    ownerId: string | null;
    mantisId: number | null;
    reviewers: { userId: string; approvedAt: Date | null }[];
  },
  session: SessionPayload,
  writeBack?: { enabled: boolean; fields: readonly string[] }
): RiskPermissions {
  const base = riskPermissions({
    userId: session.userId,
    role: session.role,
    status: risk.status,
    actors: {
      createdById: risk.createdById,
      ownerId: risk.ownerId,
      reviewers: risk.reviewers.map((r) => ({ userId: r.userId, approved: r.approvedAt !== null })),
    },
  });
  return risk.mantisId === null ? base : mantisPermissions(base, writeBack);
}

/** 這一筆目前登入的人能做什麼(Mantis 同步來的,要看那個連線有沒有開寫回)。 */
async function permissionsOf(
  risk: Parameters<typeof permissionsFor>[0] & { boardId: string },
  session: SessionPayload
): Promise<RiskPermissions> {
  const mapping = risk.mantisId === null ? undefined : await writeBackFor(risk.boardId);
  return permissionsFor(risk, session, mapping?.writeBack);
}

/** 這個看板的 Mantis 連線設定的寫回開關;沒有連線就是 undefined(同步來的列都當唯讀)。 */
async function writeBackFor(boardId: string) {
  const conn = await prisma.mantisConnection.findUnique({ where: { boardId }, select: { mapping: true } });
  return conn ? parseMapping(conn.mapping) : undefined;
}

export async function listRisks(boardId: string): Promise<RiskRow[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const risks = await prisma.riskEntry.findMany({
    where: { boardId },
    include: {
      owner: { select: { name: true } },
      reviewers: { include: { user: { select: { name: true } } }, orderBy: { id: "asc" } },
    },
  });
  // The linked items are read separately: itemId is a plain id (see the
  // schema) so a trashed item still shows its name here rather than blanking.
  const items = await prisma.item.findMany({
    where: { id: { in: risks.map((r) => r.itemId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const creators = await prisma.user.findMany({
    where: { id: { in: risks.map((r) => r.createdById).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const creatorNameById = new Map(creators.map((u) => [u.id, u.name]));
  const visibleIds = await visibleItemIdsForBoard(boardId, session);
  // The link stays; only the name of a private item is withheld.
  const itemNameById = new Map(
    items.filter((i) => visibleIds.has(i.id)).map((i) => [i.id, i.name])
  );
  const mapping = risks.some((r) => r.mantisId !== null) ? await writeBackFor(boardId) : undefined;
  const writeBack = mapping?.writeBack;

  return risks.map((risk) => {
    // Mantis 來的說明後面接著 Mantis 備註:畫面上說明只編輯本文,備註另外唯讀顯示。
    const split = risk.mantisId === null ? null : splitMantisDescription(risk.description ?? "");
    return {
    id: risk.id,
    mantis:
      risk.mantisId === null
        ? null
        : {
            id: risk.mantisId,
            url: risk.mantisUrl,
            status: risk.mantisStatus,
            handler: risk.mantisHandler,
            updatedAt: risk.mantisUpdatedAt?.toISOString() ?? null,
            writable: writeBack?.enabled ? writeBack.fields : [],
            priorityId: risk.mantisPriorityId,
            priorityOptions: (mapping?.enums.priority ?? []).map((e) => ({
              id: e.id,
              text: e.label && e.label !== e.name ? `${e.label}(${e.name})` : e.name,
            })),
            notes: split?.notes ?? "",
            descriptionTruncated: descriptionWasTruncated(risk.description ?? ""),
          },
    kind: risk.kind,
    status: risk.status,
    title: risk.title,
    description: split ? split.description : (risk.description ?? ""),
    mantisPriorityId: risk.mantisPriorityId,
    probability: risk.probability,
    impact: risk.impact,
    costImpact: risk.costImpact,
    probabilityPct: risk.probabilityPct,
    mitigation: risk.mitigation ?? "",
    ownerId: risk.ownerId,
    ownerName: risk.owner?.name ?? null,
    reviewerIds: risk.reviewers.map((r) => r.userId),
    reviewers: risk.reviewers.map((r) => ({
      userId: r.userId,
      name: r.user.name,
      approvedAt: r.approvedAt?.toISOString() ?? null,
    })),
    dueDate: risk.dueDate,
    itemId: risk.itemId,
    itemName: risk.itemId ? (itemNameById.get(risk.itemId) ?? null) : null,
    createdAt: risk.createdAt.toISOString(),
    createdById: risk.createdById,
    createdByName: risk.createdById ? (creatorNameById.get(risk.createdById) ?? null) : null,
    permissions: permissionsFor(risk, session, writeBack),
    };
  });
}

/** 這一筆的進度更新(時間軸)與紀錄,打開對話框才讀。 */
export async function getRiskDetail(
  riskId: string
): Promise<{ updates: RiskUpdateRow[]; history: RiskHistoryRow[]; error?: string }> {
  const session = await requireSession();
  const risk = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } });
  if (!risk) return { updates: [], history: [], error: "找不到這筆紀錄" };
  await requireBoardAccess(risk.boardId, session);

  const [updates, history] = await Promise.all([
    prisma.riskUpdate.findMany({
      where: { riskId },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
    prisma.activityLogEntry.findMany({
      where: { riskId },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { actor: { select: { name: true } } },
    }),
  ]);
  return {
    updates: updates.map((u) => ({
      id: u.id,
      authorName: u.author?.name ?? null,
      body: u.body,
      createdAt: u.createdAt.toISOString(),
    })),
    history: history.map((h) => ({
      id: h.id,
      actorName: h.actor?.name ?? null,
      message: h.message,
      createdAt: h.createdAt.toISOString(),
    })),
  };
}

function normalize(input: RiskInput) {
  return {
    kind: input.kind,
    title: input.title.trim(),
    description: input.description.trim() || null,
    probability: clampLevel(input.probability),
    impact: clampLevel(input.impact),
    costImpact:
      input.costImpact !== null && Number.isFinite(input.costImpact) && input.costImpact >= 0
        ? Math.round(input.costImpact)
        : null,
    probabilityPct:
      input.probabilityPct !== null && Number.isFinite(input.probabilityPct)
        ? Math.min(100, Math.max(0, Math.round(input.probabilityPct)))
        : null,
    mitigation: input.mitigation.trim() || null,
    ownerId: input.ownerId || null,
    dueDate: input.dueDate || null,
    itemId: input.itemId || null,
  };
}

type Normalized = ReturnType<typeof normalize>;

function snapshot(data: Normalized, status: RiskStatus, reviewerIds: string[]): RiskSnapshot {
  return {
    kind: data.kind,
    status,
    title: data.title,
    description: data.description ?? "",
    probability: data.probability,
    impact: data.impact,
    costImpact: data.costImpact,
    probabilityPct: data.probabilityPct,
    mitigation: data.mitigation ?? "",
    ownerId: data.ownerId,
    reviewerIds,
    dueDate: data.dueDate,
    itemId: data.itemId,
  };
}

/** 審核人要是真的使用者。 */
async function checkReviewers(ids: string[]): Promise<string | null> {
  if (ids.length === 0) return null;
  const found = await prisma.user.count({ where: { id: { in: ids } } });
  return found === ids.length ? null : "找不到其中的審核人";
}

async function namesFor(userIds: string[], itemIds: string[]) {
  const [users, items] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, name: true } }),
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  return {
    user: (id: string) => userName.get(id) ?? "(已刪除的使用者)",
    item: (id: string) => itemName.get(id) ?? "(已刪除的工作項)",
  };
}

type LogRow = { riskId: string; boardId: string; actorId: string | null; message: string };
/** 管理者以別人的身分操作時,紀錄記管理者並在訊息註記(見 attributeAudit)。 */
const logRows = (riskId: string, boardId: string, session: SessionPayload, messages: string[]): LogRow[] =>
  messages.map((message) => ({ riskId, boardId, ...attributeAudit(session, session.userId, message) }));

export async function createRisk(boardId: string, input: RiskInput): Promise<Result> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const data = normalize(input);
  if (!data.title) return { error: "請輸入標題" };
  if (!isWorkingStatus(input.status)) return { error: "新增時不能直接設成待審核或已結案" };
  const reviewerIds = uniq(input.reviewerIds);
  const reviewerError = await checkReviewers(reviewerIds);
  if (reviewerError) return { error: reviewerError };

  const names = await namesFor([...(data.ownerId ? [data.ownerId] : []), ...reviewerIds], []);
  const risk = await prisma.riskEntry.create({
    data: {
      ...data,
      status: input.status,
      boardId,
      createdById: session.userId,
      reviewers: { create: reviewerIds.map((userId) => ({ userId })) },
    },
  });
  const who = [
    data.ownerId ? `負責人:${names.user(data.ownerId)}` : null,
    reviewerIds.length > 0 ? `審核人:${reviewerIds.map(names.user).join("、")}` : null,
  ].filter(Boolean);
  await prisma.activityLogEntry.createMany({
    data: logRows(risk.id, boardId, session, [
      `建立${input.kind === "ISSUE" ? "議題" : "風險"}「${data.title}」${who.length > 0 ? `(${who.join(";")})` : ""}`,
    ]).map((row) => ({ ...row, category: "RISK" as const })),
  });
  // 被指派為負責人、審核人的人收到通知。
  await notifyRiskAssigned(risk.id, session.userId, { title: data.title, kindLabel: input.kind === "ISSUE" ? "議題" : "風險" }, {
    ownerId: data.ownerId,
    reviewerIds,
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

type RiskWithReviewers = NonNullable<Awaited<ReturnType<typeof findWithReviewers>>>;
const findWithReviewers = (riskId: string) => prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });

/**
 * 修改 Mantis 同步來的問題:Mantis 有的欄位(摘要、說明、到期日、負責人、衝擊、優先權、狀態)先寫回 Mantis,
 * 成功才存(Mantis 拒絕就整筆不存);只有本系統才有的欄位(對策與驗收標準、金額、機率 %、審核人)照一般流程存。
 */
async function updateMantisRisk(existing: RiskWithReviewers, input: RiskInput, session: SessionPayload): Promise<Result> {
  const mapping = await writeBackFor(existing.boardId);
  const permissions = permissionsFor(existing, session, mapping?.writeBack);
  if (!permissions.canEditContent) {
    return {
      error: mapping?.writeBack.enabled
        ? "權限不足:只有審核人與管理者可以修改內容"
        : "這個連線沒有開啟寫回 Mantis,同步來的問題要修改請到 Mantis",
    };
  }
  const data = normalize(input);
  if (!data.title) return { error: "請輸入標題" };

  const reviewerIds = uniq(input.reviewerIds);
  const beforeReviewerIds = existing.reviewers.map((r) => r.userId);
  const reviewersChanged = !sameSet(reviewerIds, beforeReviewerIds);
  if (reviewersChanged && existing.status === "PENDING_REVIEW") {
    return { error: "待審核中不能更換審核人,請先撤回申請結案" };
  }
  const reviewerError = reviewersChanged ? await checkReviewers(reviewerIds) : null;
  if (reviewerError) return { error: reviewerError };

  // Mantis 的欄位:跟現在存的不一樣才算「改了」,沒改的不送。
  const change: MantisChange = {};
  const stored = splitMantisDescription(existing.description ?? "");
  if (data.title !== existing.title) change.title = data.title;
  const description = input.description.replace(/\r\n/g, "\n").trim();
  if (description !== stored.description) {
    if (descriptionWasTruncated(existing.description ?? "")) {
      return { error: "這一筆的說明很長,本系統只存了前面一段;為了不把 Mantis 上完整的說明蓋掉,說明請到 Mantis 修改。" };
    }
    change.description = description;
  }
  if ((data.dueDate ?? null) !== (existing.dueDate ?? null)) change.dueDate = data.dueDate;
  if ((data.ownerId ?? null) !== (existing.ownerId ?? null)) {
    if (data.ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: data.ownerId }, select: { id: true, name: true, email: true } });
      if (!owner) return { error: "找不到這位負責人" };
      change.owner = owner;
    } else {
      change.owner = null;
    }
  }
  if (data.impact !== existing.impact) change.impact = data.impact;
  if (typeof input.mantisPriorityId === "number" && input.mantisPriorityId !== existing.mantisPriorityId) {
    change.priorityId = input.mantisPriorityId;
  }
  let status = existing.status;
  if (input.status !== existing.status) {
    if (existing.status === "PENDING_REVIEW") return { error: "待審核中的狀態要用「撤回申請」或由審核人處理" };
    if (!isWorkingStatus(input.status)) return { error: "結案要由負責人申請、審核人全部同意,不能直接改成這個狀態" };
    if (existing.status === "CLOSED" ? !permissions.canReopen : !permissions.canSetWorkingStatus) {
      return { error: "這個連線沒有開啟寫回「狀態」,或你沒有權限變更狀態" };
    }
    change.status = input.status;
    status = input.status;
  }
  const reopening = existing.status === "CLOSED" && status !== "CLOSED";

  let pushed: Awaited<ReturnType<typeof pushMantisChanges>> = { ok: true, wrote: false, summary: [] };
  if (Object.keys(change).length > 0) {
    pushed = await pushMantisChanges(existing.id, change);
    if ("error" in pushed) return { error: pushed.error };
  }

  // 本系統才有的欄位(跟一般議題一樣存);Mantis 的欄位如果真的寫回了,本系統那一列已經用 Mantis 回的值更新過。
  const names = await namesFor([...beforeReviewerIds, ...reviewerIds], []);
  const localOnly = { costImpact: data.costImpact, probabilityPct: data.probabilityPct, mitigation: data.mitigation };
  const localChanges: string[] = [];
  if (existing.costImpact !== localOnly.costImpact) {
    localChanges.push(`金額:${existing.costImpact ?? "未估"} → ${localOnly.costImpact ?? "未估"}`);
  }
  if (existing.probabilityPct !== localOnly.probabilityPct) localChanges.push("修改了機率 %");
  if ((existing.mitigation ?? null) !== localOnly.mitigation) localChanges.push("修改了對策與驗收標準");
  if (reviewersChanged) {
    localChanges.push(`審核人:${beforeReviewerIds.length === 0 ? "無" : beforeReviewerIds.map(names.user).join("、")} → ${reviewerIds.length === 0 ? "無" : reviewerIds.map(names.user).join("、")}`);
  }
  const messages = [
    ...(pushed.wrote ? [`已寫回 Mantis #${existing.mantisId}:${pushed.summary.join(";")}`] : []),
    ...(change.status && !pushed.wrote ? [`狀態:${RISK_STATUS_LABELS[existing.status]} → ${RISK_STATUS_LABELS[status]}`] : []),
    ...localChanges,
  ];
  await prisma.$transaction(async (tx) => {
    await tx.riskEntry.update({
      where: { id: existing.id },
      // Mantis 沒寫回(沒有要送的)而狀態有改:本系統照要求的存。寫回了就以讀回來的為準,不蓋掉。
      data: { ...localOnly, ...(change.status && !pushed.wrote ? { status } : {}) },
    });
    if (reviewersChanged) {
      await tx.riskReviewer.deleteMany({ where: { riskId: existing.id, userId: { notIn: reviewerIds } } });
      const have = new Set(beforeReviewerIds);
      await tx.riskReviewer.createMany({
        data: reviewerIds.filter((id) => !have.has(id)).map((userId) => ({ riskId: existing.id, userId })),
      });
    }
    if (reopening) await tx.riskReviewer.updateMany({ where: { riskId: existing.id }, data: { approvedAt: null } });
    if (messages.length > 0) {
      await tx.activityLogEntry.createMany({
        data: logRows(existing.id, existing.boardId, session, [`修改「${data.title}」:${messages.join(";")}`]).map((row) => ({
          ...row,
          category: "RISK" as const,
        })),
      });
    }
  });
  // 負責人在 Mantis 上被換掉、新加進來的審核人收到通知。
  const fresh = await prisma.riskEntry.findUnique({ where: { id: existing.id }, select: { ownerId: true, title: true } });
  const newOwnerId = fresh?.ownerId && fresh.ownerId !== existing.ownerId ? fresh.ownerId : null;
  const newReviewerIds = reviewerIds.filter((id) => !beforeReviewerIds.includes(id));
  await notifyRiskAssigned(existing.id, session.userId, { title: fresh?.title ?? data.title, kindLabel: `Mantis #${existing.mantisId} 議題` }, {
    ownerId: newOwnerId,
    reviewerIds: newReviewerIds,
  });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

export async function updateRisk(riskId: string, input: RiskInput): Promise<Result> {
  const session = await requireSession();
  const existing = await findWithReviewers(riskId);
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (existing.mantisId !== null) return updateMantisRisk(existing, input, session);
  const permissions = permissionsFor(existing, session);
  if (!permissions.canEditContent) {
    return { error: "權限不足:只有建立者、審核人與管理者可以修改內容" };
  }
  const data = normalize(input);
  if (!data.title) return { error: "請輸入標題" };

  const reviewerIds = uniq(input.reviewerIds);
  const beforeReviewerIds = existing.reviewers.map((r) => r.userId);
  const reviewersChanged = !sameSet(reviewerIds, beforeReviewerIds);
  if (reviewersChanged && existing.status === "PENDING_REVIEW") {
    return { error: "待審核中不能更換審核人,請先撤回申請結案" };
  }
  const reviewerError = reviewersChanged ? await checkReviewers(reviewerIds) : null;
  if (reviewerError) return { error: reviewerError };

  // 狀態:只能在「未處理 / 處理中」之間切換,或把已結案的重新開啟;待審核與已結案走申請 → 審核。
  let status = existing.status;
  if (input.status !== existing.status) {
    if (existing.status === "PENDING_REVIEW") return { error: "待審核中的狀態要用「撤回申請」或由審核人處理" };
    if (!isWorkingStatus(input.status)) return { error: "結案要由負責人申請、審核人全部同意,不能直接改成這個狀態" };
    status = input.status;
  }
  const reopening = existing.status === "CLOSED" && status !== "CLOSED";

  const names = await namesFor(
    [...(existing.ownerId ? [existing.ownerId] : []), ...(data.ownerId ? [data.ownerId] : []), ...beforeReviewerIds, ...reviewerIds],
    [...(existing.itemId ? [existing.itemId] : []), ...(data.itemId ? [data.itemId] : [])]
  );
  const before = snapshot(
    {
      kind: existing.kind,
      title: existing.title,
      description: existing.description,
      probability: existing.probability,
      impact: existing.impact,
      costImpact: existing.costImpact,
      probabilityPct: existing.probabilityPct,
      mitigation: existing.mitigation,
      ownerId: existing.ownerId,
      dueDate: existing.dueDate,
      itemId: existing.itemId,
    },
    existing.status,
    beforeReviewerIds
  );
  const changes = describeRiskChanges(before, snapshot(data, status, reviewerIds), names);

  await prisma.$transaction(async (tx) => {
    await tx.riskEntry.update({ where: { id: riskId }, data: { ...data, status } });
    if (reviewersChanged) {
      await tx.riskReviewer.deleteMany({ where: { riskId, userId: { notIn: reviewerIds } } });
      const have = new Set(beforeReviewerIds);
      await tx.riskReviewer.createMany({
        data: reviewerIds.filter((id) => !have.has(id)).map((userId) => ({ riskId, userId })),
      });
    }
    if (reopening) await tx.riskReviewer.updateMany({ where: { riskId }, data: { approvedAt: null } });
    if (changes.length > 0) {
      await tx.activityLogEntry.createMany({
        data: logRows(riskId, existing.boardId, session, [`修改「${data.title}」:${changes.join(";")}`]).map(
          (row) => ({ ...row, category: "RISK" as const })
        ),
      });
    }
  });
  // 新換上去的負責人、新加進來的審核人收到通知(沒換的不重複通知)。
  const newOwnerId = data.ownerId && data.ownerId !== existing.ownerId ? data.ownerId : null;
  const newReviewerIds = reviewerIds.filter((id) => !beforeReviewerIds.includes(id));
  await notifyRiskAssigned(riskId, session.userId, { title: data.title, kindLabel: existing.kind === "ISSUE" ? "議題" : "風險" }, {
    ownerId: newOwnerId,
    reviewerIds: newReviewerIds,
  });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

/** 在「未處理 / 處理中」之間切換,或重新開啟已結案的。待審核與已結案不能從這裡設。 */
export async function setRiskStatus(riskId: string, status: RiskStatus): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (!isWorkingStatus(status)) return { error: "結案要由負責人申請、審核人全部同意,不能直接改成這個狀態" };
  if (existing.status === "PENDING_REVIEW") return { error: "待審核中,請先撤回申請結案" };

  const mapping = existing.mantisId === null ? undefined : await writeBackFor(existing.boardId);
  const permissions = permissionsFor(existing, session, mapping?.writeBack);
  const reopening = existing.status === "CLOSED";
  if (reopening ? !permissions.canReopen : !permissions.canSetWorkingStatus) {
    return { error: "權限不足:只有負責人、建立者、審核人與管理者可以變更狀態" };
  }
  if (existing.status === status) return {};

  // Mantis 同步來的:先寫回 Mantis,Mantis 拒絕就不改。
  let wrote = false;
  if (existing.mantisId !== null) {
    const pushed = await pushMantisChanges(riskId, { status });
    if ("error" in pushed) return { error: pushed.error };
    wrote = pushed.wrote;
  }

  await prisma.$transaction([
    prisma.riskEntry.update({ where: { id: riskId }, data: { status } }),
    ...(reopening ? [prisma.riskReviewer.updateMany({ where: { riskId }, data: { approvedAt: null } })] : []),
    prisma.activityLogEntry.create({
      data: {
        riskId,
        boardId: existing.boardId,
        ...attributeAudit(
          session,
          session.userId,
          `「${existing.title}」狀態:${RISK_STATUS_LABELS[existing.status]} → ${RISK_STATUS_LABELS[status]}${wrote ? `(已寫回 Mantis #${existing.mantisId})` : ""}`
        ),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

/** 負責人的進度更新:一筆一筆往下累積,寫了不能改。 */
export async function addRiskUpdate(riskId: string, body: string): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (!(await permissionsOf(existing, session)).canPostUpdate) {
    return { error: "權限不足:只有負責人、建立者、審核人與管理者可以寫進度更新" };
  }
  const text = body.trim();
  if (!text) return { error: "請輸入更新內容" };
  if (text.length > 4000) return { error: "內容太長了(上限 4000 字)" };

  await prisma.$transaction([
    prisma.riskUpdate.create({ data: { riskId, authorId: session.userId, body: text } }),
    prisma.activityLogEntry.create({
      data: {
        riskId,
        boardId: existing.boardId,
        ...attributeAudit(session, session.userId, `「${existing.title}」新增進度更新`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

/** 負責人申請結案:狀態變成待審核,所有審核人這一輪都要重新同意。 */
export async function requestRiskClosure(riskId: string): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (!isWorkingStatus(existing.status)) return { error: "目前的狀態不能申請結案" };
  if (!(await permissionsOf(existing, session)).canRequestClosure) {
    return { error: "權限不足:只有負責人(或管理者)可以申請結案" };
  }
  if (existing.reviewers.length === 0) return { error: "請先指定至少一位審核人,再申請結案" };
  // 「待審核」預設不寫回 Mantis(Mantis 沒有對應的狀態);設定裡有指定的話才會動 Mantis。
  if (existing.mantisId !== null) {
    const pushed = await pushMantisChanges(riskId, { status: "PENDING_REVIEW" });
    if ("error" in pushed) return { error: pushed.error };
  }

  await prisma.$transaction([
    prisma.riskEntry.update({ where: { id: riskId }, data: { status: "PENDING_REVIEW" } }),
    prisma.riskReviewer.updateMany({ where: { riskId }, data: { approvedAt: null } }),
    prisma.activityLogEntry.create({
      data: {
        riskId,
        boardId: existing.boardId,
        ...attributeAudit(session, session.userId, `「${existing.title}」申請結案,等待 ${existing.reviewers.length} 位審核人同意`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

/** 撤回申請結案,回到處理中(例如要先換審核人)。 */
export async function withdrawRiskClosure(riskId: string): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (existing.status !== "PENDING_REVIEW") return { error: "目前沒有待審核的結案申請" };
  if (!(await permissionsOf(existing, session)).canWithdrawClosure) {
    return { error: "權限不足:只有負責人、建立者、審核人與管理者可以撤回申請" };
  }
  if (existing.mantisId !== null) {
    const pushed = await pushMantisChanges(riskId, { status: "MITIGATING" });
    if ("error" in pushed) return { error: pushed.error };
  }

  await prisma.$transaction([
    prisma.riskEntry.update({ where: { id: riskId }, data: { status: "MITIGATING" } }),
    prisma.riskReviewer.updateMany({ where: { riskId }, data: { approvedAt: null } }),
    prisma.activityLogEntry.create({
      data: {
        riskId,
        boardId: existing.boardId,
        ...attributeAudit(session, session.userId, `撤回「${existing.title}」的結案申請`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

/**
 * 審核人同意或退回。全部審核人都同意 → 已結案;任何一位退回 → 回到處理中,退回的原因記進進度更新,
 * 下一次申請所有人重新同意。
 */
export async function reviewRiskClosure(
  riskId: string,
  decision: "APPROVE" | "REJECT",
  comment = ""
): Promise<Result> {
  const session = await requireSession();
  const peek = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true, mantisId: true } });
  if (!peek) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(peek.boardId, session);
  const reason = comment.trim();
  if (decision === "REJECT" && !reason) return { error: "退回要寫原因,負責人才知道要補什麼" };
  if (reason.length > 4000) return { error: "內容太長了(上限 4000 字)" };

  // Mantis 同步來的:網路呼叫不能放在鎖著這一列的交易裡,所以寫回分開做。
  const writeBack = peek.mantisId === null ? undefined : (await writeBackFor(peek.boardId))?.writeBack;
  if (peek.mantisId !== null && decision === "REJECT") {
    // 退回 → 回到處理中。「待審核」預設不寫回 Mantis,這時通常什麼都不會送;設定裡有指定才要把 Mantis 改回來。
    const pre = await findWithReviewers(riskId);
    if (pre && permissionsFor(pre, session, writeBack).canReview) {
      const pushed = await pushMantisChanges(riskId, { status: "MITIGATING" });
      if ("error" in pushed) return { error: pushed.error };
    }
  }

  const result = await prisma.$transaction(
    async (tx): Promise<Result & { closing?: boolean }> => {
      // 鎖住這一筆:兩位審核人同時按同意,各自都只看得到自己那一票,就沒有人會把它結案。
      await tx.$queryRaw`SELECT id FROM "RiskEntry" WHERE id = ${riskId} FOR UPDATE`;
      const risk = await tx.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
      if (!risk) return { error: "找不到這筆紀錄" };
      if (!permissionsFor(risk, session, writeBack).canReview) {
        return { error: risk.status === "PENDING_REVIEW" ? "你不是這一筆的審核人,或這一輪已經同意過了" : "目前沒有待審核的結案申請" };
      }
      const log = (message: string) =>
        tx.activityLogEntry.create({
          data: { riskId, boardId: risk.boardId, ...attributeAudit(session, session.userId, message), category: "RISK" },
        });

      if (decision === "REJECT") {
        await tx.riskUpdate.create({
          data: { riskId, authorId: session.userId, body: `【退回結案申請】${reason}` },
        });
        await tx.riskEntry.update({ where: { id: riskId }, data: { status: "MITIGATING" } });
        await tx.riskReviewer.updateMany({ where: { riskId }, data: { approvedAt: null } });
        await log(`退回「${risk.title}」的結案申請:${reason}`);
        return {};
      }

      await tx.riskReviewer.updateMany({
        where: { riskId, userId: session.userId },
        data: { approvedAt: new Date() },
      });
      const reviewers = await tx.riskReviewer.findMany({ where: { riskId } });
      const approved = reviewers.filter((r) => r.approvedAt !== null).length;
      if (allReviewersApproved(reviewers.map((r) => ({ approved: r.approvedAt !== null })))) {
        if (risk.mantisId !== null) {
          // 全部同意了,但要先把 Mantis 改成結案;寫回成功才算結案(下面交易外做)。
          await log(`同意「${risk.title}」解除(${approved}/${reviewers.length}),全部審核人同意,正在寫回 Mantis`);
          return { closing: true };
        }
        await tx.riskEntry.update({ where: { id: riskId }, data: { status: "CLOSED" } });
        await log(`同意「${risk.title}」解除(${approved}/${reviewers.length}),全部審核人同意,已結案`);
      } else {
        await log(`同意「${risk.title}」解除(${approved}/${reviewers.length})`);
      }
      return {};
    },
    { timeout: 15_000 }
  );
  if (result.closing) {
    const pushed = await pushMantisChanges(riskId, { status: "CLOSED" });
    if ("error" in pushed) {
      // Mantis 沒有接受:這位審核人的同意收回,排除問題後他可以再按一次同意。
      await prisma.$transaction([
        prisma.riskReviewer.updateMany({ where: { riskId, userId: session.userId }, data: { approvedAt: null } }),
        prisma.activityLogEntry.create({
          data: { riskId, boardId: peek.boardId, ...attributeAudit(session, session.userId, `寫回 Mantis 失敗,尚未結案:${pushed.error}`), category: "RISK" },
        }),
      ]);
      revalidatePath(`/boards/${peek.boardId}`);
      return { error: `全部審核人都同意了,但寫回 Mantis 失敗,所以還沒結案、你的同意也先收回:${pushed.error}` };
    }
    await prisma.$transaction([
      prisma.riskEntry.update({ where: { id: riskId }, data: { status: "CLOSED" } }),
      prisma.activityLogEntry.create({
        data: {
          riskId,
          boardId: peek.boardId,
          ...attributeAudit(session, session.userId, `已寫回 Mantis #${peek.mantisId} 並結案`),
          category: "RISK",
        },
      }),
    ]);
  }
  if (!result.error) revalidatePath(`/boards/${peek.boardId}`);
  return { error: result.error };
}

export async function deleteRisk(riskId: string): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (!(await permissionsOf(existing, session)).canDelete) {
    return { error: "權限不足:只有建立者與管理者可以刪除" };
  }

  // 風險刪掉時它自己的紀錄會一起清掉,所以「誰刪了它」另外記在板級稽核。
  await logAudit("RISK", session.userId, `刪除${existing.kind === "ISSUE" ? "議題" : "風險"}「${existing.title}」`, existing.boardId);
  await prisma.riskEntry.delete({ where: { id: riskId } });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}
