"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import type { SessionPayload } from "@/lib/jwt";
import type { BoardVisibility, Prisma } from "@prisma/client";
import { STATUS_OPTIONS } from "@/lib/statusDefaults";
import { parseDefaultColumns } from "@/lib/defaultColumns";
import { getStatusOptions } from "@/types/column";

async function requireBoardOwnerOrAdmin(boardId: string, session: SessionPayload) {
  if (session.role === "ADMIN") return;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
  if (board?.ownerId !== session.userId) {
    throw new Error("權限不足:僅看板擁有者或管理者可以管理分享設定");
  }
}

export async function createBoard(name: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("看板名稱不可為空");

  // 階層顏色/計算方式/甘特圖顏色 are app-wide settings kept as a copy on every
  // board (see setLevelColors). The broadcast that maintains those copies only
  // reaches boards that already exist, so a board made afterwards has to take
  // its copy here — otherwise it silently falls back to the schema defaults
  // and shows none of the colors the admin set.
  const settings = await getSystemSettings();
  // 新看板預設欄位, set from 系統設定 (usually by copying a board that is
  // already laid out the way this company's projects actually look), falling
  // back to the built-in list when nobody has set one.
  const defaultColumns = parseDefaultColumns(settings.defaultColumns);

  const board = await prisma.board.create({
    data: {
      name: trimmed,
      ownerId: session.userId,
      levelColors: settings.levelColors,
      ganttDurationMode: settings.ganttDurationMode,
      ganttOverdueColor: settings.ganttOverdueColor,
      ganttCompletedColor: settings.ganttCompletedColor,
      ganttInProgressColor: settings.ganttInProgressColor,
      predReadyColor: settings.predReadyColor,
      predWaitingColor: settings.predWaitingColor,
      predBlockedColor: settings.predBlockedColor,
      groups: {
        create: [{ name: "項目", order: 0 }],
      },
      columns: {
        create: defaultColumns.map((c, order) => ({
          name: c.name,
          type: c.type,
          options: c.options as Prisma.InputJsonValue,
          order,
        })),
      },
    },
    include: { columns: true },
  });

  // Wiring by name, so a column the configured default does not include simply
  // leaves that setting unset (undefined is skipped by Prisma) rather than
  // pointing at nothing.
  const byName = new Map(board.columns.map((c) => [c.name, c.id]));

  // Read off the Status column that actually got created — a default copied
  // from an existing board carries that board's own option ids, and the
  // built-in ones would name options this board does not have.
  const statusColumn = board.columns.find((c) => c.name === "Status");
  const statusOptions = getStatusOptions(statusColumn?.options);
  const optionId = (label: string) =>
    statusOptions.find((o) => o.label === label)?.id ??
    STATUS_OPTIONS.find((o) => o.label === label)?.id;
  const doneOptionId = optionId("Completed");
  const plannedOptionId = optionId("Planned");

  await prisma.board.update({
    where: { id: board.id },
    data: {
      progressColumnId: byName.get("% Done"),
      ganttStartColumnId: byName.get("Start"),
      ganttDurationColumnId: byName.get("Days"),
      ganttEndColumnId: byName.get("Finish"),
      predColumnId: byName.get("Pred"),
      linkColumnId: byName.get("Link"),
      lagColumnId: byName.get("Lag"),
      typeColumnId: byName.get("Type"),
      reportStatusColumnId: byName.get("Status"),
      reportDoneOptionIds: doneOptionId ? [doneOptionId] : [],
      reportPlannedOptionIds: plannedOptionId ? [plannedOptionId] : [],
    },
  });

  revalidatePath("/boards");
  return board;
}

export async function renameBoard(boardId: string, name: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("看板名稱不可為空");

  const before = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  await prisma.board.update({
    where: { id: boardId },
    data: { name: trimmed },
  });
  await logAudit("BOARD", session.userId, `看板改名:「${before?.name}」→「${trimmed}」`, boardId);

  revalidatePath("/boards");
  revalidatePath(`/boards/${boardId}`);
}

/**
 * Puts a board in the trash. It leaves every list, search result, schedule
 * network and programme rollup, but the row and everything under it stays —
 * groups, columns, items, budgets, baselines, history — so restoreBoard can
 * bring the whole thing back. Its programId is kept too: a restored board
 * rejoins the 專案群組 it was in.
 */
export async function deleteBoard(boardId: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const doomed = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true, deletedAt: true, _count: { select: { items: true } } },
  });
  if (!doomed) throw new Error("看板不存在");
  if (doomed.deletedAt) throw new Error("這個看板已經在垃圾桶裡");

  await prisma.board.update({
    where: { id: boardId },
    data: { deletedAt: new Date(), deletedById: session.userId },
  });
  await logAudit(
    "BOARD",
    session.userId,
    `刪除看板「${doomed.name}」(含 ${doomed._count.items} 個工作項),已移到垃圾桶`,
    boardId
  );
  revalidatePath("/boards");
  revalidatePath("/dashboard");
}

export type TrashedBoard = {
  id: string;
  name: string;
  itemCount: number;
  programName: string | null;
  deletedAt: string;
  deletedBy: string | null;
};

/** 看板垃圾桶。管理者才看得到,因為只有管理者刪得掉看板。 */
export async function listTrashedBoards(): Promise<TrashedBoard[]> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const boards = await prisma.board.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
    select: {
      id: true,
      name: true,
      deletedAt: true,
      deletedBy: { select: { name: true } },
      program: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
  return boards.map((board) => ({
    id: board.id,
    name: board.name,
    itemCount: board._count.items,
    programName: board.program?.name ?? null,
    deletedAt: board.deletedAt!.toISOString(),
    deletedBy: board.deletedBy?.name ?? null,
  }));
}

export async function restoreBoard(boardId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true, deletedAt: true },
  });
  if (!board || !board.deletedAt) return { error: "找不到這個已刪除的看板" };

  await prisma.board.update({
    where: { id: boardId },
    data: { deletedAt: null, deletedById: null },
  });
  await logAudit("BOARD", session.userId, `從垃圾桶還原看板「${board.name}」`, boardId);
  revalidatePath("/boards");
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  return {};
}

/**
 * The one that cannot be undone: the board row and everything the database
 * cascades from it. Only reachable from the trash, so a board can never be
 * destroyed without having sat in there first.
 */
export async function purgeBoard(boardId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true, deletedAt: true, _count: { select: { items: true } } },
  });
  if (!board || !board.deletedAt) return { error: "找不到這個已刪除的看板" };

  await prisma.board.delete({ where: { id: boardId } });
  // The board is gone, so the entry cannot point at it — the name and the
  // size are all that is left to say what was destroyed.
  await logAudit(
    "BOARD",
    session.userId,
    `永久刪除看板「${board.name}」(含 ${board._count.items} 個工作項),無法復原`
  );
  revalidatePath("/boards");
  return {};
}

export async function setBoardVisibility(boardId: string, visibility: BoardVisibility) {
  const session = await requireSession();
  await requireBoardOwnerOrAdmin(boardId, session);
  await prisma.board.update({ where: { id: boardId }, data: { visibility } });
  await logAudit("VISIBILITY", session.userId, `看板可見範圍改為 ${visibility}`, boardId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function listBoardMembers(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  return prisma.boardMember.findMany({
    where: { boardId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function addBoardMember(boardId: string, userId: string) {
  const session = await requireSession();
  await requireBoardOwnerOrAdmin(boardId, session);
  await prisma.boardMember.upsert({
    where: { boardId_userId: { boardId, userId } },
    create: { boardId, userId },
    update: {},
  });
  const added = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await logAudit("ACCESS", session.userId, `加入看板成員:${added?.name ?? userId}`, boardId);
  revalidatePath(`/boards/${boardId}`);
}

export async function removeBoardMember(boardId: string, userId: string) {
  const session = await requireSession();
  await requireBoardOwnerOrAdmin(boardId, session);
  const removed = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await prisma.boardMember.deleteMany({ where: { boardId, userId } });
  await logAudit("ACCESS", session.userId, `移除看板成員:${removed?.name ?? userId}`, boardId);
  revalidatePath(`/boards/${boardId}`);
}
