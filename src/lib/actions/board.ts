"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import type { SessionPayload } from "@/lib/jwt";
import type { BoardVisibility } from "@prisma/client";
// Shared with the settings page's 狀態欄位顏色 card, which shows these same
// values and can restore them — see statusDefaults.
import {
  TYPE_OPTIONS,
  PRIORITY_OPTIONS,
  STATUS_OPTIONS,
  LINK_OPTIONS,
} from "@/lib/statusDefaults";

async function requireBoardOwnerOrAdmin(boardId: string, session: SessionPayload) {
  if (session.role === "ADMIN") return;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
  if (board?.ownerId !== session.userId) {
    throw new Error("權限不足:僅看板擁有者或管理者可以管理分享設定");
  }
}

/**
 * Every new board starts with this fixed set of columns — matching the
 * project's original imported sheet, plus whatever the dashboard/Gantt/
 * report pages need to work without any manual column-mapping. Board
 * settings (progress/Gantt/Pred/Link/Lag columns, 報表設定) are wired to
 * them automatically right after creation; the settings dropdowns stay
 * editable, they're just pre-selected.
 */
const DEFAULT_COLUMNS = [
  { name: "Lvl", type: "NUMBER" as const, options: {} },
  { name: "Type", type: "STATUS" as const, options: { statuses: TYPE_OPTIONS } },
  { name: "Priority", type: "STATUS" as const, options: { statuses: PRIORITY_OPTIONS } },
  { name: "Status", type: "STATUS" as const, options: { statuses: STATUS_OPTIONS } },
  { name: "Resource", type: "TEXT" as const, options: {} },
  { name: "Pred", type: "TEXT" as const, options: {} },
  { name: "Link", type: "STATUS" as const, options: { statuses: LINK_OPTIONS } },
  { name: "Lag", type: "NUMBER" as const, options: {} },
  { name: "Comment", type: "TEXT" as const, options: {} },
  { name: "Start", type: "DATE" as const, options: {} },
  { name: "Days", type: "NUMBER" as const, options: {} },
  { name: "Finish", type: "DATE" as const, options: {} },
  { name: "% Done", type: "NUMBER" as const, options: {} },
];

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
        create: DEFAULT_COLUMNS.map((c, order) => ({ ...c, order })),
      },
    },
    include: { columns: true },
  });

  const byName = new Map(board.columns.map((c) => [c.name, c.id]));
  const doneOptionId = STATUS_OPTIONS.find((o) => o.label === "Completed")!.id;
  const plannedOptionId = STATUS_OPTIONS.find((o) => o.label === "Planned")!.id;

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
      reportDoneOptionIds: [doneOptionId],
      reportPlannedOptionIds: [plannedOptionId],
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

export async function deleteBoard(boardId: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const doomed = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true, _count: { select: { items: true } } },
  });
  await prisma.board.delete({ where: { id: boardId } });
  // The board is gone, so the entry cannot point at it — the name and the
  // size are all that is left to say what was destroyed.
  await logAudit(
    "BOARD",
    session.userId,
    `刪除看板「${doomed?.name ?? boardId}」(含 ${doomed?._count.items ?? 0} 個工作項)`
  );
  revalidatePath("/boards");
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
