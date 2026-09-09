"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { canModifyItemSchedule, requireStructureAccess } from "@/lib/permissions";
import { syncPredecessorSchedule } from "@/lib/predecessorLink";
import { logActivity } from "@/lib/activityLog";
import { getStatusOptions } from "@/types/column";
import { collectSubtreeIds, parsePredSnapshot } from "@/lib/trash";

export type TrashedItem = {
  id: string;
  name: string;
  groupName: string;
  deletedAt: string;
  deletedBy: string | null;
  /** How many children went into the trash with it. */
  childCount: number;
};

/**
 * What is in this board's trash — only the items that were deleted in their
 * own right. A child that went in with its parent is not listed separately:
 * it comes back with the parent, and listing it would offer a restore that
 * has nowhere to put it.
 */
export async function listTrashedItems(boardId: string): Promise<TrashedItem[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const deleted = await prisma.item.findMany({
    where: { boardId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      name: true,
      parentId: true,
      deletedAt: true,
      deletedBy: { select: { name: true } },
      group: { select: { name: true } },
    },
  });

  const deletedIds = new Set(deleted.map((i) => i.id));

  return deleted
    .filter((item) => !item.parentId || !deletedIds.has(item.parentId))
    .map((item) => ({
      id: item.id,
      name: item.name,
      groupName: item.group.name,
      deletedAt: item.deletedAt!.toISOString(),
      deletedBy: item.deletedBy?.name ?? null,
      childCount: countSubtree(deleted, item.id) - 1,
    }));
}

/** The trashed subtree under `rootId`, root included — used only for the
 *  "還有 N 個子項目" counts. */
function countSubtree(items: { id: string; parentId: string | null }[], rootId: string): number {
  return collectSubtreeIds(items, rootId).length;
}

/**
 * Puts an item back: the item and everything that went into the trash with
 * it, the dependents' Pred cells that the deletion rewrote, and the parent's
 * Summary type. Then re-runs the schedule, because all of that moves dates.
 */
export async function restoreItem(itemId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      boardId: true,
      parentId: true,
      createdById: true,
      deletedAt: true,
      deletedPredSnapshot: true,
      name: true,
    },
  });
  if (!item || !item.deletedAt) return { error: "找不到這個已刪除的項目" };
  await requireBoardAccess(item.boardId, session);
  requireStructureAccess(session.role);
  if (!canModifyItemSchedule(session.role, item.createdById, session.userId)) {
    return { error: "權限不足:僅建立者或管理者可以還原此項目" };
  }

  // Restoring a child into a parent that is itself in the trash would put it
  // nowhere the user can see it.
  if (item.parentId) {
    const parent = await prisma.item.findUnique({
      where: { id: item.parentId },
      select: { name: true, deletedAt: true },
    });
    if (!parent) return { error: "父項目已不存在,無法還原" };
    if (parent.deletedAt) return { error: `請先還原父項目「${parent.name}」` };
  }

  const trashed = await prisma.item.findMany({
    where: { boardId: item.boardId, deletedAt: item.deletedAt },
    select: { id: true, parentId: true },
  });
  // Only what went in with this item, not a child trashed on its own earlier
  // — that one stays in the trash until someone asks for it back.
  await prisma.item.updateMany({
    where: { id: { in: collectSubtreeIds(trashed, itemId) } },
    data: { deletedAt: null, deletedById: null },
  });
  await prisma.item.update({ where: { id: itemId }, data: { deletedPredSnapshot: Prisma.JsonNull } });

  const snapshot = parsePredSnapshot(item.deletedPredSnapshot);
  const live = await prisma.item.findMany({
    where: { id: { in: snapshot.map((s) => s.itemId) }, deletedAt: null },
    select: { id: true },
  });
  const liveIds = new Set(live.map((i) => i.id));
  for (const entry of snapshot) {
    if (!liveIds.has(entry.itemId)) continue;
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: entry.itemId, columnId: entry.columnId } },
      create: { itemId: entry.itemId, columnId: entry.columnId, value: entry.value ?? Prisma.JsonNull },
      update: { value: entry.value ?? Prisma.JsonNull },
    });
  }

  const board = await prisma.board.findUnique({
    where: { id: item.boardId },
    select: { predColumnId: true, typeColumnId: true },
  });

  // The parent has a child again, so it is a Summary again.
  if (item.parentId && board?.typeColumnId) {
    const column = await prisma.column.findUnique({
      where: { id: board.typeColumnId },
      select: { options: true },
    });
    const summaryId = getStatusOptions(column?.options).find((o) => o.label === "Summary")?.id;
    if (summaryId) {
      await prisma.cellValue.upsert({
        where: { itemId_columnId: { itemId: item.parentId, columnId: board.typeColumnId } },
        create: { itemId: item.parentId, columnId: board.typeColumnId, value: summaryId },
        update: { value: summaryId },
      });
    }
  }

  if (board?.predColumnId) {
    await syncPredecessorSchedule(item.boardId, itemId, board.predColumnId);
    for (const entry of snapshot) {
      if (liveIds.has(entry.itemId)) await syncPredecessorSchedule(item.boardId, entry.itemId, board.predColumnId);
    }
  }

  await logActivity(itemId, session.userId, "從垃圾桶還原");
  revalidatePath(`/boards/${item.boardId}`);
  revalidatePath("/dashboard");
  return {};
}

/** Deletes a trashed item for good, children and all. This is the one that
 *  cannot be undone. */
export async function purgeItem(itemId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { boardId: true, createdById: true, deletedAt: true },
  });
  if (!item || !item.deletedAt) return { error: "找不到這個已刪除的項目" };
  await requireBoardAccess(item.boardId, session);
  requireStructureAccess(session.role);
  if (!canModifyItemSchedule(session.role, item.createdById, session.userId)) {
    return { error: "權限不足:僅建立者或管理者可以永久刪除此項目" };
  }

  // The database cascades the children, their cells, comments and history.
  await prisma.item.delete({ where: { id: itemId } });
  revalidatePath(`/boards/${item.boardId}`);
  return {};
}
