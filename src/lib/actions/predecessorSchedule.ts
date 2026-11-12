"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { requireStructureAccess } from "@/lib/permissions";
import {
  previewScheduleChange,
  previewScheduleCascade,
  type CascadedItem,
  type ConstraintConflict,
  type SchedulePreview,
} from "@/lib/predecessorLink";
import { recomputeAllSchedules } from "@/lib/scheduleCascade";

export async function recomputeBoardSchedule(boardId: string): Promise<number> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  const recomputedCount = await recomputeAllSchedules(boardId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
  return recomputedCount;
}

/** Read-only: what Start/Finish/Days would become if this field were set to
 *  newValue, without applying it — powers the assignment modal's "this will
 *  move the dates, confirm?" prompt. */
export async function previewSchedule(
  /** Not trusted — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  columnId: string,
  newValue: string | number | null
): Promise<SchedulePreview | null> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  return previewScheduleChange(boardId, itemId, columnId, newValue);
}

/** Read-only: which other items a Gantt drag would drag along with it, and
 *  which pinned items it would push past their 必須完成於 — so the confirmation
 *  can say so before anything moves. */
export async function previewDragCascade(
  /** Not trusted — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  startIso: string,
  endIso: string
): Promise<{ cascaded: CascadedItem[]; conflicts: ConstraintConflict[] }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { cascaded: [], conflicts: [] };
  return previewScheduleCascade(boardId, itemId, { start, end });
}

/**
 * 這個看板上「改天數」的輸入欄:一律自動計算的看板是手動天數欄,一般看板是 Days 欄。
 * 項目卡片靠它知道哪一欄要在打字時即時預覽 Start / Finish(卡片的欄位不認得看板的排程設定)。唯讀。
 */
export async function getDurationInputColumnId(boardId: string): Promise<string | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { manualStartColumnId: true, manualDurationColumnId: true, ganttDurationColumnId: true },
  });
  if (!board) return null;
  return board.manualStartColumnId && board.manualDurationColumnId ? board.manualDurationColumnId : board.ganttDurationColumnId;
}
