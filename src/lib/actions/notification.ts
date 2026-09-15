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
    include: {
      item: {
        select: {
          id: true,
          name: true,
          boardId: true,
          groupId: true,
          deletedAt: true,
          board: { select: { name: true } },
          group: { select: { name: true } },
        },
      },
    },
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

  // actorId 只是個字串欄位,沒有 relation 可以 include —— 一次把名字查回來,
  // 而不是每一筆通知各查一次。「誰改了什麼」少了誰就只剩一半。
  const actorIds = [...new Set(notifications.map((n) => n.actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
    : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  return notifications.map((n) => ({
    ...n,
    boardName: n.item.board.name,
    groupName: n.item.group.name,
    actorName: n.actorId ? (actorName.get(n.actorId) ?? null) : null,
    // 已經在垃圾桶裡的項目,點過去也高亮不到 —— 先講清楚。
    trashed: n.item.deletedAt !== null,
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
