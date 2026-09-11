"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { canEditCellValue, canModifyItemSchedule } from "@/lib/permissions";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { resolveLockedScheduleFields } from "@/lib/predecessorLink";
import { syncPredecessorSchedule } from "@/lib/scheduleCascade";
import { logActivity } from "@/lib/activityLog";
import { shiftDate } from "@/lib/workday";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import type { CellValueJson } from "@/types/column";

export type BulkResult = {
  /** How many items the change was actually applied to. */
  applied: number;
  /** Items left alone, and why — one line per reason, already counted. */
  skipped: string[];
};

/**
 * Sets one column to the same value across many items.
 *
 * Permission is checked per item, not once for the selection: a MEMBER may
 * edit the status of items assigned to them and no others, and a bulk edit
 * must not become a way around that. Items that fail the check are skipped and
 * counted rather than failing the whole batch — with 200 rows selected, one
 * ineligible row should not undo the other 199.
 */
export async function bulkSetCellValue(
  boardId: string,
  itemIds: string[],
  columnId: string,
  value: CellValueJson
): Promise<BulkResult> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [column, items, personColumns] = await Promise.all([
    prisma.column.findUnique({ where: { id: columnId } }),
    prisma.item.findMany({
      where: { id: { in: itemIds }, boardId, deletedAt: null },
      include: { cellValues: true, assignments: true },
    }),
    prisma.column.findMany({ where: { boardId, type: "PERSON" }, select: { id: true } }),
  ]);
  if (!column || column.boardId !== boardId) {
    return { applied: 0, skipped: ["欄位不屬於此看板"] };
  }
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      progressColumnId: true,
      ganttStartColumnId: true,
      ganttDurationColumnId: true,
      ganttEndColumnId: true,
      predColumnId: true,
      linkColumnId: true,
      typeColumnId: true,
      manualStartColumnId: true,
      manualDurationColumnId: true,
    },
  });

  const personColumnIds = personColumns.map((c) => c.id);
  const isScheduleColumn =
    !!board &&
    (columnId === board.ganttStartColumnId ||
      columnId === board.ganttDurationColumnId ||
      columnId === board.ganttEndColumnId);

  let noPermission = 0;
  let locked = 0;
  const changed: string[] = [];

  for (const item of items) {
    const groupRole = await loadGroupRoleContext(item.groupId, session.userId);
    const assignedToUser = isItemAssignedToUser(item, personColumnIds, session.userId);
    const assignedToTeam = isItemAssignedToTeam(item, personColumnIds, groupRole.teamUserIds);
    if (
      !canEditCellValue(
        session.role,
        column.type,
        columnId === board?.progressColumnId,
        assignedToUser,
        assignedToTeam
      )
    ) {
      noPermission++;
      continue;
    }
    if (
      isScheduleColumn &&
      !canModifyItemSchedule(session.role, item.createdById, session.userId, groupRole.access.hasScheduleRole)
    ) {
      noPermission++;
      continue;
    }
    changed.push(item.id);
  }

  // Start/Days/Finish are outputs on a board that computes them; writing them
  // here would be overwritten by the next recompute anyway.
  if (isScheduleColumn && board) {
    const boardItems = await prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: { id: true, parentId: true, order: true, cellValues: true, groupId: true },
    });
    const [linkColumn, typeColumn] = await Promise.all([
      board.linkColumnId
        ? prisma.column.findUnique({ where: { id: board.linkColumnId }, select: { options: true } })
        : null,
      board.typeColumnId
        ? prisma.column.findUnique({ where: { id: board.typeColumnId }, select: { options: true } })
        : null,
    ]);
    const lockMap = resolveLockedScheduleFields(
      boardItems,
      board.predColumnId,
      board.linkColumnId,
      linkColumn?.options,
      board.typeColumnId,
      typeColumn?.options,
      board.manualStartColumnId,
      board.manualDurationColumnId
    );
    for (let i = changed.length - 1; i >= 0; i--) {
      const lock = lockMap.get(changed[i]);
      const isLocked =
        (columnId === board.ganttStartColumnId && lock?.startLocked) ||
        (columnId === board.ganttEndColumnId && lock?.endLocked) ||
        (columnId === board.ganttDurationColumnId && lock?.daysLocked);
      if (isLocked) {
        locked++;
        changed.splice(i, 1);
      }
    }
  }

  const jsonValue = value === null ? Prisma.JsonNull : value;
  for (const itemId of changed) {
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId, columnId } },
      create: { itemId, columnId, value: jsonValue },
      update: { value: jsonValue },
    });
    await logActivity(itemId, session.userId, `「${column.name}」已批次更新`);
  }

  // Once at the end rather than per item: a cascade re-entered 200 times would
  // do the same work over and over.
  for (const itemId of changed) {
    await syncPredecessorSchedule(boardId, itemId, columnId);
  }

  revalidatePath(`/boards/${boardId}`);
  const skipped: string[] = [];
  if (noPermission > 0) skipped.push(`${noPermission} 項因權限不足未變更`);
  if (locked > 0) skipped.push(`${locked} 項的此欄位是自動計算的,未變更`);
  return { applied: changed.length, skipped };
}

/**
 * Moves many items by the same number of days, forwards or back.
 *
 * Writes whichever column is the board's real manual start — start(set) on an
 * "always computed" board, Start otherwise — so the shift survives the next
 * recompute instead of being immediately overwritten by it.
 */
export async function bulkShiftDates(
  boardId: string,
  itemIds: string[],
  deltaDays: number
): Promise<BulkResult> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (!Number.isFinite(deltaDays) || deltaDays === 0) {
    return { applied: 0, skipped: ["請輸入要推移的天數"] };
  }

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      ganttStartColumnId: true,
      ganttDurationMode: true,
      manualStartColumnId: true,
      manualDurationColumnId: true,
    },
  });
  const writeColumnId =
    board?.manualStartColumnId && board.manualDurationColumnId
      ? board.manualStartColumnId
      : board?.ganttStartColumnId;
  if (!writeColumnId) {
    return { applied: 0, skipped: ["此看板尚未設定甘特圖「開始日期」欄位"] };
  }

  const [items, holidayRows] = await Promise.all([
    prisma.item.findMany({
      where: { id: { in: itemIds }, boardId, deletedAt: null },
      select: { id: true, groupId: true, createdById: true, cellValues: true },
    }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  let noPermission = 0;
  let noDate = 0;
  const moved: string[] = [];

  for (const item of items) {
    const groupRole = await loadGroupRoleContext(item.groupId, session.userId);
    if (!canModifyItemSchedule(session.role, item.createdById, session.userId, groupRole.access.hasScheduleRole)) {
      noPermission++;
      continue;
    }
    const current = item.cellValues.find((cv) => cv.columnId === writeColumnId)?.value;
    if (typeof current !== "string" || !current) {
      noDate++;
      continue;
    }
    const from = new Date(current);
    if (Number.isNaN(from.getTime())) {
      noDate++;
      continue;
    }
    const next = shiftDate(from, deltaDays, board!.ganttDurationMode, holidays)
      .toISOString()
      .slice(0, 10);
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: item.id, columnId: writeColumnId } },
      create: { itemId: item.id, columnId: writeColumnId, value: next },
      update: { value: next },
    });
    await logActivity(
      item.id,
      session.userId,
      `批次推移時程:${current} → ${next}(${deltaDays > 0 ? "+" : ""}${deltaDays} 天)`
    );
    moved.push(item.id);
  }

  for (const itemId of moved) {
    await syncPredecessorSchedule(boardId, itemId, writeColumnId);
  }

  revalidatePath(`/boards/${boardId}`);
  const skipped: string[] = [];
  if (noPermission > 0) skipped.push(`${noPermission} 項因權限不足未變更`);
  if (noDate > 0) skipped.push(`${noDate} 項沒有可推移的開始日期`);
  return { applied: moved.length, skipped };
}
