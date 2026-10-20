"use server";

import { revalidatePath } from "next/cache";
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
