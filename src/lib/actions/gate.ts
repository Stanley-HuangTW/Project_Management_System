"use server";

import { revalidatePath } from "next/cache";
import type { GateStatus, GateDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { requireStructureAccess } from "@/lib/permissions";
import { assessGate, findGateBreaches, type GateBreach, type GatePhaseItem } from "@/lib/gateReview";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import {
  notifyCriterionInvited,
  notifyCriterionSigned,
  notifyGateApprovalNeeded,
  notifyGateDecided,
  notifyGateSigned,
} from "@/lib/approvalNotify";
import { MAX_CRITERION_APPROVERS, metFromDecisions } from "@/lib/gateCriterion";

export type GateCriterionRow = {
  id: string;
  text: string;
  required: boolean;
  met: boolean;
  itemId: string | null;
  itemName: string | null;
  /** 負責確認這一條的人(沒有 = 手動勾選)。有的話「達成」由他們表態決定。 */
  approvers: GateApproverRow[];
  /** 現在登入的人是不是這一條的確認人、而且閘門還沒放行(還能表態)。 */
  canSign: boolean;
};

export type GateApproverRow = {
  userId: string;
  userName: string;
  decision: GateDecision | null;
  decidedAt: string | null;
  comment: string | null;
};

export type GateRow = {
  id: string;
  name: string;
  status: GateStatus;
  itemId: string | null;
  itemName: string | null;
  plannedDate: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  criteria: GateCriterionRow[];
  approvers: GateApproverRow[];
  /** Whether PASSED would be honest, and what is missing if not. */
  canPass: boolean;
  blockers: string[];
};

export type GateBoardView = {
  gates: GateRow[];
  /** Next phases already being worked while the gate in front of them is
   *  still open — see findGateBreaches. */
  breaches: GateBreach[];
};

export async function listGates(boardId: string): Promise<GateBoardView> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [gates, board] = await Promise.all([
    prisma.gate.findMany({
      where: { boardId },
      orderBy: [{ plannedDate: "asc" }, { createdAt: "asc" }],
      include: {
        criteria: {
          orderBy: { order: "asc" },
          include: { approvers: { include: { user: { select: { name: true } } }, orderBy: { id: "asc" } } },
        },
        approvers: { include: { user: { select: { name: true } } } },
        decidedBy: { select: { name: true } },
      },
    }),
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        progressColumnId: true,
        ganttStartColumnId: true,
        items: {
          where: { deletedAt: null },
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            parentId: true,
            groupId: true,
            order: true,
            cellValues: { select: { columnId: true, value: true } },
          },
        },
      },
    }),
  ]);

  const items = board?.items ?? [];
  // 統計只算看得到的:一個私人工作項不該從閘門警告裡被推敲出來。
  const visibleIds = await visibleItemIdsForBoard(boardId, session);
  const itemNameById = new Map(items.filter((i) => visibleIds.has(i.id)).map((i) => [i.id, i.name]));

  const phaseItems: GatePhaseItem[] = items
    .filter((item) => visibleIds.has(item.id))
    .map((item) => {
      const progress = board?.progressColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.progressColumnId)?.value
        : undefined;
      const start = board?.ganttStartColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.ganttStartColumnId)?.value
        : undefined;
      return {
        id: item.id,
        name: item.name,
        parentId: item.parentId,
        groupId: item.groupId,
        order: item.order,
        progressPct: typeof progress === "number" ? progress : null,
        startDate: typeof start === "string" ? start : null,
      };
    });

  const breaches = findGateBreaches(
    gates.map((g) => ({ id: g.id, name: g.name, itemId: g.itemId, status: g.status })),
    phaseItems,
    new Date().toISOString().slice(0, 10)
  );

  return {
    breaches,
    gates: gates.map((gate) => {
      const readiness = assessGate(
        gate.criteria.map((c) => ({ required: c.required, met: c.met })),
        gate.approvers.map((a) => ({ decision: a.decision }))
      );
      return {
        id: gate.id,
        name: gate.name,
        status: gate.status,
        itemId: gate.itemId,
        itemName: gate.itemId ? (itemNameById.get(gate.itemId) ?? null) : null,
        plannedDate: gate.plannedDate,
        decidedAt: gate.decidedAt?.toISOString() ?? null,
        decidedByName: gate.decidedBy?.name ?? null,
        decisionNote: gate.decisionNote,
        criteria: gate.criteria.map((c) => ({
          id: c.id,
          text: c.text,
          required: c.required,
          met: c.met,
          itemId: c.itemId,
          itemName: c.itemId ? (itemNameById.get(c.itemId) ?? null) : null,
          approvers: c.approvers.map((a) => ({
            userId: a.userId,
            userName: a.user.name,
            decision: a.decision,
            decidedAt: a.decidedAt?.toISOString() ?? null,
            comment: a.comment,
          })),
          canSign:
            gate.status !== "PASSED" && gate.status !== "WAIVED" && c.approvers.some((a) => a.userId === session.userId),
        })),
        approvers: gate.approvers.map((a) => ({
          userId: a.userId,
          userName: a.user.name,
          decision: a.decision,
          decidedAt: a.decidedAt?.toISOString() ?? null,
          comment: a.comment,
        })),
        canPass: readiness.canPass,
        blockers: readiness.blockers,
      };
    }),
  };
}

async function gateBoardId(gateId: string): Promise<string | null> {
  const gate = await prisma.gate.findUnique({ where: { id: gateId }, select: { boardId: true } });
  return gate?.boardId ?? null;
}

/** Setting a gate up is a structural act — it decides what the project has to
 *  clear. Signing one is not; that is the approver's own. */
async function requireGateOwner(gateId: string) {
  const session = await requireSession();
  const boardId = await gateBoardId(gateId);
  if (!boardId) throw new UserError("找不到這個閘門");
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  return { session, boardId };
}

export async function createGate(
  boardId: string,
  input: { name: string; itemId: string | null; plannedDate: string | null }
): Promise<{ error?: string; id?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  const name = input.name.trim();
  if (!name) return { error: "請輸入閘門名稱" };

  const gate = await prisma.gate.create({
    data: {
      boardId,
      name,
      itemId: input.itemId || null,
      plannedDate: input.plannedDate || null,
      createdById: session.userId,
    },
  });
  revalidatePath(`/boards/${boardId}`);
  return { id: gate.id };
}

export async function updateGate(
  gateId: string,
  input: { name: string; itemId: string | null; plannedDate: string | null }
): Promise<{ error?: string }> {
  const { boardId } = await requireGateOwner(gateId);
  const name = input.name.trim();
  if (!name) return { error: "請輸入閘門名稱" };

  await prisma.gate.update({
    where: { id: gateId },
    data: { name, itemId: input.itemId || null, plannedDate: input.plannedDate || null },
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteGate(gateId: string): Promise<{ error?: string }> {
  const { boardId } = await requireGateOwner(gateId);
  await prisma.gate.delete({ where: { id: gateId } });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function addCriterion(
  gateId: string,
  text: string,
  required: boolean,
  itemId: string | null
): Promise<{ error?: string }> {
  const { boardId } = await requireGateOwner(gateId);
  const trimmed = text.trim();
  if (!trimmed) return { error: "請輸入條件內容" };

  const count = await prisma.gateCriterion.count({ where: { gateId } });
  await prisma.gateCriterion.create({
    data: { gateId, text: trimmed, required, itemId: itemId || null, order: count },
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * Ticking a criterion is normal board work, not a structural change — the
 * person who finished the test report is the one who should be able to say so.
 */
export async function setCriterionMet(
  criterionId: string,
  met: boolean
): Promise<{ error?: string }> {
  const session = await requireSession();
  const criterion = await prisma.gateCriterion.findUnique({
    where: { id: criterionId },
    select: { gate: { select: { boardId: true, status: true } }, _count: { select: { approvers: true } } },
  });
  if (!criterion) return { error: "找不到這個條件" };
  await requireBoardAccess(criterion.gate.boardId, session);
  if (criterion._count.approvers > 0) return { error: "這一條有指定確認人,是否達成由他們表態決定,不能手動勾選。" };
  // A decided gate is a record of what was true at the time. Re-ticking its
  // boxes afterwards would quietly rewrite the basis of somebody's signature.
  if (criterion.gate.status === "PASSED" || criterion.gate.status === "WAIVED") {
    return { error: "這個閘門已經放行,條件不能再改。要重新審查請先退回待審。" };
  }

  await prisma.gateCriterion.update({ where: { id: criterionId }, data: { met } });
  revalidatePath(`/boards/${criterion.gate.boardId}`);
  return {};
}

/**
 * 指定(或更換)某一條出口條件的確認人,可以多位。新加的人會收到邀請通知;拿掉的人的表態一併清掉。
 * 這是設定閘門的結構性動作,跟新增條件同一個權限。確認人變了,「達成」就依新的名單重新判斷。
 */
export async function setCriterionApprovers(criterionId: string, userIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  const criterion = await prisma.gateCriterion.findUnique({
    where: { id: criterionId },
    select: {
      text: true,
      gate: { select: { name: true, boardId: true, status: true } },
      approvers: { select: { userId: true, decision: true } },
    },
  });
  if (!criterion) return { error: "找不到這個條件" };
  await requireBoardAccess(criterion.gate.boardId, session);
  requireStructureAccess(session.role);
  if (criterion.gate.status === "PASSED" || criterion.gate.status === "WAIVED") {
    return { error: "這個閘門已經放行,條件不能再改。要重新審查請先退回待審。" };
  }
  const wanted = [...new Set(userIds)];
  if (wanted.length > MAX_CRITERION_APPROVERS) return { error: `一條最多 ${MAX_CRITERION_APPROVERS} 位確認人` };
  if (wanted.length > 0) {
    const found = await prisma.user.count({ where: { id: { in: wanted } } });
    if (found !== wanted.length) return { error: "找不到其中的確認人" };
  }

  const existing = new Set(criterion.approvers.map((a) => a.userId));
  const added = wanted.filter((id) => !existing.has(id));
  const kept = criterion.approvers.filter((a) => wanted.includes(a.userId));
  const met = metFromDecisions([...kept.map((a) => a.decision), ...added.map(() => null)]);
  await prisma.$transaction([
    prisma.gateCriterionApprover.deleteMany({ where: { criterionId, userId: { notIn: wanted } } }),
    ...added.map((userId) => prisma.gateCriterionApprover.create({ data: { criterionId, userId } })),
    // 沒有確認人了就回到手動勾選(維持原本勾的狀態);有確認人就依表態重新判斷。
    ...(met === null ? [] : [prisma.gateCriterion.update({ where: { id: criterionId }, data: { met } })]),
  ]);
  await logAudit(
    "GATE",
    session.userId,
    `閘門「${criterion.gate.name}」的條件「${criterion.text}」指定確認人 ${wanted.length} 位`,
    criterion.gate.boardId
  );
  await notifyCriterionInvited(criterionId, session.userId, added);
  revalidatePath(`/boards/${criterion.gate.boardId}`);
  revalidatePath("/approvals");
  return {};
}

/**
 * 確認人對某一條出口條件表態(同意 / 不同意),可以寫備註;不同意一定要寫原因。
 * 只有被指定的人能表態,各簽各的;全部同意時這一條自動達成,有人不同意就是未達成。可以改。
 */
export async function signCriterion(
  criterionId: string,
  decision: GateDecision,
  comment: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const criterion = await prisma.gateCriterion.findUnique({
    where: { id: criterionId },
    select: { gate: { select: { boardId: true, status: true } } },
  });
  if (!criterion) return { error: "找不到這個條件" };
  await requireBoardAccess(criterion.gate.boardId, session);
  if (criterion.gate.status === "PASSED" || criterion.gate.status === "WAIVED") {
    return { error: "這個閘門已經放行,條件不能再改。要重新審查請先退回待審。" };
  }
  const mine = await prisma.gateCriterionApprover.findUnique({
    where: { criterionId_userId: { criterionId, userId: session.userId } },
  });
  if (!mine) return { error: "你不是這一條的確認人" };
  const note = comment.trim();
  if (decision === "REJECTED" && !note) return { error: "不同意要寫原因,負責的人才知道要補什麼" };
  if (note.length > 2000) return { error: "備註太長了(上限 2000 字)" };

  await prisma.$transaction(async (tx) => {
    await tx.gateCriterionApprover.update({
      where: { criterionId_userId: { criterionId, userId: session.userId } },
      data: { decision, decidedAt: new Date(), comment: note || null },
    });
    const all = await tx.gateCriterionApprover.findMany({ where: { criterionId }, select: { decision: true } });
    await tx.gateCriterion.update({
      where: { id: criterionId },
      data: { met: metFromDecisions(all.map((a) => a.decision)) === true },
    });
  });
  await notifyCriterionSigned(criterionId, session.userId, decision === "APPROVED", note || null);
  revalidatePath(`/boards/${criterion.gate.boardId}`);
  revalidatePath("/approvals");
  return {};
}

export async function deleteCriterion(criterionId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const criterion = await prisma.gateCriterion.findUnique({
    where: { id: criterionId },
    select: { gateId: true, gate: { select: { boardId: true } } },
  });
  if (!criterion) return { error: "找不到這個條件" };
  await requireBoardAccess(criterion.gate.boardId, session);
  requireStructureAccess((await requireSession()).role);

  await prisma.gateCriterion.delete({ where: { id: criterionId } });
  revalidatePath(`/boards/${criterion.gate.boardId}`);
  return {};
}

export async function setApprovers(gateId: string, userIds: string[]): Promise<{ error?: string }> {
  const { boardId } = await requireGateOwner(gateId);

  // Replacing the list keeps the decisions of anybody who stays on it — their
  // signature was about this gate, and re-typing the list is not a reason to
  // ask them again.
  const existing = await prisma.gateApprover.findMany({ where: { gateId }, select: { userId: true } });
  const keep = new Set(userIds);
  const removed = existing.filter((a) => !keep.has(a.userId)).map((a) => a.userId);
  const added = userIds.filter((id) => !existing.some((a) => a.userId === id));

  await prisma.$transaction([
    prisma.gateApprover.deleteMany({ where: { gateId, userId: { in: removed } } }),
    ...added.map((userId) => prisma.gateApprover.create({ data: { gateId, userId } })),
  ]);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 送審 — from DRAFT (or back from FAILED) into PENDING. */
export async function submitGate(gateId: string): Promise<{ error?: string }> {
  const { session, boardId } = await requireGateOwner(gateId);
  const gate = await prisma.gate.findUnique({
    where: { id: gateId },
    select: { approvers: { select: { id: true } } },
  });
  if (!gate || gate.approvers.length === 0) return { error: "請先指定簽核人再送審" };

  await prisma.gate.update({
    where: { id: gateId },
    data: { status: "PENDING", decidedAt: null, decidedById: null, decisionNote: null },
  });
  await notifyGateApprovalNeeded(gateId, session.userId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** Sending a decided gate back for another look — the signatures are cleared,
 *  because they were about the state it was in. */
export async function reopenGate(gateId: string): Promise<{ error?: string }> {
  const { session, boardId } = await requireGateOwner(gateId);
  await prisma.$transaction([
    prisma.gateApprover.updateMany({
      where: { gateId },
      data: { decision: null, decidedAt: null, comment: null },
    }),
    prisma.gate.update({
      where: { id: gateId },
      data: { status: "PENDING", decidedAt: null, decidedById: null, decisionNote: null },
    }),
  ]);
  await notifyGateApprovalNeeded(gateId, session.userId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * One approver's own answer. Only the people on the list may sign, and each
 * signs for themselves — an admin cannot sign on somebody's behalf, because
 * the point of the record is who actually said yes.
 */
export async function signGate(
  gateId: string,
  decision: GateDecision,
  comment: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await gateBoardId(gateId);
  if (!boardId) return { error: "找不到這個閘門" };
  await requireBoardAccess(boardId, session);

  const approver = await prisma.gateApprover.findUnique({
    where: { gateId_userId: { gateId, userId: session.userId } },
  });
  if (!approver) return { error: "你不是這個閘門的簽核人" };

  const gate = await prisma.gate.findUnique({ where: { id: gateId }, select: { status: true } });
  if (gate?.status !== "PENDING") return { error: "這個閘門目前不在待審狀態" };

  await prisma.gateApprover.update({
    where: { gateId_userId: { gateId, userId: session.userId } },
    data: { decision, decidedAt: new Date(), comment: comment.trim() || null },
  });
  await notifyGateSigned(gateId, session.userId, decision === "APPROVED", comment.trim() || null);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * The final call. PASSED is only offered when every required criterion is met
 * and every approver has approved; anything short of that is WAIVED — which
 * demands a reason — or FAILED.
 */
export async function decideGate(
  gateId: string,
  status: Extract<GateStatus, "PASSED" | "FAILED" | "WAIVED">,
  note: string
): Promise<{ error?: string }> {
  const { session, boardId } = await requireGateOwner(gateId);

  const gate = await prisma.gate.findUnique({
    where: { id: gateId },
    include: { criteria: true, approvers: true },
  });
  if (!gate) return { error: "找不到這個閘門" };

  const readiness = assessGate(
    gate.criteria.map((c) => ({ required: c.required, met: c.met })),
    gate.approvers.map((a) => ({ decision: a.decision }))
  );
  if (status === "PASSED" && !readiness.canPass) {
    return { error: `還不能放行:${readiness.blockers.join("、")}。若要照樣往下走,請選「有條件放行」並寫下理由。` };
  }
  const trimmedNote = note.trim();
  if (status === "WAIVED" && !trimmedNote) {
    return { error: "有條件放行必須寫下理由——這是之後唯一查得到當初為什麼放行的紀錄。" };
  }
  if (status === "FAILED" && !trimmedNote) {
    return { error: "不通過必須寫下原因,否則沒有人知道要補什麼。" };
  }

  await prisma.gate.update({
    where: { id: gateId },
    data: {
      status,
      decidedAt: new Date(),
      decidedById: session.userId,
      decisionNote: trimmedNote || null,
    },
  });
  await logAudit(
    "GATE",
    session.userId,
    `閘門「${gate.name}」${status === "PASSED" ? "放行" : status === "WAIVED" ? "有條件放行" : "不通過"}${trimmedNote ? `:${trimmedNote}` : ""}`,
    boardId
  );
  await notifyGateDecided(gateId, session.userId, status === "PASSED" ? "放行" : status === "WAIVED" ? "有條件放行" : "不通過", trimmedNote || null);
  revalidatePath(`/boards/${boardId}`);
  return {};
}
