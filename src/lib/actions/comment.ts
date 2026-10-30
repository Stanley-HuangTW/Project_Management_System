"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { filterInAppRecipients, notifyItemAssignees, notifyEmailIfNeeded } from "@/lib/notify";
import { findMentionedUserIds } from "@/lib/mentions";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";
import { canManageStructure } from "@/lib/permissions";
import { publishChatEvent } from "@/lib/chatServer";
import { UserError } from "@/lib/userError";

export async function createComment(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  body: string,
  /** 這則更新要不要彙整進週報(預設要)。 */
  inWeeklyReport = true
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const trimmed = body.trim();
  if (!trimmed) throw new UserError("留言不可為空");

  const [comment, item] = await Promise.all([
    prisma.comment.create({
      data: { itemId, authorId: session.userId, body: trimmed, inWeeklyReport: inWeeklyReport !== false },
    }),
    prisma.item.findUnique({ where: { id: itemId } }),
  ]);

  // Whoever was named gets told directly, before the general "someone
  // commented" that goes to the item's assignees — being @-mentioned is the
  // one notification you actually have to read, so it says what it is.
  const mentionedIds = await notifyMentions(itemId, trimmed, session.userId, session.name, item?.name);

  if (item) {
    await notifyItemAssignees(
      prisma,
      itemId,
      session.userId,
      "COMMENTED",
      `${session.name} 在「${item.name}」留言`,
      // Already told, and by name — a second, vaguer notification for the
      // same comment would just be noise.
      mentionedIds
    );
  }

  // 活動紀錄與「更新記錄」欄要看得出留言寫了什麼:帶上內容摘要(換行壓成空白、太長截短)。
  const flat = trimmed.replace(/\s+/g, " ").trim();
  await logActivity(itemId, session.userId, `新增留言:${flat.length > 80 ? `${flat.slice(0, 80)}…` : flat}`, { kind: "UPDATE" });

  // 正開著這個工作項「更新」分頁的人(包括自己的其他分頁)馬上看到;推送失敗不影響留言本身。
  try {
    await publishChatEvent({ type: "comment", c: itemId, u: session.userId, m: comment.id });
  } catch (err) {
    console.error("comment push failed:", err);
  }

  revalidatePath(`/boards/${boardId}`);
  return comment;
}

/** Notifies everyone named in a comment. Returns the ids, so the caller can
 *  leave them out of the broader assignee notification. */
async function notifyMentions(
  itemId: string,
  body: string,
  actorId: string,
  actorName: string,
  itemName: string | undefined
): Promise<string[]> {
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  const mentioned = findMentionedUserIds(body, users).filter((id) => id !== actorId);
  if (mentioned.length === 0) return [];

  const message = `${actorName} 在「${itemName ?? "項目"}」的留言中提到你`;
  const notifiableIds = await filterInAppRecipients(prisma, "COMMENTED", mentioned);
  const notifiableSet = new Set(notifiableIds);
  for (const userId of mentioned) {
    if (notifiableSet.has(userId)) {
      await prisma.notification.create({
        data: { userId, actorId, type: "COMMENTED", itemId, message },
      });
    }
    await notifyEmailIfNeeded(userId, "COMMENTED", message);
  }
  return mentioned;
}

/**
 * 改一則更新要不要彙整進週報。只有寫這則更新的人與管理者、主管可以改(別人的更新被拿掉,週報就少一段,
 * 不是任何看得到的人都能動)。
 */
export async function setCommentInWeeklyReport(itemId: string, commentId: string, value: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { itemId: true, authorId: true } });
  if (!comment || comment.itemId !== itemId) return { error: "找不到這則更新" };
  if (comment.authorId !== session.userId && !canManageStructure(session.role)) {
    return { error: "權限不足:只有寫這則更新的人、主管與管理者可以改" };
  }
  await prisma.comment.update({ where: { id: commentId }, data: { inWeeklyReport: value } });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function listComments(itemId: string) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (item) await requireBoardAccess(item.boardId, session);
  return prisma.comment.findMany({
    where: { itemId },
    orderBy: { createdAt: "asc" },
    include: { author: { select: { id: true, name: true, avatarUrl: true } } },
  });
}
