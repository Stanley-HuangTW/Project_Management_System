"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { buildWbsIndexFromItems, type RelationshipType } from "@/lib/predecessorLink";
import { dependencyChain, dependencyEdgesOf, orderDependencyChain, type DependencyEdge } from "@/lib/dependencyChain";
import { externalRowsOf } from "@/lib/externalPredecessors";
import { boardWithDataArgs, type BoardWithData, type ExternalPredecessor } from "@/types/board";
import { getStatusOptions } from "@/types/column";

const RELATIONSHIPS: RelationshipType[] = ["FS", "FF", "SS", "SF"];

export type DependencyChainResult = {
  /** 鏈上的每個項目(含勾選的),前置在前、後續在後。 */
  order: string[];
  /** 鏈上項目之間的相依(畫箭頭用)。 */
  edges: DependencyEdge[];
  /** 鏈上不在這個看板的項目(同群組的其他看板),畫成唯讀列。 */
  external: ExternalPredecessor[];
};

/**
 * 甘特圖「相依檢視」:勾選的工作項整條前置鏈與後續鏈。看板屬於群組(Program)時,
 * 跨看板的前置與後續也一起找 —— 跟甘特圖平常的「跨看板前置」列一樣,看得到這個看板
 * 就看得到同群組其他看板上的這幾列。
 */
export async function loadDependencyChain(boardId: string, seedIds: string[]): Promise<DependencyChainResult> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const home = await prisma.board.findUnique({ where: { id: boardId }, select: { programId: true } });
  const boards: BoardWithData[] = await prisma.board.findMany({
    where: home?.programId ? { programId: home.programId, deletedAt: null } : { id: boardId },
    ...boardWithDataArgs,
  });
  const homeBoard = boards.find((b) => b.id === boardId);
  if (!homeBoard) return { order: [], edges: [], external: [] };

  const seeds = seedIds.filter((id) => homeBoard.items.some((i) => i.id === id));
  const allItems = boards.flatMap((b) => b.items);
  const index = buildWbsIndexFromItems(allItems);

  const edges = boards.flatMap((board) => {
    const linkLabels = new Map(
      getStatusOptions(board.columns.find((c) => c.id === board.linkColumnId)?.options).map((o) => [o.id, o.label])
    );
    return dependencyEdgesOf(
      board.items.map((item) => {
        const cell = (columnId: string | null) => item.cellValues.find((cv) => cv.columnId === columnId)?.value;
        const link = linkLabels.get(String(cell(board.linkColumnId) ?? ""));
        return {
          id: item.id,
          groupId: item.groupId,
          predValue: board.predColumnId ? cell(board.predColumnId) : null,
          linkRelationship: RELATIONSHIPS.includes(link as RelationshipType) ? (link as RelationshipType) : null,
          constraintRefItemId: item.constraintRefItemId,
        };
      }),
      index
    );
  });

  const chain = dependencyChain(edges, seeds);
  const holidays = toHolidaySet(await listHolidays());

  // 同一層的先後:開始日期早的在上;沒排日期的放最後。
  const startOf = new Map<string, number>();
  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    for (const item of board.items) {
      if (!chain.has(item.id)) continue;
      const range = getItemDateRange(item, board.ganttStartColumnId, board.ganttDurationColumnId, board.ganttDurationMode, holidays);
      if (range) startOf.set(item.id, range.start.getTime());
    }
  }

  return {
    order: orderDependencyChain(chain, edges, (id) => startOf.get(id) ?? Number.MAX_SAFE_INTEGER),
    edges: edges.filter((e) => chain.has(e.predId) && chain.has(e.succId)),
    external: boards
      .filter((b) => b.id !== boardId)
      .flatMap((b) => externalRowsOf(b, (item) => chain.has(item.id), holidays)),
  };
}
