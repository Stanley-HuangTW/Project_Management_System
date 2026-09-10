import type { BoardWithData } from "@/types/board";
import type { SessionPayload } from "@/lib/jwt";
import { getPersonIds } from "@/types/column";
import { computeVisibleItemIds, canSeeGroup } from "@/lib/itemVisibility";

/**
 * Strips a loaded board down to what this session may see.
 *
 * Applied where boards are read for display — the board page, the dashboard,
 * search — and deliberately NOT in the scheduling engine: a hidden
 * predecessor must still push its successors, or two people looking at the
 * same task would see different dates. Privacy is about who reads a row.
 */
export function applyVisibility(board: BoardWithData, session: SessionPayload): BoardWithData {
  const viewer = { userId: session.userId, isAdmin: session.role === "ADMIN" };
  const personColumnIds = board.columns.filter((c) => c.type === "PERSON").map((c) => c.id);

  const groups = board.groups.map((group) => ({
    id: group.id,
    visibility: group.visibility,
    viewerIds: group.viewers.map((v) => v.userId),
    createdById: group.createdById,
  }));

  const visibleIds = computeVisibleItemIds(
    board.items.map((item) => ({
      id: item.id,
      visibility: item.visibility,
      viewerIds: item.viewers.map((v) => v.userId),
      createdById: item.createdById,
      parentId: item.parentId,
      groupId: item.groupId,
      // Both ways of being given the work count — the same pair
      // isItemAssignedToUser treats as equivalent everywhere else.
      assigneeIds: [
        ...item.assignments.map((a) => a.userId),
        ...item.cellValues
          .filter((cv) => personColumnIds.includes(cv.columnId))
          .flatMap((cv) => getPersonIds(cv.value)),
      ],
    })),
    groups,
    viewer
  );

  return {
    ...board,
    groups: board.groups.filter((group) =>
      canSeeGroup(
        {
          id: group.id,
          visibility: group.visibility,
          viewerIds: group.viewers.map((v) => v.userId),
          createdById: group.createdById,
        },
        viewer
      )
    ),
    items: board.items.filter((item) => visibleIds.has(item.id)),
  };
}

export function applyVisibilityToBoards(boards: BoardWithData[], session: SessionPayload): BoardWithData[] {
  return boards.map((board) => applyVisibility(board, session));
}
