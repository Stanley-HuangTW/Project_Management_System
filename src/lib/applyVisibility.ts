import type { BoardWithData } from "@/types/board";
import type { SessionPayload } from "@/lib/jwt";
import { getPersonIds } from "@/types/column";
import { computeVisibleItemIds, canSeeGroup } from "@/lib/itemVisibility";
import { resolveDmRestriction, restrictItemsToDmScope, type DmScopeSettings } from "@/lib/dmScope";

/**
 * Strips a loaded board down to what this session may see.
 *
 * Applied where boards are read for display — the board page, the dashboard,
 * search — and deliberately NOT in the scheduling engine: a hidden
 * predecessor must still push its successors, or two people looking at the
 * same task would see different dates. Privacy is about who reads a row.
 *
 * 再加上 DM 的可見範圍:系統設定裡打開了某個職能的「工作項」限制,那個職能的 DM 只看得到指派給自己與
 * 同職能組員的項目(加上它們的上層)。settings 一定要傳,不給預設值——漏傳就會悄悄變成不限制。
 */
export function applyVisibility(board: BoardWithData, session: SessionPayload, dmSettings: DmScopeSettings): BoardWithData {
  const viewer = { userId: session.userId, isAdmin: session.role === "ADMIN" };
  const personColumnIds = board.columns.filter((c) => c.type === "PERSON").map((c) => c.id);

  const groups = board.groups.map((group) => ({
    id: group.id,
    visibility: group.visibility,
    viewerIds: group.viewers.map((v) => v.userId),
    createdById: group.createdById,
  }));

  const nodes = board.items.map((item) => ({
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
  }));
  let visibleIds = computeVisibleItemIds(nodes, groups, viewer);

  const restriction = resolveDmRestriction({
    userId: session.userId,
    isAdmin: viewer.isAdmin,
    isBoardOwner: board.ownerId === session.userId,
    roles: board.groups.flatMap((g) => g.roleAssignments).filter((a) => a.userId === session.userId),
    members: board.groups.flatMap((g) => g.members),
    settings: dmSettings,
  });
  if (restriction?.itemAssigneeIds) {
    visibleIds = restrictItemsToDmScope(visibleIds, nodes, {
      userId: session.userId,
      assigneeIds: restriction.itemAssigneeIds,
    });
  }

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

export function applyVisibilityToBoards(
  boards: BoardWithData[],
  session: SessionPayload,
  dmSettings: DmScopeSettings
): BoardWithData[] {
  return boards.map((board) => applyVisibility(board, session, dmSettings));
}
