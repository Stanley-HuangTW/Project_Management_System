import type { Prisma, NotificationType } from "@prisma/client";
import { getPersonIds } from "@/types/column";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { mailBody } from "@/lib/appUrl";
import { DEFAULT_NOTIFICATION_PREFERENCE } from "@/lib/notificationTypes";
import { riskLink } from "@/lib/notificationLink";

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
  message: string,
  /** 站內的相對路徑(例如 /boards/xxx?highlight=yyy):有的話信裡會附上完整網址,收信的人可以直接點開。 */
  link?: string
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
  if (user) await sendMail(user.email, "工作管理平台通知", mailBody(message, link));
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

/**
 * 簽核類的通知(「簽核」這一種類型):有東西等你簽、或你送出的簽核有結果了,都走這裡。
 *
 * link 是點下去要去的站內路徑(信裡也附完整網址);riskId 讓風險 / 議題的通知照原本的方式標在那一筆上。
 * 操作的人自己不收;dedupeUnread 給「同一種待簽事項一直進來」的情況(例如每填一筆工時就多一筆待簽):
 * 這個人已經有一則同樣內容、還沒讀的通知,就不再多發一則。通知失敗不影響簽核本身,呼叫端不用 try/catch。
 */
export async function notifyApproval(params: {
  userIds: string[];
  actorId: string | null;
  message: string;
  link: string;
  riskId?: string;
  dedupeUnread?: boolean;
}) {
  const { actorId, message, link, riskId } = params;
  try {
    let userIds = [...new Set(params.userIds)].filter((id) => id !== actorId);
    if (userIds.length === 0) return;
    if (params.dedupeUnread) {
      const already = await prisma.notification.findMany({
        where: { userId: { in: userIds }, type: "APPROVAL", read: false, link, message },
        select: { userId: true },
      });
      const skip = new Set(already.map((n) => n.userId));
      userIds = userIds.filter((id) => !skip.has(id));
      if (userIds.length === 0) return;
    }
    const inApp = await filterInAppRecipients(prisma, "APPROVAL", userIds);
    if (inApp.length > 0) {
      await prisma.notification.createMany({
        data: inApp.map((userId) => ({ userId, actorId, type: "APPROVAL" as const, riskId: riskId ?? null, link, message })),
      });
    }
    for (const userId of userIds) {
      try {
        await notifyEmailIfNeeded(userId, "APPROVAL", message, link);
      } catch {
        // 寄信失敗不影響簽核本身。
      }
    }
  } catch {
    // 通知寫不進去不能讓簽核失敗。
  }
}

/** 負責人申請結案:通知每一位審核人「等你審核」(畫面上風險列那顆紅色標籤,通知裡也要有)。 */
export async function notifyRiskReviewRequested(
  riskId: string,
  actorId: string,
  risk: { title: string; kindLabel: string },
  reviewerIds: string[]
) {
  const [actor, row] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { name: true } }),
    prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } }),
  ]);
  if (!row) return;
  await notifyApproval({
    userIds: reviewerIds,
    actorId,
    riskId,
    link: riskLink(row.boardId, riskId),
    message: `${actor?.name ?? "負責人"}申請結案${risk.kindLabel}「${risk.title}」,等你審核`,
  });
}

/** 審核人處理了結案申請:通知負責人(退回要附原因;全部同意 = 已結案;還沒到全部同意就告訴他進度)。 */
export async function notifyRiskReviewResult(
  riskId: string,
  reviewerId: string,
  result: { kind: "rejected"; reason: string } | { kind: "approved"; approved: number; total: number } | { kind: "closed" }
) {
  const [reviewer, risk] = await Promise.all([
    prisma.user.findUnique({ where: { id: reviewerId }, select: { name: true } }),
    prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true, ownerId: true, title: true, kind: true } }),
  ]);
  if (!risk?.ownerId) return;
  const kindLabel = risk.kind === "ISSUE" ? "議題" : "風險";
  const who = reviewer?.name ?? "審核人";
  const message =
    result.kind === "rejected"
      ? `${who}退回了${kindLabel}「${risk.title}」的結案申請:${result.reason}`
      : result.kind === "closed"
        ? `${kindLabel}「${risk.title}」的結案申請已通過(全部審核人都同意),已結案`
        : `${who}同意了${kindLabel}「${risk.title}」的結案申請(${result.approved}/${result.total})`;
  await notifyApproval({ userIds: [risk.ownerId], actorId: reviewerId, riskId, link: riskLink(risk.boardId, riskId), message });
}

/**
 * 風險/議題被指派:通知新的負責人與新的審核人(站內通知「指派」,Email 照每個人的設定)。
 * 不通知自己指派自己;同一個人又是負責人又是審核人只通知一次(以負責人為準)。
 * 系統(例如 Mantis 同步)指派的沒有操作者,actorId 傳 null。
 */
export async function notifyRiskAssigned(
  riskId: string,
  actorId: string | null,
  risk: { title: string; kindLabel: string },
  assigned: { ownerId?: string | null; reviewerIds?: string[] }
) {
  const messages = new Map<string, string>();
  for (const id of assigned.reviewerIds ?? []) {
    messages.set(id, `你被指定為${risk.kindLabel}「${risk.title}」的審核人`);
  }
  if (assigned.ownerId) messages.set(assigned.ownerId, `你被指派為${risk.kindLabel}「${risk.title}」的負責人`);
  if (actorId) messages.delete(actorId);
  const userIds = [...messages.keys()];
  if (userIds.length === 0) return;

  const riskBoardId = (await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } }))?.boardId;
  const inApp = await filterInAppRecipients(prisma, "ASSIGNED", userIds);
  if (inApp.length > 0) {
    await prisma.notification.createMany({
      data: inApp.map((userId) => ({ userId, actorId, type: "ASSIGNED" as const, riskId, message: messages.get(userId)! })),
    });
  }
  for (const userId of userIds) {
    try {
      await notifyEmailIfNeeded(userId, "ASSIGNED", messages.get(userId)!, riskBoardId ? riskLink(riskBoardId, riskId) : undefined);
    } catch {
      // 寄信失敗不影響指派本身。
    }
  }
}
