import { revalidatePath } from "next/cache";
import {
  syncPredecessorSchedule as runSync,
  recomputeAllSchedules as runRecomputeAll,
  rollUpSummaries as runRollUp,
} from "@/lib/predecessorLink";

/**
 * The cascade, plus the page refreshes it implies.
 *
 * This lives apart from predecessorLink because that module is also imported
 * by client components for its pure helpers, and anything reaching
 * revalidatePath cannot be — so the engine reports which boards it wrote to
 * and this is where that turns into a refresh.
 *
 * Every caller already refreshes the board the edit came from. What it cannot
 * know is that in a 專案群組 the same edit moves dates on a sibling board:
 * without the refresh here, whoever is looking at that board keeps seeing the
 * old ones until something else happens to invalidate it.
 */
export async function syncPredecessorSchedule(
  boardId: string,
  itemId: string,
  editedColumnId: string
): Promise<void> {
  const boardIds = await runSync(boardId, itemId, editedColumnId);
  refreshSiblings(boardIds, boardId);
}

/** 結構變了(新增、搬移、刪除、還原項目)之後,受影響的父項(Summary)重新取子項的起訖。 */
export async function rollUpSummaryDates(boardId: string, parentIds: (string | null | undefined)[]): Promise<void> {
  const ids = [...new Set(parentIds.filter((id): id is string => !!id))];
  const boardIds = await runRollUp(boardId, ids);
  refreshSiblings(boardIds, boardId);
}

export async function recomputeAllSchedules(boardId: string): Promise<number> {
  const { count, boardIds } = await runRecomputeAll(boardId);
  refreshSiblings(boardIds, boardId);
  return count;
}

function refreshSiblings(boardIds: string[], editedBoardId: string) {
  for (const id of boardIds) {
    if (id !== editedBoardId) revalidatePath(`/boards/${id}`);
  }
}
