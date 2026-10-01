"use server";

import { revalidatePath } from "next/cache";
import type { NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { computeWbsCodes } from "@/lib/wbs";
import { ALL_NOTIFICATION_TYPES, DEFAULT_NOTIFICATION_PREFERENCE } from "@/lib/notificationTypes";

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

export type NotificationPreferenceRow = {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
};

/** 全部 6 種類型都回傳一列——沒特別設定過的就用預設值補上,呼叫端不用
 *  自己管「這個類型有沒有存過」。 */
export async function getMyNotificationPreferences(): Promise<NotificationPreferenceRow[]> {
  const session = await requireSession();
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: session.userId },
  });
  const byType = new Map(rows.map((r) => [r.type, r]));
  return ALL_NOTIFICATION_TYPES.map((type) => {
    const row = byType.get(type);
    return row
      ? { type, inApp: row.inApp, email: row.email }
      : { type, ...DEFAULT_NOTIFICATION_PREFERENCE[type] };
  });
}

export async function setMyNotificationPreference(
  type: NotificationType,
  patch: { inApp?: boolean; email?: boolean }
) {
  const session = await requireSession();
  const existing = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId: session.userId, type } },
  });
  const base = existing ?? { ...DEFAULT_NOTIFICATION_PREFERENCE[type] };
  await prisma.notificationPreference.upsert({
    where: { userId_type: { userId: session.userId, type } },
    create: {
      userId: session.userId,
      type,
      inApp: patch.inApp ?? base.inApp,
      email: patch.email ?? base.email,
    },
    update: {
      inApp: patch.inApp ?? base.inApp,
      email: patch.email ?? base.email,
    },
  });
  revalidatePath("/", "layout");
}
