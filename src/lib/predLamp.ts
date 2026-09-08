import type { BoardWithData, ColumnData, ItemData } from "@/types/board";
import { classifyItemStatus, resolveStatusColumn } from "@/lib/dashboard";
import { getItemDateRange } from "@/lib/gantt";
import { buildWbsIndexFromItems, resolvePredValue } from "@/lib/predecessorLink";

/**
 * What the predecessor's own state means for THIS item:
 *  - ready:   the predecessor is done, so this task may start
 *  - waiting: the predecessor is still running (or has not started), so this
 *             task has to wait for it
 *  - blocked: the predecessor is past its own end date, so this task is being
 *             held up by a late dependency
 */
export type PredLampState = "ready" | "waiting" | "blocked";

export type PredLamp = {
  state: PredLampState;
  color: string;
  /** Names the predecessor and what it means — this is the whole point of the
   *  lamp, so it should never be a bare coloured dot with no explanation. */
  label: string;
};

/**
 * The Pred lamp for one item, or null when it has no resolvable predecessor
 * (nothing to report). Pure, so the table, the item card and the assignment
 * modal can all derive it from the group they already have loaded.
 */
export function resolvePredLamp(
  item: Pick<ItemData, "id" | "groupId" | "cellValues">,
  groupItems: ItemData[],
  board: BoardWithData,
  statusColumn: ColumnData | null,
  holidays: Set<string>
): PredLamp | null {
  if (!board.predColumnId) return null;
  const predValue = item.cellValues.find((cv) => cv.columnId === board.predColumnId)?.value;
  if (typeof predValue !== "string" || !predValue) return null;

  const index = buildWbsIndexFromItems(groupItems);
  const predId = resolvePredValue(index, item.groupId, predValue);
  const predecessor = predId ? groupItems.find((i) => i.id === predId) : undefined;
  if (!predecessor) return null;

  const range =
    board.ganttStartColumnId && board.ganttDurationColumnId
      ? getItemDateRange(
          predecessor,
          board.ganttStartColumnId,
          board.ganttDurationColumnId,
          board.ganttDurationMode,
          holidays
        )
      : null;
  const kind = classifyItemStatus(predecessor, board, statusColumn, range);
  const code = index.wbsByItemId.get(predecessor.id) ?? "";
  const named = `${code} ${predecessor.name}`.trim();

  if (kind === "done") {
    return {
      state: "ready",
      color: board.predReadyColor,
      label: `前置「${named}」已完成,此項目可以開始執行`,
    };
  }
  if (kind === "overdue") {
    return {
      state: "blocked",
      color: board.predBlockedColor,
      label: `前置「${named}」已逾期,此項目被延後執行`,
    };
  }
  return {
    state: "waiting",
    color: board.predWaitingColor,
    label:
      kind === "inProgress"
        ? `前置「${named}」進行中,要等它完成才能開始`
        : `前置「${named}」尚未開始,要等它完成才能開始`,
  };
}

/** Every item's lamp in one pass, for the table's per-row rendering. */
export function resolvePredLamps(
  groupItems: ItemData[],
  board: BoardWithData,
  holidays: Set<string>
): Map<string, PredLamp> {
  const statusColumn = resolveStatusColumn(board);
  const lamps = new Map<string, PredLamp>();
  for (const item of groupItems) {
    const lamp = resolvePredLamp(item, groupItems, board, statusColumn, holidays);
    if (lamp) lamps.set(item.id, lamp);
  }
  return lamps;
}
