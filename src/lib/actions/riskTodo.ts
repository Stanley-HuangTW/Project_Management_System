"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { attributeAudit } from "@/lib/impersonation";
import { isValidDueDate } from "@/lib/todoDeadline";
import { assigneeName, suggestRiskAssignee } from "@/lib/todoAssigneeServer";
import { noteForLog, normalizeTodoNote, normalizeTodoText } from "@/lib/todoNote";
import { mergeOrder } from "@/lib/mergeOrder";

/**
 * 風險 / 議題的待辦事項。跟工作項的待辦事項同一個樣子(見 todo.ts):
 * 看得到那個看板的人都能新增、勾完成、改期限、刪;到期前一天、當天、逾期後各提醒一次(todoReminderServer)。
 * 進度更新才限負責人、建立者與審核人;待辦事項是大家一起的清單,跟工作項一樣不設限。
 */

export type RiskTodoRow = {
  id: string;
  text: string;
  done: boolean;
  dueDate: string | null;
  assigneeId: string | null;
  note: string | null;
  createdAt: string;
};

/** 這筆風險所在的看板要進得去;回傳看板與標題(寫紀錄用),找不到回 null。 */
async function accessibleRisk(riskId: string) {
  const session = await requireSession();
  const risk = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { id: true, boardId: true, title: true } });
  if (!risk) return null;
  await requireBoardAccess(risk.boardId, session);
  return { session, risk };
}

export async function listRiskTodos(riskId: string): Promise<RiskTodoRow[]> {
  const found = await accessibleRisk(riskId);
  if (!found) return [];
  const rows = await prisma.riskTodo.findMany({ where: { riskId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  return rows.map((t) => ({ id: t.id, text: t.text, done: t.done, dueDate: t.dueDate, assigneeId: t.assigneeId, note: t.note, createdAt: t.createdAt.toISOString() }));
}

/** assigneeId:不給(undefined)就用預設——文字裡 @ 的人、那一筆的負責人;null = 不指定。 */
export async function addRiskTodo(
  riskId: string,
  text: string,
  dueDate: string | null = null,
  assigneeId?: string | null
): Promise<{ error?: string }> {
  const found = await accessibleRisk(riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  const trimmed = text.trim();
  if (!trimmed) return { error: "請輸入待辦事項的內容" };
  if (trimmed.length > 1000) return { error: "內容太長了(上限 1000 字)" };
  if (dueDate !== null && !isValidDueDate(dueDate)) return { error: "期限的日期格式不正確" };

  const { session, risk } = found;
  const assignee = assigneeId === undefined ? ((await suggestRiskAssignee(riskId, trimmed))?.userId ?? null) : assigneeId;
  const assigneeLabel = assignee ? await assigneeName(assignee) : null;
  if (assignee && !assigneeLabel) return { error: "找不到這位處理者" };

  const count = await prisma.riskTodo.count({ where: { riskId } });
  await prisma.$transaction([
    prisma.riskTodo.create({ data: { riskId, text: trimmed, order: count, dueDate, createdById: session.userId, assigneeId: assignee } }),
    prisma.activityLogEntry.create({
      data: {
        riskId,
        boardId: risk.boardId,
        ...attributeAudit(session, session.userId, `「${risk.title}」新增待辦事項:「${trimmed}」${dueDate ? `(期限 ${dueDate})` : ""}${assigneeLabel ? `(處理者 ${assigneeLabel})` : ""}`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${risk.boardId}`);
  return {};
}

/** 設定(或清除,null)期限。改了期限就歸零提醒的階段,重新照新的期限提醒。 */
export async function setRiskTodoDueDate(todoId: string, dueDate: string | null): Promise<{ error?: string }> {
  await requireSession(); // 先確認登入,沒登入的人連待辦事項存不存在都不該知道
  if (dueDate !== null && !isValidDueDate(dueDate)) return { error: "期限的日期格式不正確" };
  const todo = await prisma.riskTodo.findUnique({ where: { id: todoId } });
  if (!todo) return { error: "待辦事項不存在" };
  const found = await accessibleRisk(todo.riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  if (todo.dueDate === dueDate) return {};

  const { session, risk } = found;
  await prisma.$transaction([
    prisma.riskTodo.update({ where: { id: todoId }, data: { dueDate, remindedStage: 0 } }),
    prisma.activityLogEntry.create({
      data: {
        riskId: risk.id,
        boardId: risk.boardId,
        ...attributeAudit(
          session,
          session.userId,
          dueDate ? `「${risk.title}」設定待辦事項期限:「${todo.text}」→ ${dueDate}` : `「${risk.title}」清除待辦事項期限:「${todo.text}」(原本 ${todo.dueDate})`
        ),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${risk.boardId}`);
  return {};
}

/** 改(或清掉,null)處理者。 */
export async function setRiskTodoAssignee(todoId: string, assigneeId: string | null): Promise<{ error?: string }> {
  await requireSession();
  const todo = await prisma.riskTodo.findUnique({ where: { id: todoId } });
  if (!todo) return { error: "待辦事項不存在" };
  const found = await accessibleRisk(todo.riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  if (todo.assigneeId === assigneeId) return {};
  const label = assigneeId ? await assigneeName(assigneeId) : null;
  if (assigneeId && !label) return { error: "找不到這位處理者" };

  const { session, risk } = found;
  await prisma.$transaction([
    prisma.riskTodo.update({ where: { id: todoId }, data: { assigneeId } }),
    prisma.activityLogEntry.create({
      data: {
        riskId: risk.id,
        boardId: risk.boardId,
        ...attributeAudit(session, session.userId, assigneeId ? `「${risk.title}」待辦事項「${todo.text}」的處理者改為 ${label}` : `「${risk.title}」清除待辦事項「${todo.text}」的處理者`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${risk.boardId}`);
  return {};
}

/** 拖曳排序:orderedIds 是畫面上拖完的順序。這一筆底下的待辦事項順序一次重寫成 0、1、2…。 */
export async function reorderRiskTodos(riskId: string, orderedIds: string[]): Promise<{ error?: string }> {
  const found = await accessibleRisk(riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  const current = await prisma.riskTodo.findMany({ where: { riskId }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const finalIds = mergeOrder(current.map((t) => t.id), orderedIds);
  await prisma.$transaction(finalIds.map((id, index) => prisma.riskTodo.update({ where: { id }, data: { order: index } })));
  revalidatePath(`/boards/${found.risk.boardId}`);
  return {};
}

/** 改待辦事項的名稱(文字)。名稱不能留空;要清掉請刪除這一筆。 */
export async function renameRiskTodo(todoId: string, rawText: string): Promise<{ error?: string }> {
  await requireSession();
  const normalized = normalizeTodoText(rawText);
  if ("error" in normalized) return normalized;
  const todo = await prisma.riskTodo.findUnique({ where: { id: todoId } });
  if (!todo) return { error: "待辦事項不存在" };
  const found = await accessibleRisk(todo.riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  if (todo.text === normalized.text) return {};

  const { session, risk } = found;
  await prisma.$transaction([
    prisma.riskTodo.update({ where: { id: todoId }, data: { text: normalized.text } }),
    prisma.activityLogEntry.create({
      data: {
        riskId: risk.id,
        boardId: risk.boardId,
        ...attributeAudit(session, session.userId, `「${risk.title}」待辦事項改名:「${todo.text}」→「${normalized.text}」`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${risk.boardId}`);
  return {};
}

/** 改(或清空)備註——記錄這個待辦事項的處理狀態、結果。 */
export async function setRiskTodoNote(todoId: string, rawNote: string | null): Promise<{ error?: string }> {
  await requireSession();
  const normalized = normalizeTodoNote(rawNote);
  if ("error" in normalized) return normalized;
  const todo = await prisma.riskTodo.findUnique({ where: { id: todoId } });
  if (!todo) return { error: "待辦事項不存在" };
  const found = await accessibleRisk(todo.riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  if (todo.note === normalized.note) return {};

  const { session, risk } = found;
  await prisma.$transaction([
    prisma.riskTodo.update({ where: { id: todoId }, data: { note: normalized.note } }),
    prisma.activityLogEntry.create({
      data: {
        riskId: risk.id,
        boardId: risk.boardId,
        ...attributeAudit(session, session.userId, `「${risk.title}」更新待辦事項「${todo.text}」的備註:${noteForLog(normalized.note)}`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${risk.boardId}`);
  return {};
}

export async function toggleRiskTodo(todoId: string, done: boolean): Promise<{ error?: string }> {
  await requireSession(); // 先確認登入,沒登入的人連待辦事項存不存在都不該知道
  const todo = await prisma.riskTodo.findUnique({ where: { id: todoId } });
  if (!todo) return { error: "待辦事項不存在" };
  const found = await accessibleRisk(todo.riskId);
  if (!found) return { error: "找不到這筆紀錄" };

  const { session, risk } = found;
  await prisma.$transaction([
    prisma.riskTodo.update({ where: { id: todoId }, data: { done } }),
    prisma.activityLogEntry.create({
      data: {
        riskId: risk.id,
        boardId: risk.boardId,
        ...attributeAudit(session, session.userId, `「${risk.title}」${done ? "完成" : "取消完成"}待辦事項:「${todo.text}」`),
        category: "RISK",
      },
    }),
  ]);
  revalidatePath(`/boards/${risk.boardId}`);
  return {};
}

export async function deleteRiskTodo(todoId: string): Promise<{ error?: string }> {
  await requireSession(); // 先確認登入,沒登入的人連待辦事項存不存在都不該知道
  const todo = await prisma.riskTodo.findUnique({ where: { id: todoId } });
  if (!todo) return { error: "待辦事項不存在" };
  const found = await accessibleRisk(todo.riskId);
  if (!found) return { error: "找不到這筆紀錄" };
  await prisma.riskTodo.delete({ where: { id: todoId } });
  revalidatePath(`/boards/${found.risk.boardId}`);
  return {};
}
