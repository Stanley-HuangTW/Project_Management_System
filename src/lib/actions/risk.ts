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
import {
  allReviewersApproved,
  describeRiskChanges,
  isWorkingStatus,
  mantisReadOnly,
  riskPermissions,
  type RiskPermissions,
  type RiskSnapshot,
} from "@/lib/riskWorkflow";

/**
 * 風險與問題。分工與結案流程見 lib/riskWorkflow.ts:建立者寫對策與驗收標準、指定負責人與審核人,
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
};

export type RiskReviewerRow = { userId: string; name: string; approvedAt: string | null };

/** 從 MantisBT 同步來的問題帶的來源資訊;手動建立的是 null。 */
export type RiskMantisInfo = {
  id: number;
  url: string | null;
  /** Mantis 上的狀態原文,例如 assigned。 */
  status: string | null;
  handler: string | null;
  updatedAt: string | null;
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
  session: SessionPayload
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
  return risk.mantisId === null ? base : mantisReadOnly(base);
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

  return risks.map((risk) => ({
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
          },
    kind: risk.kind,
    status: risk.status,
    title: risk.title,
    description: risk.description ?? "",
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
    permissions: permissionsFor(risk, session),
  }));
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
      `建立${input.kind === "ISSUE" ? "問題" : "風險"}「${data.title}」${who.length > 0 ? `(${who.join(";")})` : ""}`,
    ]).map((row) => ({ ...row, category: "RISK" as const })),
  });
  // 被指派為負責人、審核人的人收到通知。
  await notifyRiskAssigned(risk.id, session.userId, { title: data.title, kindLabel: input.kind === "ISSUE" ? "問題" : "風險" }, {
    ownerId: data.ownerId,
    reviewerIds,
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function updateRisk(riskId: string, input: RiskInput): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
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
  await notifyRiskAssigned(riskId, session.userId, { title: data.title, kindLabel: existing.kind === "ISSUE" ? "問題" : "風險" }, {
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

  const permissions = permissionsFor(existing, session);
  const reopening = existing.status === "CLOSED";
  if (reopening ? !permissions.canReopen : !permissions.canSetWorkingStatus) {
    return { error: "權限不足:只有負責人、建立者、審核人與管理者可以變更狀態" };
  }
  if (existing.status === status) return {};

  await prisma.$transaction([
    prisma.riskEntry.update({ where: { id: riskId }, data: { status } }),
    ...(reopening ? [prisma.riskReviewer.updateMany({ where: { riskId }, data: { approvedAt: null } })] : []),
    prisma.activityLogEntry.create({
      data: {
        riskId,
        boardId: existing.boardId,
        ...attributeAudit(session, session.userId, `「${existing.title}」狀態:${RISK_STATUS_LABELS[existing.status]} → ${RISK_STATUS_LABELS[status]}`),
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
  if (!permissionsFor(existing, session).canPostUpdate) {
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
  if (!permissionsFor(existing, session).canRequestClosure) {
    return { error: "權限不足:只有負責人(或管理者)可以申請結案" };
  }
  if (existing.reviewers.length === 0) return { error: "請先指定至少一位審核人,再申請結案" };

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
  if (!permissionsFor(existing, session).canWithdrawClosure) {
    return { error: "權限不足:只有負責人、建立者、審核人與管理者可以撤回申請" };
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
  const peek = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } });
  if (!peek) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(peek.boardId, session);
  const reason = comment.trim();
  if (decision === "REJECT" && !reason) return { error: "退回要寫原因,負責人才知道要補什麼" };
  if (reason.length > 4000) return { error: "內容太長了(上限 4000 字)" };

  const result = await prisma.$transaction(
    async (tx): Promise<Result> => {
      // 鎖住這一筆:兩位審核人同時按同意,各自都只看得到自己那一票,就沒有人會把它結案。
      await tx.$queryRaw`SELECT id FROM "RiskEntry" WHERE id = ${riskId} FOR UPDATE`;
      const risk = await tx.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
      if (!risk) return { error: "找不到這筆紀錄" };
      if (!permissionsFor(risk, session).canReview) {
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
        await tx.riskEntry.update({ where: { id: riskId }, data: { status: "CLOSED" } });
        await log(`同意「${risk.title}」解除(${approved}/${reviewers.length}),全部審核人同意,已結案`);
      } else {
        await log(`同意「${risk.title}」解除(${approved}/${reviewers.length})`);
      }
      return {};
    },
    { timeout: 15_000 }
  );
  if (!result.error) revalidatePath(`/boards/${peek.boardId}`);
  return result;
}

export async function deleteRisk(riskId: string): Promise<Result> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, include: { reviewers: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  if (!permissionsFor(existing, session).canDelete) {
    return { error: "權限不足:只有建立者與管理者可以刪除" };
  }

  // 風險刪掉時它自己的紀錄會一起清掉,所以「誰刪了它」另外記在板級稽核。
  await logAudit("RISK", session.userId, `刪除${existing.kind === "ISSUE" ? "問題" : "風險"}「${existing.title}」`, existing.boardId);
  await prisma.riskEntry.delete({ where: { id: riskId } });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}
