"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { computeWbsCodes } from "@/lib/wbs";

export async function listNotifications() {
  const session = await requireSession();
  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 30,
    include: { item: { select: { id: true, name: true, boardId: true, groupId: true } } },
  });

  // WBS codes aren't stored — they're each item's position among its group's
  // siblings — so recompute them per group, batched across all 30 notifications'
  // groups at once instead of one query per notification.
  const groupIds = [...new Set(notifications.map((n) => n.item.groupId))];
  const groupItems = groupIds.length
    ? await prisma.item.findMany({
        where: { groupId: { in: groupIds }, deletedAt: null },
        select: { id: true, parentId: true, order: true, groupId: true },
      })
    : [];
  const itemsByGroup = new Map<string, typeof groupItems>();
  for (const item of groupItems) {
    const list = itemsByGroup.get(item.groupId) ?? [];
    list.push(item);
    itemsByGroup.set(item.groupId, list);
  }
  const wbsByGroup = new Map(
    [...itemsByGroup].map(([groupId, items]) => [groupId, computeWbsCodes(items)])
  );

  return notifications.map((n) => ({
    ...n,
    wbsCode: wbsByGroup.get(n.item.groupId)?.get(n.item.id),
  }));
}

export async function getUnreadCount() {
  const session = await requireSession();
  return prisma.notification.count({
    where: { userId: session.userId, read: false },
  });
}

export async function markNotificationRead(id: string) {
  const session = await requireSession();
  await prisma.notification.updateMany({
    where: { id, userId: session.userId },
    data: { read: true },
  });
}

export async function markAllNotificationsRead() {
  const session = await requireSession();
  await prisma.notification.updateMany({
    where: { userId: session.userId, read: false },
    data: { read: true },
  });
}
