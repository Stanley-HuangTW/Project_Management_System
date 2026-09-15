import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";

/**
 * Why this is one function returning a reason rather than a boolean: a board
 * in the trash has to be refused to everyone, admins included, but "it is in
 * the trash" and "it is not yours" are different things to be told. The
 * callers below each pick what to do with the distinction.
 */
async function boardAccessState(
  session: SessionPayload,
  boardId: string
): Promise<"ok" | "missing" | "trashed" | "denied"> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true, visibility: true, deletedAt: true },
  });
  if (!board) return "missing";
  // A trashed board is closed for reading and writing until it is restored.
  // Nothing may keep working on it — not the schedule, not the budget, not an
  // admin — or a restore would bring back something that had gone on changing
  // while it was supposedly deleted.
  if (board.deletedAt) return "trashed";
  if (session.role === "ADMIN") return "ok";
  if (board.visibility === "PUBLIC") return "ok";
  if (board.ownerId === session.userId) return "ok";

  const member = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: session.userId } },
  });
  return member ? "ok" : "denied";
}

/**
 * ADMIN always has access. Otherwise: public boards are open to everyone;
 * restricted boards are only visible to their owner and explicit members.
 * A board in the trash is open to nobody.
 */
export async function canAccessBoard(
  session: SessionPayload,
  boardId: string
): Promise<boolean> {
  return (await boardAccessState(session, boardId)) === "ok";
}

export async function requireBoardAccess(boardId: string, session: SessionPayload) {
  const state = await boardAccessState(session, boardId);
  if (state === "ok") return;
  if (state === "trashed") {
    throw new Error("這個看板在垃圾桶裡,要先還原才能使用");
  }
  throw new Error("權限不足:你沒有這個看板的存取權限");
}

/**
 * Looks up itemId's REAL board and checks access against that — never trust
 * a client-supplied boardId for this. A caller who has access to some board
 * of their own could otherwise pass that board's id alongside an itemId
 * belonging to a different (possibly RESTRICTED) board and pass the check
 * purely because *some* board they named happens to be accessible, even
 * though the item being read/written isn't on it. Returns the item's real
 * boardId so callers use it going forward instead of whatever was passed
 * in. Throws if the item doesn't exist or access is denied.
 */
export async function requireItemBoardAccess(
  itemId: string,
  session: SessionPayload
): Promise<string> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (!item) {
    throw new Error("項目不存在");
  }
  await requireBoardAccess(item.boardId, session);
  return item.boardId;
}

/** Same as requireItemBoardAccess, but for actions keyed by a groupId
 *  instead of an itemId (item creation, which has no itemId yet). */
export async function requireGroupBoardAccess(
  groupId: string,
  session: SessionPayload
): Promise<string> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { boardId: true } });
  if (!group) {
    throw new Error("分組不存在");
  }
  await requireBoardAccess(group.boardId, session);
  return group.boardId;
}

/** Prisma `where` fragment selecting only boards the session can access.
 *  Trashed boards are in nobody's list. */
export function accessibleBoardWhere(session: SessionPayload): Prisma.BoardWhereInput {
  if (session.role === "ADMIN") return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [
      { visibility: "PUBLIC" },
      { ownerId: session.userId },
      { members: { some: { userId: session.userId } } },
    ],
  };
}
