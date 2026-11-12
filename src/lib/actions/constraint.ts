"use server";

import { revalidatePath } from "next/cache";
import type { ItemConstraintType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { canModifyItemSchedule } from "@/lib/permissions";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { syncPredecessorSchedule } from "@/lib/scheduleCascade";
import {
  describeConstraintConflicts,
  findConstraintConflicts,
  listItemPredecessors,
  type ItemPredecessor,
} from "@/lib/predecessorLink";
import { logActivity } from "@/lib/activityLog";
import {
  CONSTRAINT_LABELS,
  CONSTRAINT_REF_EDGE_LABELS,
  describeConstraintSource,
  type ConstraintRefEdge,
  type ConstraintSourceInput,
} from "@/lib/constraints";

/**
 * Sets (or clears) the date an item's schedule has to respect. Gated by the
 * same rule as dragging its bar — a constraint moves the item and everything
 * downstream of it, so it is a schedule change, not a note.
 *
 * Returns { error } rather than throwing: Next.js redacts thrown Server Action
 * messages in production, and the caller needs to show the reason.
 */
export async function setItemConstraint(
  itemId: string,
  type: ItemConstraintType | null,
  /** 約束日期的來源:固定日期,或這個項目某個前置任務的開始日 / 完成日(日期跟著它走)。type 為 null 時不看。 */
  source: ConstraintSourceInput | null
): Promise<{ error?: string; warning?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      createdById: true,
      groupId: true,
      constraintType: true,
      constraintDate: true,
      constraintRefItemId: true,
      constraintRefEdge: true,
    },
  });
  if (!item) return { error: "找不到項目" };

  const groupRole = await loadGroupRoleContext(item.groupId, session.userId);
  if (!canModifyItemSchedule(session.role, item.createdById, session.userId, groupRole.access.hasScheduleRole)) {
    return { error: "權限不足:僅建立者、分組的Team Leader/PMD或管理者可以設定日期約束" };
  }
  // A type with no date would silently do nothing on every later recompute.
  if (type && !source) return { error: "請一併選擇約束日期" };

  // 日期的來源:固定日期直接用;跟著前置任務的,要是這個項目 Pred 裡的其中一個、而且它現在有那一端的日期。
  let date: string | null = null;
  let refItemId: string | null = null;
  let refEdge: ConstraintRefEdge | null = null;
  let predecessor: ItemPredecessor | null = null;
  if (type && source) {
    if (source.kind === "FIXED") {
      if (!source.date) return { error: "請一併選擇約束日期" };
      date = source.date;
    } else {
      predecessor = (await listItemPredecessors(boardId, itemId)).find((p) => p.itemId === source.predItemId) ?? null;
      if (!predecessor) return { error: "那個項目不是這個項目的前置任務,請先在 Pred 欄設定它" };
      date = source.edge === "START" ? predecessor.start : predecessor.end;
      if (!date) return { error: `前置任務「${predecessor.name}」還沒有${CONSTRAINT_REF_EDGE_LABELS[source.edge]},先排好它的日期` };
      refItemId = predecessor.itemId;
      refEdge = source.edge;
    }
  }

  await prisma.item.update({
    where: { id: itemId },
    data: {
      constraintType: type,
      constraintDate: type ? date : null,
      constraintRefItemId: type ? refItemId : null,
      constraintRefEdge: type ? refEdge : null,
    },
  });

  const oldLabel = item.constraintType
    ? `${CONSTRAINT_LABELS[item.constraintType]} ${item.constraintDate}${item.constraintRefEdge ? `(跟著前置任務的${CONSTRAINT_REF_EDGE_LABELS[item.constraintRefEdge]})` : ""}`
    : "無";
  const newLabel = type
    ? `${CONSTRAINT_LABELS[type]} ${date}${predecessor && refEdge ? `(${describeConstraintSource(`${predecessor.wbsCode} ${predecessor.name}`.trim(), refEdge)})` : ""}`
    : "無";
  if (oldLabel !== newLabel) {
    await logActivity(itemId, session.userId, `日期約束已更新:${oldLabel} → ${newLabel}`);
  }

  // The constraint changes where this item lands, so everything downstream of
  // it has to be recomputed — same as editing its Pred would.
  // The column has to be one that re-schedules THIS item, not only its
  // dependents: the Start column is a cascade trigger (it fires for items
  // downstream of the edit), so on a classic board it left the item itself
  // untouched until something else about it changed.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { manualStartColumnId: true, manualDurationColumnId: true, predColumnId: true },
  });
  const alwaysComputed = !!board?.manualStartColumnId && !!board.manualDurationColumnId;
  const trigger = alwaysComputed ? board?.manualStartColumnId : board?.predColumnId;
  if (trigger) await syncPredecessorSchedule(boardId, itemId, trigger);

  revalidatePath(`/boards/${boardId}`);

  // Saved either way; a pinned finish that the predecessors cannot meet is
  // worth telling the person who just set it — or who just moved it.
  const conflicts = await findConstraintConflicts(boardId, itemId, { downstream: true });
  return conflicts.length > 0 ? { warning: describeConstraintConflicts(conflicts, itemId) } : {};
}

/**
 * Whether this item's 必須完成於 currently fights its predecessors, for the
 * item card to keep showing after the pop-up is gone. Null when it doesn't.
 * Read-only; returns a value rather than throwing for the same reason as above.
 */
export async function getConstraintConflict(itemId: string): Promise<string | null> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const [own] = await findConstraintConflicts(boardId, itemId);
  return own?.message ?? null;
}

/**
 * 這個項目 Pred 裡的前置任務(代號、名稱、現在的起訖),給日期約束「跟著前置任務的開始日 / 完成日」的選單用。
 * 前置任務可能在別的分組、別的看板,所以問伺服器。唯讀。
 */
export async function getConstraintPredecessors(itemId: string): Promise<ItemPredecessor[]> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  return listItemPredecessors(boardId, itemId);
}
