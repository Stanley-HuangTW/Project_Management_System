/**
 * 可見範圍 — who may see a 專案(分組) or a 工作項.
 *
 * A team leader plans their own group's work in the open board; making a
 * group or an item PRIVATE keeps it off other departments' screens without
 * moving it out of the schedule. The dates still drive the chain — privacy
 * is about who reads a row, not about whether it exists.
 */

export type Visibility = "PUBLIC" | "PRIVATE";

export type VisibilityViewer = {
  userId: string;
  /** ADMIN sees everything, the same bypass board access already grants. */
  isAdmin: boolean;
};

export type VisibilityNode = {
  id: string;
  visibility: Visibility;
  /** Explicitly allowed, on top of the rules below. */
  viewerIds: string[];
  /** The creator always keeps sight of what they made private. */
  createdById: string | null;
};

export type VisibilityItem = VisibilityNode & {
  parentId: string | null;
  groupId: string;
  /** Whoever the work is actually assigned to — you cannot do a task you
   *  cannot see, so assigning someone grants them sight of it. */
  assigneeIds: string[];
};

function allowedOn(node: VisibilityNode, viewer: VisibilityViewer, extraIds: string[] = []): boolean {
  if (node.visibility === "PUBLIC") return true;
  if (node.createdById === viewer.userId) return true;
  if (node.viewerIds.includes(viewer.userId)) return true;
  return extraIds.includes(viewer.userId);
}

/**
 * The ids this viewer may see.
 *
 * Privacy is inherited downwards: a public subtask of a private task stays
 * hidden, because showing it would announce both the work and the parent it
 * hangs under. The same goes for everything in a private group.
 *
 * A cycle in the parent chain (which the rest of the app also guards
 * against) is treated as hidden rather than looping.
 */
export function computeVisibleItemIds(
  items: VisibilityItem[],
  groups: VisibilityNode[],
  viewer: VisibilityViewer
): Set<string> {
  if (viewer.isAdmin) return new Set(items.map((item) => item.id));

  const groupById = new Map(groups.map((group) => [group.id, group]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const cache = new Map<string, boolean>();

  function visible(id: string, seen: Set<string>): boolean {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return false;
    seen.add(id);

    const item = itemById.get(id);
    if (!item) return false;

    const group = groupById.get(item.groupId);
    let result = !group || allowedOn(group, viewer);
    if (result) result = allowedOn(item, viewer, item.assigneeIds);
    if (result && item.parentId) result = visible(item.parentId, seen);

    cache.set(id, result);
    return result;
  }

  const ids = new Set<string>();
  for (const item of items) {
    if (visible(item.id, new Set())) ids.add(item.id);
  }
  return ids;
}

/** Whether this viewer may open a group at all — a private group the viewer
 *  is not on should not even show as an empty group header. */
export function canSeeGroup(group: VisibilityNode, viewer: VisibilityViewer): boolean {
  return viewer.isAdmin || allowedOn(group, viewer);
}

/**
 * Who may change a node's 可見範圍.
 *
 * The person who owns the work, plus an ADMIN. Deliberately not "anyone who
 * can edit the item": being allowed to update a status is not the same as
 * being allowed to decide who else in the company gets to read it.
 */
export function canManageVisibility(node: VisibilityNode, viewer: VisibilityViewer): boolean {
  return viewer.isAdmin || node.createdById === viewer.userId;
}
