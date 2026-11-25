"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { requireIssueActor, requireIssueManager } from "@/lib/issueServer";
import { taipeiTodayIso } from "@/lib/timesheet";
import { clampLevels, levelLabel, MAX_APPROVAL_LEVELS } from "@/lib/approvalLevels";
import { loadDelegations, loadSupervisorGraph } from "@/lib/approvalLevelsServer";
import { notifyApproval } from "@/lib/notify";
import { ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import { canMoveStage, TO_REPAIR_STAGE, type IssueLane, type IssueStage } from "@/lib/issueFlow";
import {
  approvalOutcome,
  approvalPrecondition,
  ISSUE_APPROVAL_KINDS,
  ISSUE_APPROVAL_LABELS,
  planApprovalSteps,
  stepToSign,
  type IssueApprovalDto,
  type IssueApprovalKind,
} from "@/lib/issueApproval";
import { APPROVAL_INCLUDE, pendingForUser, toApprovalDtos, viewerOf } from "@/lib/issueApprovalServer";
import { notifyFlowById } from "@/lib/issueFlowServer";
import { pushCaseToMantis } from "@/lib/issueMantisServer";

const LINK = "/issues/approvals";

/** 要通知的簽核人:各階簽核人、能代簽的人;找不到主管的那階通知 ISSUE TRACKER 管理者。只通知有 ISSUE TRACKER 權限的人。 */
async function approverUserIds(steps: { approverId: string | null }[]): Promise<string[]> {
  const ids = new Set(steps.map((s) => s.approverId).filter((x): x is string => !!x));
  if (steps.some((s) => s.approverId === null)) {
    (await prisma.user.findMany({ where: { OR: [{ role: "ADMIN" }, { issueRole: "MANAGER" }] }, select: { id: true } })).forEach((u) => ids.add(u.id));
  }
  for (const [deputy, principals] of await loadDelegations()) if (principals.some((p) => ids.has(p))) ids.add(deputy);
  const ok = await prisma.user.findMany({ where: { id: { in: [...ids] }, OR: [{ role: "ADMIN" }, { issueRole: { not: null } }] }, select: { id: true } });
  return ok.map((u) => u.id);
}

async function nameOf(userId: string) {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "同仁";
}

/** 結案簽核通過時案件的狀態要變:已連到 Mantis 的案件先寫回(失敗就整個不核准,回說明),避免兩邊狀態不一致。 */
async function pushCloseToMantis(c: { id: string; mantisId: number | null; status: string }, closeStatus: "TC" | "PC" | null) {
  if (c.mantisId === null || !closeStatus || closeStatus === c.status) return;
  const pushed = await pushCaseToMantis(c.id, { status: closeStatus });
  if ("error" in pushed) throw new UserError(pushed.error);
}

type CaseForApply = { id: string; caseNo: string; kind: "ISSUE" | "REPAIR"; status: "OPEN" | "TC" | "PC" | "NA"; closeDate: string | null };

/** 簽核核准後案件要發生的事(在交易裡做)。 */
async function applyApproved(
  tx: Prisma.TransactionClient,
  a: { id: string; kind: IssueApprovalKind; note: string; closeStatus: "TC" | "PC" | null },
  c: CaseForApply,
  signerId: string
) {
  const now = new Date();
  if (a.kind === "CLOSE") {
    const to = a.closeStatus ?? "PC";
    await tx.issueCase.update({
      where: { id: c.id },
      data: { status: to, closeDate: c.closeDate ?? taipeiTodayIso(), confirmedAt: now, confirmedById: signerId, stage: "CLOSED", stageAt: now, stuckNotifiedAt: null },
    });
    if (to !== c.status) await tx.issueLog.create({ data: { caseId: c.id, kind: "NOTE", content: `狀態:${ISSUE_STATUS_LABELS[c.status]} → ${ISSUE_STATUS_LABELS[to]}`, authorId: signerId } });
    await tx.issueLog.create({ data: { caseId: c.id, kind: "STAGE", content: `結案簽核通過,案件已結案並鎖定(${ISSUE_STATUS_LABELS[to]})`, authorId: signerId } });
  } else if (a.kind === "TO_REPAIR") {
    await tx.issueCase.update({ where: { id: c.id }, data: { kind: "REPAIR", stage: TO_REPAIR_STAGE, stageAt: now, stuckNotifiedAt: null } });
    await tx.issueLog.create({ data: { caseId: c.id, kind: "STAGE", content: "轉維修簽核通過:Issue 轉 Repair,階段到「運送中」", authorId: signerId } });
  } else {
    await tx.issueLog.create({ data: { caseId: c.id, kind: "STAGE", content: `外勤簽核通過:${a.note}`, authorId: signerId } });
  }
}

async function afterApproved(a: { kind: IssueApprovalKind; id: string; requestedById: string | null }, caseId: string, caseNo: string, signerId: string) {
  if (a.kind === "CLOSE") await notifyFlowById(caseId, { type: "CLOSED" }, signerId);
  if (a.kind === "TO_REPAIR") await notifyFlowById(caseId, { type: "TO_REPAIR" }, signerId);
  const assignees = (await prisma.issueAssignee.findMany({ where: { caseId }, select: { userId: true } })).map((x) => x.userId);
  await notifyApproval({
    userIds: [...(a.requestedById ? [a.requestedById] : []), ...assignees],
    actorId: signerId,
    link: `/issues/${caseId}`,
    message: `案件 ${caseNo} 的${ISSUE_APPROVAL_LABELS[a.kind]}已核准`,
  });
}

/** 送出簽核申請。結案:案件進到「結案簽核中」;轉維修、外勤:申請期間不能推進階段。 */
export async function requestIssueApproval(
  caseId: string,
  kind: IssueApprovalKind,
  input: { note?: string; closeStatus?: "TC" | "PC" } = {}
): Promise<{ approved: boolean }> {
  const { role, userId } = await requireIssueActor();
  if (!ISSUE_APPROVAL_KINDS.includes(kind)) throw new UserError("簽核種類不正確");
  const [c, me, settings, graph] = await Promise.all([
    prisma.issueCase.findFirst({ where: { id: caseId, deletedAt: null }, include: { assignees: { select: { userId: true } } } }),
    prisma.user.findUnique({ where: { id: userId }, select: { issueLanes: true } }),
    prisma.systemSettings.findUnique({ where: { id: "global" }, select: { issueApprovalLevels: true } }),
    loadSupervisorGraph(),
  ]);
  if (!c) throw new UserError("找不到這個案件(可能已經被刪除)");
  const assigneeIds = c.assignees.map((x) => x.userId);
  const actor = { issueRole: role, userId, lanes: (me?.issueLanes ?? []) as IssueLane[] };
  if (!canMoveStage(actor, { assigneeIds, stage: c.stage as IssueStage, locked: c.confirmedAt !== null })) {
    throw new UserError("權限不足:只有目前輪到的角色、案件負責人或管理者可以送簽核");
  }
  const why = approvalPrecondition(kind, c.kind, c.stage as IssueStage);
  if (why) throw new UserError(why);
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (kind === "FIELD_TRIP" && note.length < 2) throw new UserError("請填外勤的地點與事由");
  const closeStatus = kind === "CLOSE" ? (input.closeStatus === "TC" ? "TC" : "PC") : null;
  const steps = planApprovalSteps({ ownerId: assigneeIds[0] ?? null, requesterId: userId, graph, levels: settings?.issueApprovalLevels ?? 1 });
  const allAuto = steps.every((s) => s.auto);
  const now = new Date();

  // 申請人自己包辦所有階(自己就是最高主管):直接核准,結案要先寫回 Mantis。
  if (allAuto && kind === "CLOSE") await pushCloseToMantis(c, closeStatus);

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const a = await tx.issueApproval.create({
        data: {
          caseId,
          kind,
          requestedById: userId,
          note,
          closeStatus,
          fromStage: c.stage,
          ...(allAuto ? { status: "APPROVED" as const, decidedAt: now } : {}),
          steps: {
            create: steps.map((s) => ({
              level: s.level,
              approverId: s.approverId,
              ...(s.auto ? { decision: "APPROVED" as const, comment: "申請人本人就是這一階主管", decidedById: userId, decidedAt: now } : {}),
            })),
          },
        },
      });
      await tx.issueLog.create({ data: { caseId, kind: "STAGE", content: `送出${ISSUE_APPROVAL_LABELS[kind]}${closeStatus ? `(結案為${ISSUE_STATUS_LABELS[closeStatus]})` : ""}${note ? `:${note}` : ""}`, authorId: userId } });
      if (allAuto) await applyApproved(tx, { ...a, closeStatus }, c, userId);
      else if (kind === "CLOSE") await tx.issueCase.update({ where: { id: caseId }, data: { stage: "CLOSING", stageAt: now, stuckNotifiedAt: null } });
      return a;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UserError("這個案件已經有一張簽核在進行中,請先等它處理完");
    throw err;
  }

  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${c.caseNo} 送出${ISSUE_APPROVAL_LABELS[kind]}`);
  if (allAuto) {
    await afterApproved(created, caseId, c.caseNo, userId);
  } else {
    await notifyApproval({
      userIds: await approverUserIds(steps),
      actorId: userId,
      link: LINK,
      message: `${await nameOf(userId)}送出案件 ${c.caseNo} 的${ISSUE_APPROVAL_LABELS[kind]},等你簽核`,
      dedupeUnread: true,
    });
  }
  revalidatePath("/issues", "layout");
  return { approved: allAuto };
}

/** 簽核人核准或退回(退回要填原因)。最後一階核准時,依種類執行:結案(鎖定)、轉維修、外勤。 */
export async function decideIssueApproval(approvalId: string, decision: "APPROVED" | "REJECTED", comment?: string): Promise<void> {
  const { userId } = await requireIssueActor();
  if (decision !== "APPROVED" && decision !== "REJECTED") throw new UserError("決定不正確");
  const a = await prisma.issueApproval.findUnique({ where: { id: approvalId }, include: { steps: { orderBy: { level: "asc" } }, case: true } });
  if (!a || a.case.deletedAt) throw new UserError("找不到這張簽核(可能案件已經被刪除)");
  if (a.status !== "PENDING") throw new UserError("這張簽核已經處理完成了");
  const viewer = await viewerOf(userId);
  const delegatedFor = (await loadDelegations()).get(userId) ?? [];
  const step = stepToSign(a.steps, { ...viewer, requesterId: a.requestedById, delegatedFor });
  if (!step) throw new UserError("你不能簽這一張:你不是簽核人、這一階已經簽過,或這是你自己送的申請");
  const text = String(comment ?? "").trim().slice(0, 1000);
  if (decision === "REJECTED" && !text) throw new UserError("退回請填原因");

  const stepsAfter = a.steps.map((s) => (s.id === step.id ? { ...s, decision } : s));
  const outcome = approvalOutcome(stepsAfter);
  const closeStatus = a.closeStatus === "TC" || a.closeStatus === "PC" ? a.closeStatus : null;
  if (outcome === "APPROVED" && a.kind === "CLOSE") await pushCloseToMantis(a.case, closeStatus);

  const now = new Date();
  const who = await nameOf(userId);
  await prisma.$transaction(async (tx) => {
    // 同時有人簽同一階:只有第一個算數。
    const claimed = await tx.issueApprovalStep.updateMany({ where: { id: step.id, decision: null }, data: { decision, comment: text, decidedById: userId, decidedAt: now } });
    if (claimed.count === 0) throw new UserError("這一階剛剛已經有人簽了");
    if (outcome === "APPROVED") {
      await tx.issueApproval.update({ where: { id: a.id }, data: { status: "APPROVED", decidedAt: now } });
      await applyApproved(tx, { ...a, closeStatus }, a.case, userId);
    } else if (outcome === "REJECTED") {
      await tx.issueApproval.update({ where: { id: a.id }, data: { status: "REJECTED", decidedAt: now } });
      if (a.kind === "CLOSE") await tx.issueCase.update({ where: { id: a.caseId }, data: { stage: a.fromStage, stageAt: now, stuckNotifiedAt: null } });
      await tx.issueLog.create({ data: { caseId: a.caseId, kind: "STAGE", content: `${ISSUE_APPROVAL_LABELS[a.kind]}被退回(${who}):${text}`, authorId: userId } });
    } else {
      await tx.issueLog.create({ data: { caseId: a.caseId, kind: "STAGE", content: `${ISSUE_APPROVAL_LABELS[a.kind]}:${levelLabel(step.level)}${who}已核准,尚待其他階`, authorId: userId } });
    }
  });

  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${a.case.caseNo} ${ISSUE_APPROVAL_LABELS[a.kind]}${decision === "APPROVED" ? "核准" : "退回"}`);
  if (outcome === "APPROVED") await afterApproved(a, a.caseId, a.case.caseNo, userId);
  if (outcome === "REJECTED") {
    const assignees = (await prisma.issueAssignee.findMany({ where: { caseId: a.caseId }, select: { userId: true } })).map((x) => x.userId);
    await notifyApproval({
      userIds: [...(a.requestedById ? [a.requestedById] : []), ...assignees],
      actorId: userId,
      link: `/issues/${a.caseId}`,
      message: `案件 ${a.case.caseNo} 的${ISSUE_APPROVAL_LABELS[a.kind]}被${who}退回:${text}`,
    });
  }
  revalidatePath("/issues", "layout");
}

/** 撤回進行中的簽核:申請人或管理者。結案簽核撤回後案件回到申請前那一階。 */
export async function cancelIssueApproval(approvalId: string): Promise<void> {
  const { userId } = await requireIssueActor();
  const a = await prisma.issueApproval.findUnique({ where: { id: approvalId }, include: { case: { select: { caseNo: true, deletedAt: true } } } });
  if (!a || a.case.deletedAt) throw new UserError("找不到這張簽核");
  if (a.status !== "PENDING") throw new UserError("這張簽核已經處理完成了");
  const viewer = await viewerOf(userId);
  if (!viewer.isIssueManager && a.requestedById !== userId) throw new UserError("權限不足:只有申請人或管理者可以撤回");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.issueApproval.update({ where: { id: a.id }, data: { status: "CANCELED", decidedAt: now } });
    if (a.kind === "CLOSE") await tx.issueCase.update({ where: { id: a.caseId }, data: { stage: a.fromStage, stageAt: now, stuckNotifiedAt: null } });
    await tx.issueLog.create({ data: { caseId: a.caseId, kind: "STAGE", content: `撤回${ISSUE_APPROVAL_LABELS[a.kind]}`, authorId: userId } });
  });
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 案件 ${a.case.caseNo} 撤回${ISSUE_APPROVAL_LABELS[a.kind]}`);
  revalidatePath("/issues", "layout");
}

/** 「待我簽核」頁:等我簽的、我送出的、最近處理完的。 */
export async function listIssueApprovals(): Promise<{ toSign: IssueApprovalDto[]; mine: IssueApprovalDto[]; recent: IssueApprovalDto[] }> {
  const { userId } = await requireIssueActor();
  const viewer = await viewerOf(userId);
  const [toSign, mineRows, recentRows] = await Promise.all([
    pendingForUser(viewer),
    prisma.issueApproval.findMany({ where: { requestedById: userId, case: { deletedAt: null } }, include: APPROVAL_INCLUDE, orderBy: { createdAt: "desc" }, take: 30 }),
    // 最近處理完的:簽過的人看自己簽的,管理者看全部。
    prisma.issueApproval.findMany({
      where: { status: { not: "PENDING" }, case: { deletedAt: null }, ...(viewer.isIssueManager ? {} : { steps: { some: { decidedById: userId } } }) },
      include: APPROVAL_INCLUDE,
      orderBy: { decidedAt: "desc" },
      take: 30,
    }),
  ]);
  const [mine, recent] = await Promise.all([toApprovalDtos(mineRows, viewer), toApprovalDtos(recentRows, viewer)]);
  return { toSign, mine, recent };
}

/** 案件簽核要幾階主管同意(依負責人的主管鏈,1 = 只要直屬主管)。 */
export async function setIssueApprovalLevels(levels: number): Promise<void> {
  const { session } = await requireIssueManager();
  if (!Number.isInteger(levels) || levels < 1 || levels > MAX_APPROVAL_LEVELS) throw new UserError(`階數請填 1 到 ${MAX_APPROVAL_LEVELS}`);
  const n = clampLevels(levels);
  await prisma.systemSettings.upsert({ where: { id: "global" }, create: { id: "global", issueApprovalLevels: n }, update: { issueApprovalLevels: n } });
  await logAudit("SETTINGS", session.userId, `ISSUE TRACKER 案件簽核改為 ${n} 階主管`);
  revalidatePath("/issues", "layout");
}
