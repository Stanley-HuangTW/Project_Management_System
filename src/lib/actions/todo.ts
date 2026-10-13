"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";

export async function listTodoItems(itemId: string) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (item) await requireBoardAccess(item.boardId, session);
  return prisma.todoItem.findMany({ where: { itemId }, orderBy: { order: "asc" } });
}

export async function addTodoItem(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  text: string,
  /** 這個待辦事項的新增與完成要不要彙整進週報(預設要)。 */
  inWeeklyReport = true
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const trimmed = text.trim();
  if (!trimmed) return;

  const count = await prisma.todoItem.count({ where: { itemId } });
  const todo = await prisma.todoItem.create({ data: { itemId, text: trimmed, order: count, inWeeklyReport: inWeeklyReport !== false } });
  await logActivity(itemId, session.userId, `新增待辦事項:「${trimmed}」`, {
    kind: "TODO",
    todoItemId: todo.id,
    inWeeklyReport: todo.inWeeklyReport,
  });
  revalidatePath(`/boards/${boardId}`);
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
