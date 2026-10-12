import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { getPersonIds } from "@/types/column";
import { computeVisibleItemIds } from "@/lib/itemVisibility";
import { restrictItemsToDmScope } from "@/lib/dmScope";
import { loadDmRestrictions } from "@/lib/dmScopeServer";

/**
 * The item ids this session may read, for the server paths that query Item
 * directly instead of going through a loaded board.
 *
 * One pass over the board rather than a check per row: every caller here is
 * about to build a list, and the answer is the same for every entry in it.
 */
export async function visibleItemIdsForBoards(
  boardIds: string[],
  session: SessionPayload
): Promise<Set<string>> {
  if (boardIds.length === 0) return new Set();

  const [items, groups, personColumns] = await Promise.all([
    prisma.item.findMany({
      where: { boardId: { in: boardIds } },
      select: {
        id: true,
        boardId: true,
        parentId: true,
        groupId: true,
        visibility: true,
        createdById: true,
        viewers: { select: { userId: true } },
        assignments: { select: { userId: true } },
        cellValues: { select: { columnId: true, value: true } },
      },
    }),
    prisma.group.findMany({
      where: { boardId: { in: boardIds } },
      select: { id: true, visibility: true, createdById: true, viewers: { select: { userId: true } } },
    }),
    prisma.column.findMany({ where: { boardId: { in: boardIds }, type: "PERSON" }, select: { id: true } }),
  ]);
  const personColumnIds = new Set(personColumns.map((c) => c.id));

  const nodes = items.map((item) => ({
    id: item.id,
    boardId: item.boardId,
    visibility: item.visibility,
    viewerIds: item.viewers.map((v) => v.userId),
    createdById: item.createdById,
    parentId: item.parentId,
    groupId: item.groupId,
    assigneeIds: [
      ...item.assignments.map((a) => a.userId),
      ...item.cellValues
        .filter((cv) => personColumnIds.has(cv.columnId))
        .flatMap((cv) => getPersonIds(cv.value)),
    ],
  }));
  const visible = computeVisibleItemIds(
    nodes,
    groups.map((group) => ({
      id: group.id,
      visibility: group.visibility,
      viewerIds: group.viewers.map((v) => v.userId),
      createdById: group.createdById,
    })),
    { userId: session.userId, isAdmin: session.role === "ADMIN" }
  );

  // DM 的可見範圍(系統設定):被限制「工作項」的看板,只留下指派給自己與同職能組員的項目與它們的上層。
  const restrictions = await loadDmRestrictions(boardIds, session);
  let result = visible;
  for (const [boardId, restriction] of restrictions) {
    if (!restriction.itemAssigneeIds) continue;
    const boardNodes = nodes.filter((n) => n.boardId === boardId);
    const kept = restrictItemsToDmScope(visible, boardNodes, {
      userId: session.userId,
      assigneeIds: restriction.itemAssigneeIds,
    });
    if (result === visible) result = new Set(visible);
    for (const n of boardNodes) if (!kept.has(n.id)) result.delete(n.id);
  }
  return result;
}

export async function visibleItemIdsForBoard(
  boardId: string,
  session: SessionPayload
): Promise<Set<string>> {
  return visibleItemIdsForBoards([boardId], session);
}
