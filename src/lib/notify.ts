import type { Prisma, NotificationType } from "@prisma/client";
import { getPersonIds } from "@/types/column";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { DEFAULT_NOTIFICATION_PREFERENCE } from "@/lib/notificationTypes";

const DEFAULT_IN_APP: Record<NotificationType, boolean> = Object.fromEntries(
  Object.entries(DEFAULT_NOTIFICATION_PREFERENCE).map(([t, p]) => [t, p.inApp])
) as Record<NotificationType, boolean>;
const DEFAULT_EMAIL: Record<NotificationType, boolean> = Object.fromEntries(
  Object.entries(DEFAULT_NOTIFICATION_PREFERENCE).map(([t, p]) => [t, p.email])
) as Record<NotificationType, boolean>;

/**
 * Sends an email for this notification type, if every gate allows it:
 * an ADMIN has turned email notifications on at all
 * (SystemSettings.emailNotificationsEnabled, off by default), the ADMIN
 * hasn't disabled this type system-wide (enabledNotificationTypes), and the
 * user themselves hasn't turned email off for this type (defaults above when
 * they've never set a preference). Doesn't apply to transactional mail like
 * password resets, which go through sendMail directly. Runs outside any DB
 * transaction since it makes a network call.
 */
export async function notifyEmailIfNeeded(
  userId: string,
  type: NotificationType,
  message: string
) {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" } });
  if (!settings?.emailNotificationsEnabled) return;
  if (!settings.enabledNotificationTypes.includes(type)) return;
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_type: { userId, type } },
  });
  const wantsEmail = pref ? pref.email : DEFAULT_EMAIL[type];
  if (!wantsEmail) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (user) await sendMail(user.email, "工作管理平台通知", message);
}

/**
 * 從一串候選收件人裡,篩出「這個類型真的要顯示在站內通知」的人——先看
 * 管理者有沒有把這個類型整個關掉(關了的話誰都不會收到),再看每個人自己
 * 有沒有關掉這個類型的站內通知(沒設定過就用 DEFAULT_IN_APP)。
 */
export async function filterInAppRecipients(
  tx: Prisma.TransactionClient | typeof prisma,
  type: NotificationType,
  userIds: string[]
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const settings = await tx.systemSettings.findUnique({ where: { id: "global" } });
  if (settings && !settings.enabledNotificationTypes.includes(type)) return [];
  const prefs = await tx.notificationPreference.findMany({
    where: { userId: { in: userIds }, type },
    select: { userId: true, inApp: true },
  });
  const prefByUserId = new Map(prefs.map((p) => [p.userId, p.inApp]));
  return userIds.filter((id) => prefByUserId.get(id) ?? DEFAULT_IN_APP[type]);
}

/**
 * 結構變動(新增、刪除一列)的收件人比指派廣一圈:除了被指派的人與看板
 * 擁有者,同一個分組的成員與有分組角色的人也都收得到。一列被加進來或
 * 拿掉,動到的是整張排程網路,不只那一列上掛著名字的人。
 */
export async function notifyStructuralChange(
  tx: Prisma.TransactionClient,
  itemId: string,
  actorId: string,
  type: NotificationType,
  message: string
) {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: {
      board: { select: { ownerId: true } },
      group: {
        select: {
          members: { select: { userId: true } },
          roleAssignments: { select: { userId: true } },
        },
      },
    },
  });
  if (!item) return;

  const recipientIds = new Set<string>([item.board.ownerId]);
  for (const m of item.group.members) recipientIds.add(m.userId);
  for (const r of item.group.roleAssignments) recipientIds.add(r.userId);

  const [personCellValues, assignments] = await Promise.all([
    tx.cellValue.findMany({ where: { itemId, column: { type: "PERSON" } } }),
    tx.assignment.findMany({ where: { itemId }, select: { userId: true } }),
  ]);
  for (const cv of personCellValues) {
    for (const userId of getPersonIds(cv.value)) recipientIds.add(userId);
  }
  for (const a of assignments) recipientIds.add(a.userId);
  recipientIds.delete(actorId);
  if (recipientIds.size === 0) return;

  // PERSON 欄位裡也可能是 Resource(治具/廠商),那些沒有帳號可以通知。
  const realUsers = await tx.user.findMany({
    where: { id: { in: Array.from(recipientIds) } },
    select: { id: true },
  });
  if (realUsers.length === 0) return;

  const notifiableIds = await filterInAppRecipients(
    tx,
    type,
    realUsers.map((u) => u.id)
  );
  if (notifiableIds.length === 0) return;

  await tx.notification.createMany({
    data: notifiableIds.map((userId) => ({ userId, actorId, type, itemId, message })),
  });
}

/**
 * Notifies everyone assigned to an item — via any PERSON column or a Gantt
 * Assignment (the two mechanisms isItemAssignedToUser treats as equivalent
 * everywhere else) — plus the board owner, excluding whoever triggered the
 * change.
 */
export async function notifyItemAssignees(
  tx: Prisma.TransactionClient,
  itemId: string,
  actorId: string,
  type: NotificationType,
  message: string,
  /** Already told about this change by a more specific notification — an
   *  @-mention, say — so a second, vaguer one would just be noise. */
  excludeUserIds: string[] = []
) {
  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: { board: { select: { ownerId: true } } },
  });
  if (!item) return;

  const [personCellValues, assignments] = await Promise.all([
    tx.cellValue.findMany({ where: { itemId, column: { type: "PERSON" } } }),
    tx.assignment.findMany({ where: { itemId }, select: { userId: true } }),
  ]);

  const recipientIds = new Set<string>();
  for (const cv of personCellValues) {
    for (const userId of getPersonIds(cv.value)) recipientIds.add(userId);
  }
  for (const a of assignments) recipientIds.add(a.userId);
  recipientIds.add(item.board.ownerId);
  recipientIds.delete(actorId);
  for (const id of excludeUserIds) recipientIds.delete(id);

  if (recipientIds.size === 0) return;

  // PERSON columns can also hold Resource ids (tools/vendors), which have no
  // account to notify — only real Users can be notification recipients.
  const realUsers = await tx.user.findMany({
    where: { id: { in: Array.from(recipientIds) } },
    select: { id: true },
  });
  const realUserIds = new Set(realUsers.map((u) => u.id));
  const realRecipientIds = Array.from(recipientIds).filter((id) => realUserIds.has(id));

  const notifiableIds = await filterInAppRecipients(tx, type, realRecipientIds);
  if (notifiableIds.length === 0) return;

  await tx.notification.createMany({
    data: notifiableIds.map((userId) => ({
      userId,
      actorId,
      type,
      itemId,
      message,
    })),
  });
}
