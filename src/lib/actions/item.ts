"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canManageGroupStructure, canModifyItemSchedule, requireStructureAccess } from "@/lib/permissions";
import { requireBoardAccess, requireGroupBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";
import { notifyStructuralChange } from "@/lib/notify";
import { getStatusOptions } from "@/types/column";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import {
  buildWbsIndexFromItems,
  resolvePredValues,
  parsePredEntries,
  formatPredEntries,
  type PredEntry,
} from "@/lib/predecessorLink";
import { syncPredecessorSchedule } from "@/lib/scheduleCascade";
import { getItemDateRange } from "@/lib/gantt";
import { loadTypeOptionIds, flipParentToSummary, restoreParentTypeIfChildless } from "@/lib/summaryType";
import { collectSubtreeIds, type PredSnapshotEntry } from "@/lib/trash";
import { resolveItemMove, computeLvlDelta, type DropZone } from "@/lib/dragReorder";
import { dispatchWebhooks } from "@/lib/webhooks";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import type { SessionPayload } from "@/lib/jwt";

/** Item creation/structure edits are normally ADMIN/SUPERVISOR-only, but a
 *  group's TEAM_LEADER/SW_DM/HW_DM/ME_DM/QA also gets structure rights
 *  scoped to that one group — see canManageGroupStructure. Also verifies the
 *  caller actually has board-level access to this group's own board — an
 *  ADMIN/SUPERVISOR role alone isn't a blanket bypass of RESTRICTED board
 *  visibility (only ADMIN and PUBLIC/owned/member boards are, per
 *  canAccessBoard), so this can't be satisfied by naming an unrelated group
 *  on a board the caller happens to have access to. Returns the group's
 *  real boardId. */
export async function requireGroupStructureAccess(session: SessionPayload, groupId: string): Promise<string> {
  const boardId = await requireGroupBoardAccess(groupId, session);
  const { access } = await loadGroupRoleContext(groupId, session.userId);
  if (!canManageGroupStructure(session.role, access.disciplines.size > 0)) {
    throw new Error("權限不足:僅管理者、主管或此分組的負責角色可以執行此操作");
  }
  return boardId;
}

// Matches boardWithDataArgs's items.include shape, so a freshly created item
// can be dropped straight into UI state (e.g. to reopen its detail modal)
// without waiting on the page's next full refetch.
const itemDetailInclude = {
  cellValues: true,
  viewers: { select: { userId: true } },
  _count: { select: { comments: true } },
  assignments: { include: { user: { select: { id: true, name: true } } } },
} as const;

/** 負責人 = the creating user, Priority = Normal, Status = Planned,
 *  start(set) = today, duration = 0 — defaults every newly created item
 *  gets, whether it's a new child (createItem) or a new sibling
 *  (insertItem). Each only applies if the matching column exists on the
 *  board (by name) — boards without these columns are unaffected. Pred is
 *  deliberately not defaulted — see insertItem/buildNewItemCellValues. */
function buildDefaultCellValues(
  columns: { id: string; name: string; type: string; options: unknown }[],
  userId: string
): { columnId: string; value: string | number }[] {
  const cellValues: { columnId: string; value: string | number }[] = [];

  const ownerColumn = columns.find((c) => c.name === "負責人" && c.type === "PERSON");
  if (ownerColumn) cellValues.push({ columnId: ownerColumn.id, value: userId });

  const priorityColumn = columns.find((c) => c.name === "Priority" && c.type === "STATUS");
  if (priorityColumn) {
    const normal = getStatusOptions(priorityColumn.options).find((o) => o.label.toUpperCase() === "NORMAL");
    if (normal) cellValues.push({ columnId: priorityColumn.id, value: normal.id });
  }

  const statusColumn = columns.find((c) => c.name === "Status" && c.type === "STATUS");
  if (statusColumn) {
    const planned = getStatusOptions(statusColumn.options).find((o) => o.label.toLowerCase() === "planned");
    if (planned) cellValues.push({ columnId: statusColumn.id, value: planned.id });
  }

  const startSetColumn = columns.find((c) => c.name === "start(set)" && c.type === "DATE");
  if (startSetColumn) {
    cellValues.push({ columnId: startSetColumn.id, value: new Date().toISOString().slice(0, 10) });
  }

  const durationColumn = columns.find((c) => c.name === "duration" && c.type === "NUMBER");
  if (durationColumn) cellValues.push({ columnId: durationColumn.id, value: 0 });

  return cellValues;
}

/** A new sub-item inherits sensible defaults from its parent/board instead
 *  of starting blank: Lvl = parent's Lvl + 1, plus the shared defaults from
 *  buildDefaultCellValues. Each only applies if the matching column exists
 *  on the board (by name) — boards created before these conventions, or
 *  without a Gantt start column mapped, are unaffected. */
async function buildNewItemCellValues(
  boardId: string,
  groupId: string,
  parentId: string | undefined,
  userId: string
): Promise<{
  typeColumnId: string | null;
  summaryOptionId: string | undefined;
  alwaysComputedTrigger: string | null;
  cellValues: { columnId: string; value: string | number }[];
}> {
  const [board, parent] = await Promise.all([
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        typeColumnId: true,
        ganttStartColumnId: true,
        manualStartColumnId: true,
        manualDurationColumnId: true,
        columns: { select: { id: true, name: true, type: true, options: true } },
      },
    }),
    parentId
      ? prisma.item.findUnique({ where: { id: parentId }, select: { cellValues: true } })
      : Promise.resolve(null),
  ]);
  const typeIds = await loadTypeOptionIds(board?.typeColumnId ?? null);

  const cellValues: { columnId: string; value: string | number }[] = [];
  if (board?.typeColumnId && typeIds?.taskId) {
    cellValues.push({ columnId: board.typeColumnId, value: typeIds.taskId });
  }

  const columns = board?.columns ?? [];

  const lvlColumn = columns.find((c) => c.name === "Lvl" && c.type === "NUMBER");
  if (lvlColumn && parent) {
    const parentLvl = parent.cellValues.find((cv) => cv.columnId === lvlColumn.id)?.value;
    if (typeof parentLvl === "number") {
      cellValues.push({ columnId: lvlColumn.id, value: parentLvl + 1 });
    }
  }

  cellValues.push(...buildDefaultCellValues(columns, userId));

  // In "always computed" boards, Start/Days/Finish are locked and derived
  // from manualStartColumnId/manualDurationColumnId — writing Start directly
  // here would just get overwritten (and violate the lock's own invariant).
  // Only start(set) gets today (via buildDefaultCellValues above);
  // syncPredecessorSchedule below computes the rest.
  const alwaysComputed = !!board?.manualStartColumnId && !!board?.manualDurationColumnId;
  if (board?.ganttStartColumnId && !alwaysComputed) {
    cellValues.push({ columnId: board.ganttStartColumnId, value: new Date().toISOString().slice(0, 10) });
  }

  return {
    typeColumnId: board?.typeColumnId ?? null,
    summaryOptionId: typeIds?.summaryId,
    alwaysComputedTrigger: alwaysComputed ? board!.manualStartColumnId : null,
    cellValues,
  };
}

export async function createItem(
  /** Not trusted — see requireGroupStructureAccess below, which derives the
   *  group's real board instead of taking the caller's word for it. */
  _boardId: string,
  groupId: string,
  name: string,
  parentId?: string
) {
  const session = await requireSession();
  const boardId = await requireGroupStructureAccess(session, groupId);
  if (parentId) {
    const parent = await prisma.item.findUnique({ where: { id: parentId }, select: { groupId: true } });
    if (!parent || parent.groupId !== groupId) {
      throw new Error("父項目不屬於此分組");
    }
  }
  const trimmed = name.trim() || "未命名項目";

  const [count, { typeColumnId, summaryOptionId, alwaysComputedTrigger, cellValues }] = await Promise.all([
    prisma.item.count({ where: parentId ? { parentId } : { groupId, parentId: null } }),
    buildNewItemCellValues(boardId, groupId, parentId, session.userId),
  ]);

  let item = await prisma.item.create({
    data: {
      boardId,
      groupId,
      name: trimmed,
      order: count,
      parentId,
      createdById: session.userId,
      cellValues: { create: cellValues },
    },
    include: itemDetailInclude,
  });

  if (parentId && typeColumnId && summaryOptionId) {
    await flipParentToSummary(parentId, typeColumnId, summaryOptionId);
  }

  if (alwaysComputedTrigger) {
    await syncPredecessorSchedule(boardId, item.id, alwaysComputedTrigger);
    item = await prisma.item.findUniqueOrThrow({ where: { id: item.id }, include: itemDetailInclude });
  }

  await notifyStructuralChange(prisma, item.id, session.userId, "CREATED", "新增了這個項目");
  await dispatchWebhooks(boardId, "item.created", { itemId: item.id, name: item.name, groupId, parentId });

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  return item;
}

export async function insertItem(
  /** Not trusted — see requireGroupStructureAccess below, which derives the
   *  group's real board instead of taking the caller's word for it. */
  _boardId: string,
  groupId: string,
  parentId: string | null,
  referenceItemId: string,
  position: "before" | "after"
) {
  const session = await requireSession();
  const boardId = await requireGroupStructureAccess(session, groupId);

  const [reference, board] = await Promise.all([
    prisma.item.findUnique({ where: { id: referenceItemId }, include: { cellValues: true } }),
    prisma.board.findUnique({
      where: { id: boardId },
      select: {
        typeColumnId: true,
        manualStartColumnId: true,
        manualDurationColumnId: true,
        columns: { select: { id: true, name: true, type: true, options: true } },
      },
    }),
  ]);
  if (!reference || reference.groupId !== groupId) throw new Error("找不到參考項目");
  const typeIds = await loadTypeOptionIds(board?.typeColumnId ?? null);

  const targetOrder = position === "before" ? reference.order : reference.order + 1;

  const columns = board?.columns ?? [];
  const cellValues: { columnId: string; value: string | number }[] = [];
  if (board?.typeColumnId && typeIds?.taskId) {
    cellValues.push({ columnId: board.typeColumnId, value: typeIds.taskId });
  }
  // Inserted as a sibling of `reference`, so its Lvl should match reference's
  // own Lvl — not parent's Lvl + 1 (that's only correct for a new *child*,
  // see buildNewItemCellValues).
  const lvlColumn = columns.find((c) => c.name === "Lvl" && c.type === "NUMBER");
  if (lvlColumn) {
    const referenceLvl = reference.cellValues.find((cv) => cv.columnId === lvlColumn.id)?.value;
    if (typeof referenceLvl === "number") {
      cellValues.push({ columnId: lvlColumn.id, value: referenceLvl });
    }
  }
  cellValues.push(...buildDefaultCellValues(columns, session.userId));

  const [, created] = await prisma.$transaction([
    prisma.item.updateMany({
      where: { groupId, parentId, order: { gte: targetOrder } },
      data: { order: { increment: 1 } },
    }),
    prisma.item.create({
      data: {
        boardId,
        groupId,
        parentId,
        name: "新項目",
        order: targetOrder,
        createdById: session.userId,
        cellValues: { create: cellValues },
      },
      include: itemDetailInclude,
    }),
  ]);
  let item = created;

  // Same as createItem: with start(set)=today and duration=0 now set (see
  // buildDefaultCellValues), an "always computed" board can already resolve
  // this item's own Start/Days/Finish — compute and persist them immediately
  // instead of leaving the new row blank until some other edit triggers it.
  if (board?.manualStartColumnId && board?.manualDurationColumnId) {
    await syncPredecessorSchedule(boardId, created.id, board.manualStartColumnId);
    item = await prisma.item.findUniqueOrThrow({ where: { id: created.id }, include: itemDetailInclude });
  }

  await notifyStructuralChange(prisma, created.id, session.userId, "CREATED", "新增了這個項目");

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  return item;
}

/**
 * 拖曳重新排列/改階層——只能在同一個 Group 內移動,拖到別的 Group 是
 * moveItemToGroup 的事,這裡不處理。放開的位置(zone)決定結果,算法見
 * resolveItemMove(src/lib/dragReorder.ts)。
 */
export async function moveItemWithinGroup(
  /** Not trusted — see requireGroupStructureAccess below. */
  _boardId: string,
  groupId: string,
  draggedItemId: string,
  targetItemId: string,
  zone: DropZone
) {
  const session = await requireSession();
  const boardId = await requireGroupStructureAccess(session, groupId);

  const [dragged, target, groupItems, board] = await Promise.all([
    prisma.item.findUnique({ where: { id: draggedItemId }, select: { id: true, groupId: true, cellValues: true } }),
    prisma.item.findUnique({ where: { id: targetItemId }, select: { id: true, groupId: true } }),
    prisma.item.findMany({ where: { groupId, deletedAt: null }, select: { id: true, parentId: true, order: true } }),
    prisma.board.findUnique({
      where: { id: boardId },
      select: { typeColumnId: true, columns: { select: { id: true, name: true, type: true } } },
    }),
  ]);
  // 就算前端不會這樣呼叫,後端也不能只信前端——兩邊都一定要屬於傳入的這個 Group。
  if (!dragged || dragged.groupId !== groupId) throw new Error("找不到要搬移的項目");
  if (!target || target.groupId !== groupId) throw new Error("找不到目標項目");

  const result = resolveItemMove(groupItems, draggedItemId, targetItemId, zone);
  if (!result.ok) {
    const messages: Record<typeof result.reason, string> = {
      "not-found": "找不到項目",
      self: "不能把項目拖放到自己身上",
      descendant: "不能把項目拖放到自己的子項目下面",
      "no-parent-to-outdent-to": "目標項目已經是最上層,無法再外移一層",
      "invalid-zone": "不支援的搬移方式",
    };
    throw new Error(messages[result.reason]);
  }

  const oldParentId = groupItems.find((i) => i.id === draggedItemId)?.parentId ?? null;
  const newParentId = result.writes.find((w) => w.id === draggedItemId)?.parentId ?? oldParentId;

  await prisma.$transaction(
    result.writes.map((w) => prisma.item.update({ where: { id: w.id }, data: { parentId: w.parentId, order: w.order } }))
  );

  // Lvl 連動——只有父層真的換了、而且 board 有設定 Lvl 欄位才做。新父層自己沒有數字
  // Lvl 值的話整段跳過,不捏造數值(跟 buildNewItemCellValues 的保護一致)。
  const lvlColumn = board?.columns.find((c) => c.name === "Lvl" && c.type === "NUMBER");
  if (lvlColumn && newParentId !== oldParentId) {
    const oldLvl = dragged.cellValues.find((cv) => cv.columnId === lvlColumn.id)?.value;
    if (typeof oldLvl === "number") {
      const newParent = newParentId
        ? await prisma.item.findUnique({ where: { id: newParentId }, select: { cellValues: true } })
        : null;
      const newParentLvl = newParent?.cellValues.find((cv) => cv.columnId === lvlColumn.id)?.value;
      if (newParentId === null || typeof newParentLvl === "number") {
        const delta = computeLvlDelta(oldLvl, newParentId === null ? null : (newParentLvl as number));
        if (delta !== 0) {
          const subtreeIds = collectSubtreeIds(groupItems, draggedItemId);
          const subtreeLvlCells = await prisma.cellValue.findMany({
            where: { itemId: { in: subtreeIds }, columnId: lvlColumn.id },
          });
          await prisma.$transaction(
            subtreeLvlCells
              .filter((cv) => typeof cv.value === "number")
              .map((cv) => prisma.cellValue.update({ where: { id: cv.id }, data: { value: (cv.value as number) + delta } }))
          );
        }
      }
    }
  }

  // Type=Summary 連動——跟 createItem/deleteItem 現有的呼叫方式一致,只有父層真的
  // 換了才做。
  if (newParentId !== oldParentId && board?.typeColumnId) {
    const typeIds = await loadTypeOptionIds(board.typeColumnId);
    if (newParentId && typeIds?.summaryId) {
      await flipParentToSummary(newParentId, board.typeColumnId, typeIds.summaryId);
    }
    if (oldParentId) {
      await restoreParentTypeIfChildless(oldParentId, board.typeColumnId);
    }
  }

  await notifyStructuralChange(prisma, draggedItemId, session.userId, "UPDATED", "拖曳搬移了這個項目的位置");

  revalidatePath(`/boards/${boardId}`);
}

export async function renameItem(
  /** Not trusted — see requireGroupStructureAccess below, which derives the
   *  item's real board instead of taking the caller's word for it. */
  _boardId: string,
  itemId: string,
  name: string
) {
  const session = await requireSession();
  const trimmed = name.trim() || "未命名項目";

  const existing = await prisma.item.findUnique({ where: { id: itemId }, select: { name: true, groupId: true } });
  if (!existing) throw new Error("找不到項目");
  const boardId = await requireGroupStructureAccess(session, existing.groupId);
  await prisma.item.update({ where: { id: itemId }, data: { name: trimmed } });
  if (existing.name !== trimmed) {
    await logActivity(itemId, session.userId, `項目名稱從「${existing.name}」改為「${trimmed}」`);
  }
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteItem(
  /** Not trusted — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  /** True: items that used this one as their Pred take over its own Pred, so
   *  the chain closes up. False (the default): their Pred is cleared and the
   *  caller is expected to tell the user which ones now need a schedule rule
   *  of their own. */
  repointDependents = false
) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { boardId: true, createdById: true, parentId: true, name: true },
  });
  if (!item) throw new Error("找不到項目");
  await requireBoardAccess(item.boardId, session);
  requireStructureAccess(session.role);
  if (!canModifyItemSchedule(session.role, item.createdById, session.userId)) {
    throw new Error("權限不足:僅建立者或管理者可以刪除此項目");
  }

  const { dependentIds, snapshot } = await rewriteDependentPreds(item.boardId, itemId, repointDependents);

  // Trashed, not deleted: the row stays with its comments, files and history,
  // and every read path filters it out — see listTrashedItems / restoreItem.
  // The children go with it, which the database used to cascade for us.
  const boardItems = await prisma.item.findMany({
    where: { boardId: item.boardId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  const deletedAt = new Date();
  await prisma.item.updateMany({
    where: { id: { in: collectSubtreeIds(boardItems, itemId) } },
    data: { deletedAt, deletedById: session.userId },
  });
  await prisma.item.update({
    where: { id: itemId },
    data: { deletedPredSnapshot: snapshot.length > 0 ? snapshot : Prisma.JsonNull },
  });

  await notifyStructuralChange(
    prisma,
    itemId,
    session.userId,
    "DELETED",
    dependentIds.length > 0
      ? `刪除了這個項目(移到垃圾桶),另有 ${dependentIds.length} 個項目的前置被改寫`
      : "刪除了這個項目(移到垃圾桶)"
  );
  await dispatchWebhooks(item.boardId, "item.deleted", { itemId, name: item.name });

  const dependents = dependentIds;
  const board = await prisma.board.findUnique({
    where: { id: item.boardId },
    select: { predColumnId: true, typeColumnId: true },
  });

  // This may have been the parent's last child, in which case it is not a
  // Summary any more — put back the Type it had before it was given children.
  if (item.parentId && board?.typeColumnId) {
    await restoreParentTypeIfChildless(item.parentId, board.typeColumnId);
  }

  // Their predecessor changed, so their dates are stale — recompute from
  // whatever rule each one now has (an inherited Pred, or its own start(set)).
  if (board?.predColumnId) {
    for (const dependentId of dependents) {
      await syncPredecessorSchedule(item.boardId, dependentId, board.predColumnId);
    }
  }

  revalidatePath(`/boards/${item.boardId}`);
  revalidatePath("/dashboard");
}

/** Every item whose Pred resolves to `itemId`, with the Pred column id. */
async function loadDependents(boardId: string, itemId: string) {
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { predColumnId: true } });
  if (!board?.predColumnId) return { predColumnId: null, dependents: [], index: null, items: [] };
  const predColumnId = board.predColumnId;
  const items = await prisma.item.findMany({
    where: { boardId, deletedAt: null },
    select: { id: true, name: true, parentId: true, order: true, groupId: true, cellValues: true },
  });
  const index = buildWbsIndexFromItems(items);
  const dependents = items.filter((i) => {
    if (i.id === itemId) return false;
    const value = i.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    return resolvePredValues(index, i.groupId, value).includes(itemId);
  });
  return { predColumnId, dependents, index, items };
}

/**
 * Rewrites each dependent's Pred list, dropping the item being deleted and
 * optionally putting its own predecessors in that slot.
 *
 * Only the deleted entry is touched: an item that waits on three things and
 * loses one of them still waits on the other two.
 */
async function rewriteDependentPreds(
  boardId: string,
  itemId: string,
  inherit: boolean
): Promise<{ dependentIds: string[]; snapshot: PredSnapshotEntry[] }> {
  const { predColumnId, dependents, index } = await loadDependents(boardId, itemId);
  if (!predColumnId || !index || dependents.length === 0) return { dependentIds: [], snapshot: [] };

  let inherited: PredEntry[] = [];
  if (inherit) {
    const deleted = await prisma.item.findUnique({
      where: { id: itemId },
      select: { groupId: true, cellValues: true },
    });
    const ownPredRaw = deleted?.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    // The deleted item's own edges, relationships and all — the dependents
    // are taking over its place in the chain, not just its position.
    inherited = deleted ? parsePredEntries(index, deleted.groupId, ownPredRaw) : [];
  }

  const snapshot: PredSnapshotEntry[] = [];
  for (const dependent of dependents) {
    const current = dependent.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
    // Recorded before it is overwritten, so a restore can put it back.
    snapshot.push({
      itemId: dependent.id,
      columnId: predColumnId,
      value: typeof current === "string" ? current : null,
    });
    // Parsed and rewritten as entries, so the other edges keep whatever
    // relationship and lag they were given.
    const kept = parsePredEntries(index, dependent.groupId, current).filter((e) => e.itemId !== itemId);
    const next = formatPredEntries([...kept, ...inherited].filter((e) => e.itemId !== dependent.id));
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: dependent.id, columnId: predColumnId } },
      create: { itemId: dependent.id, columnId: predColumnId, value: next ?? Prisma.JsonNull },
      update: { value: next ?? Prisma.JsonNull },
    });
  }
  return { dependentIds: dependents.map((d) => d.id), snapshot };
}

/** One item that depends on the item about to be deleted. */
export type DeletionDependent = {
  itemId: string;
  wbsCode: string;
  name: string;
  start: string | null;
  end: string | null;
};

export type DeletionImpact = {
  name: string;
  dependents: DeletionDependent[];
  /** The deleted item's own predecessor, which its dependents could take
   *  over — null when it has none, so there is nothing to inherit. */
  inherit: { name: string; wbsCode: string } | null;
};

/** What deleting this item would do to the items that use it as their Pred —
 *  read-only, so the user can decide before anything is removed. */
export async function previewItemDeletion(itemId: string): Promise<DeletionImpact | null> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const target = await prisma.item.findUnique({
    where: { id: itemId },
    select: { name: true, groupId: true, cellValues: true },
  });
  if (!target) return null;

  const [{ predColumnId, dependents, index }, board, holidayRows] = await Promise.all([
    loadDependents(boardId, itemId),
    prisma.board.findUnique({
      where: { id: boardId },
      select: { ganttStartColumnId: true, ganttDurationColumnId: true, ganttDurationMode: true },
    }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  function rangeOf(item: { cellValues: { columnId: string; value: unknown }[] }) {
    if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) return { start: null, end: null };
    const range = getItemDateRange(
      item as Parameters<typeof getItemDateRange>[0],
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttDurationMode,
      holidays
    );
    if (!range) return { start: null, end: null };
    return { start: range.start.toISOString().slice(0, 10), end: range.end.toISOString().slice(0, 10) };
  }

  const ownPredRaw = predColumnId
    ? target.cellValues.find((cv) => cv.columnId === predColumnId)?.value
    : undefined;
  // Only the first is named in the prompt — with several, the wording would
  // stop being a sentence; the rest are inherited all the same.
  const inheritedId = index ? resolvePredValues(index, target.groupId, ownPredRaw)[0] : undefined;
  const inherited = inheritedId
    ? await prisma.item.findUnique({ where: { id: inheritedId }, select: { name: true } })
    : null;

  return {
    name: target.name,
    dependents: dependents.map((d) => ({
      itemId: d.id,
      wbsCode: index?.wbsByItemId.get(d.id) ?? "",
      name: d.name,
      ...rangeOf(d),
    })),
    inherit:
      inherited && inheritedId
        ? { name: inherited.name, wbsCode: index?.wbsByItemId.get(inheritedId) ?? "" }
        : null,
  };
}

export async function moveItemToGroup(
  /** Not trusted — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  groupId: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  requireStructureAccess(session.role);

  const targetGroup = await prisma.group.findUnique({ where: { id: groupId }, select: { boardId: true } });
  if (!targetGroup || targetGroup.boardId !== boardId) {
    throw new Error("目標分組不屬於此項目所在的看板");
  }

  const count = await prisma.item.count({ where: { groupId } });
  await prisma.item.update({
    where: { id: itemId },
    data: { groupId, order: count },
  });
  revalidatePath(`/boards/${boardId}`);
}

export async function reorderItems(
  boardId: string,
  items: { id: string; order: number; groupId: string }[]
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  const itemIds = items.map((i) => i.id);
  const groupIds = [...new Set(items.map((i) => i.groupId))];
  const [existingItems, existingGroups] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, boardId: true } }),
    prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, boardId: true } }),
  ]);
  const allOnThisBoard =
    existingItems.length === itemIds.length &&
    existingItems.every((i) => i.boardId === boardId) &&
    existingGroups.length === groupIds.length &&
    existingGroups.every((g) => g.boardId === boardId);
  if (!allOnThisBoard) {
    throw new Error("項目或分組不屬於此看板");
  }

  await prisma.$transaction(
    items.map((item) =>
      prisma.item.update({
        where: { id: item.id },
        data: { order: item.order, groupId: item.groupId },
      })
    )
  );
  revalidatePath(`/boards/${boardId}`);
}
