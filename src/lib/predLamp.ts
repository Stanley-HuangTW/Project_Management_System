import type { BoardWithData, ColumnData, ItemData } from "@/types/board";
import { classifyItemStatus, resolveStatusColumn } from "@/lib/dashboard";
import { getItemDateRange } from "@/lib/gantt";
import { buildWbsIndexFromItems, resolvePredValues } from "@/lib/predecessorLink";
import { lateFinishOf } from "@/lib/lateFinish";

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
  holidays: Set<string>,
  /** 工作項 id → 切成完成的時間(ISO)。給了才會抓「前置實際完成得比預定晚、這個項目還排在它完成之前開始」。 */
  completedAt?: Readonly<Record<string, string | undefined>>
): PredLamp | null {
  if (!board.predColumnId) return null;
  const predValue = item.cellValues.find((cv) => cv.columnId === board.predColumnId)?.value;
  if (typeof predValue !== "string" || !predValue) return null;

  const index = buildWbsIndexFromItems(groupItems);
  const predecessors = resolvePredValues(index, item.groupId, predValue)
    .map((predId) => groupItems.find((i) => i.id === predId))
    .filter((p): p is ItemData => !!p);
  if (predecessors.length === 0) return null;

  const named = (predecessor: ItemData) =>
    `${index.wbsByItemId.get(predecessor.id) ?? ""} ${predecessor.name}`.trim();
  const kindOf = (predecessor: ItemData) => {
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
    return classifyItemStatus(predecessor, board, statusColumn, range);
  };

  const graded = predecessors.map((predecessor) => ({ predecessor, kind: kindOf(predecessor) }));

  // With several predecessors the lamp reports the one holding this item up:
  // a late one beats a running one beats "all done". Saying 可以開始 while any
  // of them is unfinished would be exactly the wrong signal.
  const blocked = graded.filter((g) => g.kind === "overdue");
  if (blocked.length > 0) {
    return {
      state: "blocked",
      color: board.predBlockedColor,
      label: `前置${blocked.map((g) => `「${named(g.predecessor)}」`).join("")}已逾期,此項目被延後執行`,
    };
  }
  const pending = graded.filter((g) => g.kind !== "done");
  if (pending.length > 0) {
    const running = pending.filter((g) => g.kind === "inProgress");
    const names = pending.map((g) => `「${named(g.predecessor)}」`).join("");
    return {
      state: "waiting",
      color: board.predWaitingColor,
      label:
        running.length === pending.length
          ? `前置${names}進行中,要等它完成才能開始`
          : `前置${names}尚未完成,要等它完成才能開始`,
    };
  }
  // 前置都完成了——但如果有前置是晚於預定才完成,而這個項目的排程還是在它實際完成之前就開始,
  // 就不能說「可以開始」:要告訴 PM 這個項目的時程需要順延(原計畫在基準線,仍可比較)。
  const rangeOf = (it: Pick<ItemData, "cellValues">) =>
    board.ganttStartColumnId && board.ganttDurationColumnId
      ? getItemDateRange(it, board.ganttStartColumnId, board.ganttDurationColumnId, board.ganttDurationMode, holidays)
      : null;
  const ownStart = rangeOf(item)?.start.toISOString().slice(0, 10) ?? null;
  const lateDone = graded
    .map((g) => {
      const end = rangeOf(g.predecessor)?.end.toISOString().slice(0, 10) ?? null;
      const late = lateFinishOf(end, completedAt?.[g.predecessor.id]);
      return late && ownStart !== null && ownStart <= late.actualDate ? { predecessor: g.predecessor, late } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (lateDone.length > 0) {
    return {
      state: "blocked",
      color: board.predBlockedColor,
      label: `前置${lateDone
        .map((x) => `「${named(x.predecessor)}」預定 ${x.late.plannedEnd.slice(5)} 完成、實際 ${x.late.actualDate.slice(5)} 才完成(晚 ${x.late.daysLate} 天)`)
        .join("、")},此項目目前排 ${ownStart!.slice(5)} 開始,需要順延`,
    };
  }
  return {
    state: "ready",
    color: board.predReadyColor,
    label: `前置${graded.map((g) => `「${named(g.predecessor)}」`).join("")}已完成,此項目可以開始執行`,
  };
}

/** Every item's lamp in one pass, for the table's per-row rendering. */
export function resolvePredLamps(
  groupItems: ItemData[],
  board: BoardWithData,
  holidays: Set<string>,
  completedAt?: Readonly<Record<string, string | undefined>>
): Map<string, PredLamp> {
  const statusColumn = resolveStatusColumn(board);
  const lamps = new Map<string, PredLamp>();
  for (const item of groupItems) {
    const lamp = resolvePredLamp(item, groupItems, board, statusColumn, holidays, completedAt);
    if (lamp) lamps.set(item.id, lamp);
  }
  return lamps;
}
