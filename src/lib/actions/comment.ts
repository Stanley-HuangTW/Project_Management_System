"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { notifyItemAssignees, notifyEmailIfNeeded } from "@/lib/notify";
import { findMentionedUserIds } from "@/lib/mentions";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";

export async function createComment(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  body: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("留言不可為空");

  const [comment, item] = await Promise.all([
    prisma.comment.create({
      data: { itemId, authorId: session.userId, body: trimmed },
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

  await logActivity(itemId, session.userId, "新增留言");

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
  for (const userId of mentioned) {
    await prisma.notification.create({
      data: { userId, actorId, type: "COMMENTED", itemId, message },
    });
    await notifyEmailIfNeeded(userId, "COMMENTED", message);
  }
  return mentioned;
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
