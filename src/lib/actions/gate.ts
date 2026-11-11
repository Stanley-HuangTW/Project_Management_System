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
import { notifyGateApprovalNeeded, notifyGateDecided, notifyGateSigned } from "@/lib/approvalNotify";

export type GateCriterionRow = {
  id: string;
  text: string;
  required: boolean;
  met: boolean;
  itemId: string | null;
  itemName: string | null;
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
        criteria: { orderBy: { order: "asc" } },
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
    select: { gate: { select: { boardId: true, status: true } } },
  });
  if (!criterion) return { error: "找不到這個條件" };
  await requireBoardAccess(criterion.gate.boardId, session);
  // A decided gate is a record of what was true at the time. Re-ticking its
  // boxes afterwards would quietly rewrite the basis of somebody's signature.
  if (criterion.gate.status === "PASSED" || criterion.gate.status === "WAIVED") {
    return { error: "這個閘門已經放行,條件不能再改。要重新審查請先退回待審。" };
  }

  await prisma.gateCriterion.update({ where: { id: criterionId }, data: { met } });
  revalidatePath(`/boards/${criterion.gate.boardId}`);
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
