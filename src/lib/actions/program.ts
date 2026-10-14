"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { recomputeAllSchedules } from "@/lib/scheduleCascade";
import { logAudit } from "@/lib/activityLog";
import { applyStoredOrder } from "@/lib/sidebarOrder";

export type ProgramRow = {
  id: string;
  name: string;
  boards: { id: string; name: string }[];
};

/**
 * 專案群組 decides which boards share one schedule network, so it decides
 * whose dates can be moved by somebody else's edit. That is a wider blast
 * radius than any single board's settings, which is why it is admin-only.
 */
async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new Error("權限不足:僅管理者可以管理專案群組");
  return session;
}

export async function listPrograms(): Promise<ProgramRow[]> {
  const session = await requireAdmin();
  const [programs, me] = await Promise.all([
    prisma.program.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        boards: { where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } },
      },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { programOrder: true } }),
  ]);
  // 跟側邊欄同一份順序:管理者自己排的,沒排過的照建立時間。
  return applyStoredOrder(programs, me?.programOrder ?? []);
}

export async function createProgram(name: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入群組名稱" };
  const program = await prisma.program.create({
    data: { name: trimmed, createdById: session.userId },
  });
  await logAudit("SETTINGS", session.userId, `建立專案群組「${program.name}」`);
  revalidatePath("/settings");
  return {};
}

export async function renameProgram(programId: string, name: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入群組名稱" };
  const before = await prisma.program.findUnique({ where: { id: programId }, select: { name: true } });
  await prisma.program.update({ where: { id: programId }, data: { name: trimmed } });
  await logAudit("SETTINGS", session.userId, `專案群組改名:「${before?.name}」→「${trimmed}」`);
  revalidatePath("/settings");
  return {};
}

/**
 * Deleting the group does not touch the boards — `programId` is set to null
 * and each board goes back to being its own schedule network. Any Pred that
 * pointed across the group stops resolving, and the item holding it keeps the
 * dates it already had rather than losing them.
 */
export async function deleteProgram(programId: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const doomed = await prisma.program.findUnique({
    where: { id: programId },
    select: { name: true, boards: { where: { deletedAt: null }, select: { name: true } } },
  });
  await prisma.program.delete({ where: { id: programId } });
  // 群組一解散,跨看板的前置就停止連動——日期不會變,但從此不再互相推。
  await logAudit(
    "SETTINGS",
    session.userId,
    `刪除專案群組「${doomed?.name ?? programId}」(原含 ${doomed?.boards.length ?? 0} 個看板)`
  );
  revalidatePath("/settings");
  return {};
}

/**
 * Moves a board in or out of a group, then recomputes.
 *
 * The recompute is the point of doing this at all: joining a group makes a
 * Pred that pointed at another board's item resolvable for the first time, and
 * until something walks the network those items keep whatever dates they had
 * before anyone connected them.
 */
export async function setBoardProgram(
  boardId: string,
  programId: string | null
): Promise<{ error?: string; recomputed: number }> {
  const session = await requireAdmin();
  const previous = await prisma.board.findUnique({
    where: { id: boardId },
    select: { programId: true },
  });
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  const target = programId
    ? await prisma.program.findUnique({ where: { id: programId }, select: { name: true } })
    : null;
  await prisma.board.update({ where: { id: boardId }, data: { programId } });
  await logAudit(
    "SETTINGS",
    session.userId,
    target
      ? `看板「${board?.name}」加入專案群組「${target.name}」`
      : `看板「${board?.name}」移出專案群組`,
    boardId
  );

  // Both networks are walked: the one it joined, and the one it left — the
  // boards left behind may have been depending on the board that just went.
  let recomputed = await recomputeAllSchedules(boardId);
  if (previous?.programId && previous.programId !== programId) {
    const sibling = await prisma.board.findFirst({
      where: { programId: previous.programId, deletedAt: null },
      select: { id: true },
    });
    if (sibling) recomputed += await recomputeAllSchedules(sibling.id);
  }

  revalidatePath("/settings");
  revalidatePath(`/boards/${boardId}`);
  return { recomputed };
}
