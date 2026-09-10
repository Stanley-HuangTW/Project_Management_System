"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { getStatusOptions } from "@/types/column";
import { buildWbsIndexFromItems, parsePredEntries } from "@/lib/predecessorLink";
import { computeWbsCodes } from "@/lib/wbs";
import { analyzeDelays, type DelayInput, type DelayAnalysis } from "@/lib/delayAnalysis";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";

/**
 * 延遲追因 for one board: which task moved further than the chain moved it.
 *
 * Leaf tasks only. A Summary's dates are its children's, so it is late
 * exactly when they are — listing it as a culprit would name the folder
 * instead of the work.
 */
export async function getDelayAnalysis(boardId: string): Promise<DelayAnalysis> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [board, holidayRows] = await Promise.all([
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttDurationMode: true,
        predColumnId: true,
        linkColumnId: true,
      },
    }),
    listHolidays(),
  ]);
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) {
    return { projectDelay: 0, culprits: [], noBaseline: true };
  }
  const holidays = toHolidaySet(holidayRows);

  const [items, linkColumn] = await Promise.all([
    prisma.item.findMany({
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
    }),
    board.linkColumnId
      ? prisma.column.findUnique({ where: { id: board.linkColumnId }, select: { options: true } })
      : null,
  ]);

  const linkOptions = getStatusOptions(linkColumn?.options);
  const wbsIndex = buildWbsIndexFromItems(items);
  const parentIds = new Set(items.map((i) => i.parentId).filter(Boolean));

  // WBS codes are per group, same as everywhere else they are shown.
  const wbsByItemId = new Map<string, string>();
  const byGroup = new Map<string, typeof items>();
  for (const item of items) byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
  for (const groupItems of byGroup.values()) {
    for (const [id, code] of computeWbsCodes(groupItems)) wbsByItemId.set(id, code);
  }

  const inputs: DelayInput[] = [];
  for (const item of items) {
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
      baselineStart: item.baselineStart ? new Date(item.baselineStart) : null,
      baselineEnd: item.baselineEnd ? new Date(item.baselineEnd) : null,
      baselineDays: item.baselineDays,
      currentStart: range?.start ?? null,
      currentEnd: range?.end ?? null,
      currentDays,
      preds,
    });
  }

  // Analysed over every item, reported only for the visible ones: dropping
  // a hidden predecessor before the maths would hand its slip to whatever it
  // pushed, and blame the wrong task in public.
  const analysis = analyzeDelays(inputs);
  const visibleIds = await visibleItemIdsForBoard(boardId, session);
  return { ...analysis, culprits: analysis.culprits.filter((c) => visibleIds.has(c.id)) };
}
