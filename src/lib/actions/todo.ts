"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";
import { isValidDueDate } from "@/lib/todoDeadline";
import { assigneeName, suggestItemAssignee } from "@/lib/todoAssigneeServer";
import { noteForLog, normalizeTodoNote, normalizeTodoText } from "@/lib/todoNote";
import { mergeOrder } from "@/lib/mergeOrder";

/** 畫面上的順序;order 相同(舊資料、刪除後新增)的依建立先後,讓拖曳排序與畫面看到的是同一個基準。 */
const TODO_ORDER = [{ order: "asc" as const }, { createdAt: "asc" as const }];

export async function listTodoItems(itemId: string) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (item) await requireBoardAccess(item.boardId, session);
  return prisma.todoItem.findMany({ where: { itemId }, orderBy: TODO_ORDER });
}

export async function addTodoItem(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  text: string,
  /** 這個待辦事項的新增與完成要不要彙整進週報(預設要)。 */
  inWeeklyReport = true,
  /** 期限("YYYY-MM-DD"),沒給就是沒有期限。 */
  dueDate: string | null = null,
  /** 處理者:不給(undefined)就用預設——文字裡 @ 的人、負責人、人員分配 / 工時比例最高的人(見 todoAssignee);null = 不指定。 */
  assigneeId?: string | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (dueDate !== null && !isValidDueDate(dueDate)) return { error: "期限的日期格式不正確" };

  const assignee = assigneeId === undefined ? ((await suggestItemAssignee(itemId, trimmed))?.userId ?? null) : assigneeId;
  const assigneeLabel = assignee ? await assigneeName(assignee) : null;
  if (assignee && !assigneeLabel) return { error: "找不到這位處理者" };

  const count = await prisma.todoItem.count({ where: { itemId } });
  const todo = await prisma.todoItem.create({
    data: { itemId, text: trimmed, order: count, inWeeklyReport: inWeeklyReport !== false, dueDate, createdById: session.userId, assigneeId: assignee },
  });
  await logActivity(itemId, session.userId, `新增待辦事項:「${trimmed}」${dueDate ? `(期限 ${dueDate})` : ""}${assigneeLabel ? `(處理者 ${assigneeLabel})` : ""}`, {
    kind: "TODO",
    todoItemId: todo.id,
    inWeeklyReport: todo.inWeeklyReport,
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 設定(或清除,null)一個待辦事項的期限。改了期限就歸零提醒的階段——
 * 重新照新的期限提醒:延後的不會因為以前提醒過就不再提醒,提前到今天的下一輪心跳就會提醒。
 */
export async function setTodoDueDate(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string,
  dueDate: string | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  if (dueDate !== null && !isValidDueDate(dueDate)) return { error: "期限的日期格式不正確" };
  const existing = await prisma.todoItem.findUnique({ where: { id: todoId } });
  if (!existing || existing.itemId !== itemId) return { error: "待辦事項不存在" };
  if (existing.dueDate === dueDate) return {};

  await prisma.todoItem.update({ where: { id: todoId }, data: { dueDate, remindedStage: 0 } });
  await logActivity(
    itemId,
    session.userId,
    dueDate
      ? `設定待辦事項期限:「${existing.text}」→ ${dueDate}`
      : `清除待辦事項期限:「${existing.text}」(原本 ${existing.dueDate})`
  );
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 改(或清掉,null)一個待辦事項的處理者。 */
export async function setTodoAssignee(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string,
  assigneeId: string | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const existing = await prisma.todoItem.findUnique({ where: { id: todoId } });
  if (!existing || existing.itemId !== itemId) return { error: "待辦事項不存在" };
  if (existing.assigneeId === assigneeId) return {};
  const label = assigneeId ? await assigneeName(assigneeId) : null;
  if (assigneeId && !label) return { error: "找不到這位處理者" };

  await prisma.todoItem.update({ where: { id: todoId }, data: { assigneeId } });
  await logActivity(itemId, session.userId, assigneeId ? `待辦事項「${existing.text}」的處理者改為 ${label}` : `清除待辦事項「${existing.text}」的處理者`);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 拖曳排序:orderedIds 是畫面上拖完的順序。這個項目底下的待辦事項順序一次重寫成 0、1、2…。 */
export async function reorderTodoItems(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  orderedIds: string[]
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const current = await prisma.todoItem.findMany({ where: { itemId }, orderBy: TODO_ORDER, select: { id: true } });
  const finalIds = mergeOrder(current.map((t) => t.id), orderedIds);
  await prisma.$transaction(finalIds.map((id, index) => prisma.todoItem.update({ where: { id }, data: { order: index } })));
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 改一個待辦事項的名稱(文字)。名稱不能留空;要清掉請刪除這一筆。 */
export async function renameTodoItem(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string,
  rawText: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const normalized = normalizeTodoText(rawText);
  if ("error" in normalized) return normalized;
  const existing = await prisma.todoItem.findUnique({ where: { id: todoId } });
  if (!existing || existing.itemId !== itemId) return { error: "待辦事項不存在" };
  if (existing.text === normalized.text) return {};

  await prisma.todoItem.update({ where: { id: todoId }, data: { text: normalized.text } });
  await logActivity(itemId, session.userId, `待辦事項改名:「${existing.text}」→「${normalized.text}」`);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 改(或清空)一個待辦事項的備註——記錄處理狀態、結果。 */
export async function setTodoNote(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string,
  rawNote: string | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const normalized = normalizeTodoNote(rawNote);
  if ("error" in normalized) return normalized;
  const existing = await prisma.todoItem.findUnique({ where: { id: todoId } });
  if (!existing || existing.itemId !== itemId) return { error: "待辦事項不存在" };
  if (existing.note === normalized.note) return {};

  await prisma.todoItem.update({ where: { id: todoId }, data: { note: normalized.note } });
  await logActivity(itemId, session.userId, `更新待辦事項「${existing.text}」的備註:${noteForLog(normalized.note)}`);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function toggleTodoItem(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string,
  done: boolean
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const existingTodo = await prisma.todoItem.findUnique({ where: { id: todoId } });
  if (!existingTodo || existingTodo.itemId !== itemId) {
    throw new Error("待辦事項不存在");
  }
  const todo = await prisma.todoItem.update({ where: { id: todoId }, data: { done } });
  await logActivity(
    itemId,
    session.userId,
    `${done ? "完成" : "取消完成"}待辦事項:「${todo.text}」`,
    { kind: "TODO", todoItemId: todo.id, inWeeklyReport: todo.inWeeklyReport }
  );
  revalidatePath(`/boards/${boardId}`);
}

/**
 * 改一個待辦事項要不要彙整進週報。週報讀的是活動紀錄,所以這個待辦事項以前的紀錄也一起改
 * (之後新增與完成它的紀錄會跟著它現在的旗標)。
 */
export async function setTodoInWeeklyReport(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string,
  value: boolean
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const todo = await prisma.todoItem.findUnique({ where: { id: todoId }, select: { itemId: true } });
  if (!todo || todo.itemId !== itemId) return { error: "待辦事項不存在" };
  await prisma.$transaction([
    prisma.todoItem.update({ where: { id: todoId }, data: { inWeeklyReport: value } }),
    prisma.activityLogEntry.updateMany({ where: { todoItemId: todoId }, data: { inWeeklyReport: value } }),
  ]);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteTodoItem(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  todoId: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const existingTodo = await prisma.todoItem.findUnique({ where: { id: todoId } });
  if (!existingTodo || existingTodo.itemId !== itemId) {
    throw new Error("待辦事項不存在");
  }
  await prisma.todoItem.delete({ where: { id: todoId } });
  revalidatePath(`/boards/${boardId}`);
}
