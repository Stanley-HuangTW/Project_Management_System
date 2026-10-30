import { prisma } from "@/lib/prisma";
import { getPersonIds } from "@/types/column";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { REMINDER_HOUR, deadlineStage, reminderLink, reminderMessage, taipeiClock } from "@/lib/todoDeadline";

/**
 * 待辦事項的期限提醒:排程心跳(todo-deadline-tick,每五分鐘一次)每次都會問這一支。
 *
 * 一個待辦事項最多提醒三次——到期前一天、當天、逾期之後各一次(remindedStage 記到哪一階段了),
 * 不是每天追著催。只提醒還沒完成的;改了期限就歸零重來(見 setTodoDueDate)。
 * 台北早上 9 點之前不寄,半夜不會響。
 *
 * 收件人:這個待辦事項所屬的工作項目的負責人(負責人欄位與人員分配),加上新增這個待辦事項的人。
 * 不含看板擁有者——每個待辦事項都通知他只是噪音。通知類型是 DEADLINE,管理者可以整個關掉,
 * 每個人也可以自己關(站內與 Email 分開)。
 */

export type TodoReminderOutcome = { ran: boolean; reason?: string; todos?: number; notified?: number };

const DAY_MS = 86_400_000;

export async function sendTodoDeadlineReminders(now = new Date()): Promise<TodoReminderOutcome> {
  const { date: today, hour } = taipeiClock(now);
  if (hour < REMINDER_HOUR) return { ran: false, reason: `台北早上 ${REMINDER_HOUR} 點之後才提醒` };
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

  // 期限在明天(含)以前、還沒完成、還沒提醒到最後一階段(逾期那次)的。
  const todos = await prisma.todoItem.findMany({
    where: { done: false, remindedStage: { lt: 3 }, dueDate: { not: null, lte: tomorrow }, item: { deletedAt: null } },
    select: { id: true, text: true, dueDate: true, remindedStage: true, createdById: true, assigneeId: true, itemId: true, item: { select: { name: true, boardId: true } } },
  });

  let notified = 0;
  for (const todo of todos) {
    const stage = deadlineStage(today, todo.dueDate!);
    if (stage === 0 || stage <= todo.remindedStage) continue;

    // 條件式 updateMany 當原子鎖:另一次心跳或另一個 worker 先標了,這邊 count 就是 0,不重複通知。
    const claimed = await prisma.todoItem.updateMany({
      where: { id: todo.id, remindedStage: { lt: stage } },
      data: { remindedStage: stage },
    });
    if (claimed.count === 0) continue;

    const message = reminderMessage(stage, { itemName: todo.item.name, todoText: todo.text, dueDate: todo.dueDate! });
    // 有指定處理者就提醒他(加上寫這一筆的人);沒指定才照原本的:工作項的負責人加寫的人。
    const recipients = todo.assigneeId ? await realUserIds([todo.assigneeId, todo.createdById]) : await recipientsOf(todo.itemId, todo.createdById);
    const inApp = await filterInAppRecipients(prisma, "DEADLINE", recipients);
    if (inApp.length > 0) {
      await prisma.notification.createMany({
        data: inApp.map((userId) => ({ userId, actorId: null, type: "DEADLINE" as const, itemId: todo.itemId, message })),
      });
    }
    // Email 的開關(全站、類型、個人)notifyEmailIfNeeded 自己看,跟站內通知各自獨立。信裡附連結,直接開那個工作項目的待辦事項分頁。
    const link = reminderLink({ kind: "item", boardId: todo.item.boardId, itemId: todo.itemId });
    for (const userId of recipients) await notifyEmailIfNeeded(userId, "DEADLINE", message, link);
    notified += recipients.length;
  }

  // 風險 / 議題的待辦事項:同一套階段與提醒;收件人是那一筆的負責人加上新增這個待辦事項的人。
  const riskTodos = await prisma.riskTodo.findMany({
    where: { done: false, remindedStage: { lt: 3 }, dueDate: { not: null, lte: tomorrow }, risk: { board: { deletedAt: null } } },
    select: { id: true, text: true, dueDate: true, remindedStage: true, createdById: true, assigneeId: true, riskId: true, risk: { select: { title: true, ownerId: true, boardId: true } } },
  });
  for (const todo of riskTodos) {
    const stage = deadlineStage(today, todo.dueDate!);
    if (stage === 0 || stage <= todo.remindedStage) continue;

    const claimed = await prisma.riskTodo.updateMany({
      where: { id: todo.id, remindedStage: { lt: stage } },
      data: { remindedStage: stage },
    });
    if (claimed.count === 0) continue;

    const message = reminderMessage(stage, { itemName: todo.risk.title, todoText: todo.text, dueDate: todo.dueDate!, subject: "風險 / 議題" });
    const recipients = await realUserIds([todo.assigneeId ?? todo.risk.ownerId, todo.createdById]);
    const inApp = await filterInAppRecipients(prisma, "DEADLINE", recipients);
    if (inApp.length > 0) {
      await prisma.notification.createMany({
        data: inApp.map((userId) => ({ userId, actorId: null, type: "DEADLINE" as const, riskId: todo.riskId, message })),
      });
    }
    const link = reminderLink({ kind: "risk", boardId: todo.risk.boardId, riskId: todo.riskId });
    for (const userId of recipients) await notifyEmailIfNeeded(userId, "DEADLINE", message, link);
    notified += recipients.length;
  }

  return { ran: true, todos: todos.length + riskTodos.length, notified };
}

/** 只留真的有帳號的人(去掉空值與重複)。 */
async function realUserIds(ids: (string | null)[]): Promise<string[]> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true } });
  return users.map((u) => u.id);
}

/** 工作項目的負責人(人員欄位 + 人員分配)加上新增這個待辦事項的人,只留真的有帳號的。 */
async function recipientsOf(itemId: string, createdById: string | null): Promise<string[]> {
  const [personCells, assignments] = await Promise.all([
    prisma.cellValue.findMany({ where: { itemId, column: { type: "PERSON" } }, select: { value: true } }),
    prisma.assignment.findMany({ where: { itemId }, select: { userId: true } }),
  ]);
  const ids = new Set<string>();
  for (const cell of personCells) for (const id of getPersonIds(cell.value)) ids.add(id);
  for (const a of assignments) ids.add(a.userId);
  if (createdById) ids.add(createdById);
  if (ids.size === 0) return [];
  // 人員欄位裡也可能是治具 / 廠商(Resource),它們沒有帳號可以通知。
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true } });
  return users.map((u) => u.id);
}
