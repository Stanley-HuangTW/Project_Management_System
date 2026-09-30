"use server";

import { revalidatePath } from "next/cache";
import type { ItemConstraintType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { canModifyItemSchedule } from "@/lib/permissions";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { syncPredecessorSchedule } from "@/lib/scheduleCascade";
import { logActivity } from "@/lib/activityLog";
import { CONSTRAINT_LABELS } from "@/lib/constraints";

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
  date: string | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { createdById: true, groupId: true, constraintType: true, constraintDate: true },
  });
  if (!item) return { error: "找不到項目" };

  const groupRole = await loadGroupRoleContext(item.groupId, session.userId);
  if (!canModifyItemSchedule(session.role, item.createdById, session.userId, groupRole.access.hasScheduleRole)) {
    return { error: "權限不足:僅建立者、分組的Team Leader/PMD或管理者可以設定日期約束" };
  }
  // A type with no date would silently do nothing on every later recompute.
  if (type && !date) return { error: "請一併選擇約束日期" };

  await prisma.item.update({
    where: { id: itemId },
    data: { constraintType: type, constraintDate: type ? date : null },
  });

  const oldLabel = item.constraintType ? `${CONSTRAINT_LABELS[item.constraintType]} ${item.constraintDate}` : "無";
  const newLabel = type ? `${CONSTRAINT_LABELS[type]} ${date}` : "無";
  if (oldLabel !== newLabel) {
    await logActivity(itemId, session.userId, `日期約束已更新:${oldLabel} → ${newLabel}`);
  }

  // The constraint changes where this item lands, so everything downstream of
  // it has to be recomputed — same as editing its Pred would.
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { manualStartColumnId: true, ganttStartColumnId: true },
  });
  const trigger = board?.manualStartColumnId ?? board?.ganttStartColumnId;
  if (trigger) await syncPredecessorSchedule(boardId, itemId, trigger);

  revalidatePath(`/boards/${boardId}`);
  return {};
}
