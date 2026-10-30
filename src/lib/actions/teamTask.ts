"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type GanttDurationMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { canManageStructure } from "@/lib/permissions";
import { getItemDateRange } from "@/lib/gantt";
import { addBusinessDays } from "@/lib/workday";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { upsertAssignment } from "./assignment";
import { loadTypeOptionIds, flipParentToSummary } from "@/lib/summaryType";
import { rollUpSummaryDates } from "@/lib/scheduleCascade";
import { UserError } from "@/lib/userError";

type ParentWithBoard = Prisma.ItemGetPayload<{ include: { board: true; cellValues: true } }>;

/** End date for a proposed start+days span, respecting the board's calendar
 *  vs business-day duration mode — mirrors getItemDateRange's own math for
 *  a not-yet-created item. */
function computeSpanEnd(
  startDate: string,
  days: number,
  mode: GanttDurationMode,
  holidays: Set<string>
): Date {
  const start = new Date(startDate);
  if (mode === "BUSINESS") return addBusinessDays(start, Math.max(days, 1), holidays);
  return new Date(start.getTime() + (days - 1) * 86_400_000);
}

/** Shared item-creation mechanics for both createTeamSubtask and
 *  createSubtaskFromDashboard: creates the child item, stamps its Gantt
 *  start/duration/end cells, and assigns it to the given user. */
async function createChildTask(
  parent: ParentWithBoard,
  input: { assigneeUserId: string; name: string; startDate: string; days: number; allocationPct: number },
  createdById: string,
  holidays: Set<string>
) {
  const { board } = parent;
  if (!board.ganttStartColumnId || !board.ganttDurationColumnId) {
    throw new UserError("此看板尚未設定甘特圖「開始日期」與「天數」欄位,無法用時間軸建立任務");
  }

  const siblingCount = await prisma.item.count({ where: { parentId: parent.id } });

  const item = await prisma.item.create({
    data: {
      boardId: parent.boardId,
      groupId: parent.groupId,
      parentId: parent.id,
      name: input.name.trim() || "新任務",
      order: siblingCount,
      createdById,
    },
  });

  const cellValues: { itemId: string; columnId: string; value: string | number }[] = [
    { itemId: item.id, columnId: board.ganttStartColumnId, value: input.startDate },
    { itemId: item.id, columnId: board.ganttDurationColumnId, value: input.days },
  ];
  if (board.ganttEndColumnId) {
    const end = computeSpanEnd(input.startDate, input.days, board.ganttDurationMode, holidays);
    cellValues.push({
      itemId: item.id,
      columnId: board.ganttEndColumnId,
      value: end.toISOString().slice(0, 10),
    });
  }
  await prisma.cellValue.createMany({ data: cellValues });

  await upsertAssignment(parent.boardId, item.id, input.assigneeUserId, input.allocationPct);

  // The parent has a child now, so it is a Summary — same as createItem.
  // Without this a task created from the workload timeline left its parent
  // looking like a leaf, and the schedule kept treating it as one.
  const typeIds = await loadTypeOptionIds(board.typeColumnId);
  if (board.typeColumnId && typeIds?.summaryId) {
    await flipParentToSummary(parent.id, board.typeColumnId, typeIds.summaryId);
  }
  await rollUpSummaryDates(parent.boardId, [parent.id]);

  revalidatePath("/dashboard");
  revalidatePath(`/boards/${parent.boardId}`);

  return item;
}

/** Is this item, or any item in its descendant subtree, assigned to userId? */
async function hasAssignedDescendant(itemId: string, userId: string): Promise<boolean> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    include: { assignments: true, subitems: { select: { id: true } } },
  });
  if (!item) return false;
  if (item.assignments.some((a) => a.userId === userId)) return true;
  for (const child of item.subitems) {
    if (await hasAssignedDescendant(child.id, userId)) return true;
  }
  return false;
}

/** Does any ancestor of this item have an assignment to userId? */
async function hasAssignedAncestor(itemId: string, userId: string): Promise<boolean> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { parentId: true } });
  if (!item?.parentId) return false;
  const parent = await prisma.item.findUnique({
    where: { id: item.parentId },
    include: { assignments: true },
  });
  if (!parent) return false;
  if (parent.assignments.some((a) => a.userId === userId)) return true;
  return hasAssignedAncestor(parent.id, userId);
}

/** A supervisor may pick any level of their own work as the new subtask's
 *  parent (per the dashboard's expandable tree picker) — an ancestor of an
 *  assigned item, the assigned item itself, or anywhere already nested under
 *  it — not just the exact item assigned to them. */
async function isRelatedToAssignedItem(itemId: string, userId: string): Promise<boolean> {
  if (await hasAssignedDescendant(itemId, userId)) return true;
  return hasAssignedAncestor(itemId, userId);
}

/**
 * Lets a supervisor split a subtask off one of their own assigned tasks, or
 * an admin split a subtask off any task, and hand it to a team member —
 * directly from the dashboard's weekly workload timeline. For a supervisor
 * this is a "delegate part of my own work" action, so the parent must
 * currently be assigned to them; admins aren't limited to their own tasks.
 */
export async function createTeamSubtask(input: {
  parentItemId: string;
  assigneeUserId: string;
  name: string;
  startDate: string;
  days: number;
  allocationPct: number;
}) {
  const session = await requireSession();
  if (!canManageStructure(session.role)) {
    throw new UserError("權限不足:僅管理者與主管可以新增任務");
  }

  const trimmedName = input.name.trim() || "新任務";
  if (!Number.isFinite(input.days) || input.days < 1) throw new UserError("天數需大於 0");
  if (!Number.isFinite(input.allocationPct) || input.allocationPct < 1 || input.allocationPct > 100) {
    throw new UserError("百分比需介於 1 到 100 之間");
  }

  const parent = await prisma.item.findUnique({
    where: { id: input.parentItemId },
    include: { board: true, cellValues: true },
  });
  if (!parent) throw new UserError("找不到父任務");
  await requireBoardAccess(parent.boardId, session);

  if (session.role === "SUPERVISOR") {
    const isRelated = await isRelatedToAssignedItem(parent.id, session.userId);
    if (!isRelated) {
      throw new UserError("只能在自己被指派的任務(或其上層/下層任務)下新增子任務");
    }
  }

  const { board } = parent;
  const holidays = toHolidaySet(await listHolidays());
  if (board.ganttStartColumnId && board.ganttDurationColumnId) {
    const parentRange = getItemDateRange(
      parent,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttDurationMode,
      holidays
    );
    if (parentRange) {
      const start = new Date(input.startDate);
      const end = computeSpanEnd(input.startDate, input.days, board.ganttDurationMode, holidays);
      if (start < parentRange.start || end > parentRange.end) {
        throw new UserError("子任務時程需在父任務的時間範圍內");
      }
    }
  }

  return createChildTask(parent, { ...input, name: trimmedName }, session.userId, holidays);
}

/**
 * Lets a supervisor or admin add a subtask directly under an item shown on
 * the dashboard's 我的項目/團隊項目 lists, without leaving the page. Unlike
 * createTeamSubtask this isn't limited to items the supervisor is personally
 * related to — it matches the existing "新增子項目" board-table action,
 * which any admin/supervisor can use on any item they can see — but the new
 * subtask's schedule must fall within its parent's own date range.
 */
export async function createSubtaskFromDashboard(input: {
  parentItemId: string;
  assigneeUserId: string;
  name: string;
  startDate: string;
  days: number;
  allocationPct: number;
}) {
  const session = await requireSession();
  if (!canManageStructure(session.role)) {
    throw new UserError("權限不足:僅管理者與主管可以新增任務");
  }

  if (!Number.isFinite(input.days) || input.days < 1) throw new UserError("天數需大於 0");
  if (!Number.isFinite(input.allocationPct) || input.allocationPct < 1 || input.allocationPct > 100) {
    throw new UserError("百分比需介於 1 到 100 之間");
  }

  const parent = await prisma.item.findUnique({
    where: { id: input.parentItemId },
    include: { board: true, cellValues: true },
  });
  if (!parent) throw new UserError("找不到父任務");
  await requireBoardAccess(parent.boardId, session);

  const { board } = parent;
  const holidays = toHolidaySet(await listHolidays());
  if (board.ganttStartColumnId && board.ganttDurationColumnId) {
    const parentRange = getItemDateRange(
      parent,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttDurationMode,
      holidays
    );
    if (parentRange) {
      const start = new Date(input.startDate);
      const end = computeSpanEnd(input.startDate, input.days, board.ganttDurationMode, holidays);
      if (start < parentRange.start || end > parentRange.end) {
        throw new UserError("子任務時程需在父任務的時間範圍內");
      }
    }
  }

  return createChildTask(parent, input, session.userId, holidays);
}
