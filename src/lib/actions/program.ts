"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { recomputeAllSchedules } from "@/lib/scheduleCascade";

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
  await requireAdmin();
  const programs = await prisma.program.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      boards: { select: { id: true, name: true }, orderBy: { name: "asc" } },
    },
  });
  return programs;
}

export async function createProgram(name: string): Promise<{ error?: string }> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入群組名稱" };
  await prisma.program.create({ data: { name: trimmed } });
  revalidatePath("/settings");
  return {};
}

export async function renameProgram(programId: string, name: string): Promise<{ error?: string }> {
  await requireAdmin();
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入群組名稱" };
  await prisma.program.update({ where: { id: programId }, data: { name: trimmed } });
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
  await requireAdmin();
  await prisma.program.delete({ where: { id: programId } });
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
  await requireAdmin();
  const previous = await prisma.board.findUnique({
    where: { id: boardId },
    select: { programId: true },
  });
  await prisma.board.update({ where: { id: boardId }, data: { programId } });

  // Both networks are walked: the one it joined, and the one it left — the
  // boards left behind may have been depending on the board that just went.
  let recomputed = await recomputeAllSchedules(boardId);
  if (previous?.programId && previous.programId !== programId) {
    const sibling = await prisma.board.findFirst({
      where: { programId: previous.programId },
      select: { id: true },
    });
    if (sibling) recomputed += await recomputeAllSchedules(sibling.id);
  }

  revalidatePath("/settings");
  revalidatePath(`/boards/${boardId}`);
  return { recomputed };
}
