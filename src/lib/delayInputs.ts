import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { getStatusOptions } from "@/types/column";
import { buildWbsIndexFromItems, parsePredEntries } from "@/lib/predecessorLink";
import { computeWbsCodes } from "@/lib/wbs";
import type { DelayInput } from "@/lib/delayAnalysis";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";

export type GatheredDelays = {
  inputs: DelayInput[];
  /** Union across the boards — who may be named in the result. */
  visibleIds: Set<string>;
};

/**
 * The planned-vs-actual dates every task carries, over one board or a whole
 * 專案群組.
 *
 * Several boards are read together, with ONE index over all their items,
 * because of what happens otherwise: a Pred pointing at a task on another
 * board would fail to resolve, the edge would vanish, and the slip that task
 * inherited would be counted as its own. 延遲追因 would then name the wrong
 * task — confidently, and in public.
 *
 * Leaf tasks only. A Summary's dates are its children's, so it is late exactly
 * when they are; listing it would name the folder instead of the work.
 */
export async function gatherDelayInputs(
  boardIds: string[],
  session: SessionPayload
): Promise<GatheredDelays> {
  const holidays = toHolidaySet(await listHolidays());

  const boards = await prisma.board.findMany({
    where: { id: { in: boardIds } },
    select: {
      id: true,
      ganttStartColumnId: true,
      ganttDurationColumnId: true,
      ganttDurationMode: true,
      predColumnId: true,
      linkColumnId: true,
    },
  });

  const itemsByBoard = new Map<string, Awaited<ReturnType<typeof loadItems>>>();
  for (const board of boards) itemsByBoard.set(board.id, await loadItems(board.id));

  const allItems = [...itemsByBoard.values()].flat();
  // One index over every board, so a cross-board Pred still finds its target.
  const wbsIndex = buildWbsIndexFromItems(allItems);
  const parentIds = new Set(allItems.map((i) => i.parentId).filter(Boolean));

  // WBS codes stay per group even now that a Pred may cross one: a code is a
  // position within its own group's tree, and that has not changed.
  const wbsByItemId = new Map<string, string>();
  const byGroup = new Map<string, typeof allItems>();
  for (const item of allItems) byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
  for (const groupItems of byGroup.values()) {
    for (const [id, code] of computeWbsCodes(groupItems)) wbsByItemId.set(id, code);
  }

  const inputs: DelayInput[] = [];
  const visibleIds = new Set<string>();

  for (const board of boards) {
    for (const id of await visibleItemIdsForBoard(board.id, session)) visibleIds.add(id);
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;

    const linkColumn = board.linkColumnId
      ? await prisma.column.findUnique({ where: { id: board.linkColumnId }, select: { options: true } })
      : null;
    const linkOptions = getStatusOptions(linkColumn?.options);

    for (const item of itemsByBoard.get(board.id) ?? []) {
      if (parentIds.has(item.id)) continue;

      const range = getItemDateRange(
        item,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidays
      );
      // The Days cell, not a count of the range: the baseline stored that
      // same cell, and a milestone whose cell says 0 would otherwise look one
      // day longer than planned simply because a range spans one day.
      const daysValue = item.cellValues.find((cv) => cv.columnId === board.ganttDurationColumnId)?.value;
      const currentDays = typeof daysValue === "number" ? Math.round(daysValue) : null;

      // Which end of each predecessor actually drives this task — the same
      // per-edge relationship the scheduler uses, falling back to the item's
      // own Link column.
      const fallback = board.linkColumnId
        ? linkOptions.find(
            (o) => o.id === item.cellValues.find((cv) => cv.columnId === board.linkColumnId)?.value
          )?.label
        : undefined;
      const predValue = board.predColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.predColumnId)?.value
        : undefined;
      const preds = parsePredEntries(wbsIndex, item.groupId, predValue).map((entry) => {
        const relationship = entry.relationship ?? fallback;
        return {
          predId: entry.itemId,
          uses: (relationship === "SS" || relationship === "SF" ? "start" : "end") as "start" | "end",
        };
      });

      inputs.push({
        id: item.id,
        name: item.name,
        wbsCode: wbsByItemId.get(item.id) ?? "",
        boardId: board.id,
        baselineStart: item.baselineStart ? new Date(item.baselineStart) : null,
        baselineEnd: item.baselineEnd ? new Date(item.baselineEnd) : null,
        baselineDays: item.baselineDays,
        currentStart: range?.start ?? null,
        currentEnd: range?.end ?? null,
        currentDays,
        preds,
      });
    }
  }

  return { inputs, visibleIds };
}

function loadItems(boardId: string) {
  return prisma.item.findMany({
    where: { boardId, deletedAt: null },
    select: {
      id: true,
      name: true,
      parentId: true,
      order: true,
      groupId: true,
      baselineStart: true,
      baselineEnd: true,
      baselineDays: true,
      cellValues: true,
    },
  });
}
