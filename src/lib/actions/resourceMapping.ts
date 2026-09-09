"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import { notifyEmailIfNeeded } from "@/lib/notify";

export async function getDistinctTextValues(boardId: string, columnId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const cellValues = await prisma.cellValue.findMany({
    where: { columnId, item: { boardId, deletedAt: null } },
    select: { value: true },
  });

  const counts = new Map<string, number>();
  for (const cv of cellValues) {
    if (typeof cv.value === "string" && cv.value.trim()) {
      counts.set(cv.value, (counts.get(cv.value) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

export async function applyResourceMapping(
  boardId: string,
  sourceColumnId: string,
  newColumnName: string,
  targetColumnId: string | null,
  mapping: { value: string; userId: string }[],
  assignAllocation: boolean,
  allocationPct: number
) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (assignAllocation && (!Number.isFinite(allocationPct) || allocationPct < 1 || allocationPct > 100)) {
    throw new Error("人員分配百分比需介於 1 到 100 之間");
  }
  const clampedAllocationPct = Math.max(5, Math.min(100, Math.round(allocationPct / 5) * 5));

  const notifications: {
    userId: string;
    actorId: string;
    type: "ASSIGNED";
    itemId: string;
    message: string;
  }[] = [];

  const result = await prisma.$transaction(
    async (tx) => {
      let columnId = targetColumnId;
      if (!columnId) {
        const count = await tx.column.count({ where: { boardId } });
        const created = await tx.column.create({
          data: {
            boardId,
            name: newColumnName.trim() || "負責人",
            type: "PERSON",
            order: count,
            options: {},
          },
        });
        columnId = created.id;
      }

      const [sourceCells, existingTargetCells, items] = await Promise.all([
        tx.cellValue.findMany({
          where: { columnId: sourceColumnId, item: { boardId, deletedAt: null } },
          select: { itemId: true, value: true },
        }),
        tx.cellValue.findMany({
          where: { columnId, item: { boardId, deletedAt: null } },
          select: { itemId: true, value: true },
        }),
        tx.item.findMany({ where: { boardId, deletedAt: null }, select: { id: true, name: true } }),
      ]);

      const existingByItem = new Map(existingTargetCells.map((c) => [c.itemId, c.value]));
      const nameByItem = new Map(items.map((i) => [i.id, i.name]));
      const userIdByValue = new Map(mapping.map((m) => [m.value, m.userId]));

      // Mapping targets can be Resources (tools/vendors), which have no
      // account to notify or hold a real Assignment — but their 負責窗口
      // (the real person who manages that resource) should still see the
      // resource's items as their own workload, so allocation goes to the
      // manager instead when the target is a Resource.
      const uniqueMappedIds = [...new Set(mapping.map((m) => m.userId))];
      const [realUsers, mappedResources, existingAssignments] = await Promise.all([
        tx.user.findMany({ where: { id: { in: uniqueMappedIds } }, select: { id: true } }),
        tx.resource.findMany({ where: { id: { in: uniqueMappedIds } }, select: { id: true, managerId: true } }),
        tx.assignment.findMany({ where: { item: { boardId, deletedAt: null } }, select: { itemId: true, userId: true } }),
      ]);
      const realUserIds = new Set(realUsers.map((u) => u.id));
      const managerIdByResourceId = new Map(mappedResources.map((r) => [r.id, r.managerId]));
      const existingAssignmentKeys = new Set(existingAssignments.map((a) => `${a.itemId}:${a.userId}`));

      let updatedCount = 0;

      for (const cell of sourceCells) {
        if (typeof cell.value !== "string") continue;
        const userId = userIdByValue.get(cell.value);
        if (!userId) continue;
        const alreadyMapped = existingByItem.get(cell.itemId) === userId;

        if (!alreadyMapped) {
          await tx.cellValue.upsert({
            where: { itemId_columnId: { itemId: cell.itemId, columnId } },
            create: { itemId: cell.itemId, columnId, value: userId },
            update: { value: userId },
          });
          updatedCount++;
        }

        if (assignAllocation) {
          const allocationUserId = realUserIds.has(userId) ? userId : (managerIdByResourceId.get(userId) ?? null);
          const key = allocationUserId ? `${cell.itemId}:${allocationUserId}` : null;
          // Only fill in a missing allocation — never overwrite one someone
          // already set (manually, or from an earlier mapping run).
          if (allocationUserId && key && !existingAssignmentKeys.has(key)) {
            await tx.assignment.create({
              data: { itemId: cell.itemId, userId: allocationUserId, allocationPct: clampedAllocationPct },
            });
            existingAssignmentKeys.add(key);
          }
        }

        if (!alreadyMapped && userId !== session.userId && realUserIds.has(userId)) {
          const itemName = nameByItem.get(cell.itemId);
          if (itemName) {
            notifications.push({
              userId,
              actorId: session.userId,
              type: "ASSIGNED",
              itemId: cell.itemId,
              message: `你被指派到「${itemName}」`,
            });
          }
        }
      }

      if (notifications.length > 0) {
        await tx.notification.createMany({ data: notifications });
      }

      revalidatePath(`/boards/${boardId}`);
      return { updatedCount, columnId };
    },
    { timeout: 30000 }
  );

  for (const n of notifications) {
    await notifyEmailIfNeeded(n.userId, n.type, n.message);
  }

  return result;
}
