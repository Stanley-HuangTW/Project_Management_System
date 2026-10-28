import type { BoardWithData } from "@/types/board";
import { getPersonIds } from "@/types/column";

/**
 * 待辦事項的期限:算「到期前一天 / 當天 / 逾期」是哪一階段、怎麼說、儀表板要列哪些。
 *
 * 不碰資料庫與信箱,整個測得到。日期一律是台北的日曆日("YYYY-MM-DD"),
 * 跟其他日期欄位一樣是字串,不帶時間——「今天到期」就是台北的今天過完之前。
 */

/** 0 = 還沒到要提醒的時候、1 = 明天到期、2 = 今天到期、3 = 已逾期。 */
export type DeadlineStage = 0 | 1 | 2 | 3;

/** 台北時間幾點之後才寄提醒——半夜不寄,早上上班前後各階段的提醒一起來。 */
export const REMINDER_HOUR = 9;

const DAY_MS = 86_400_000;
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function isValidDueDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 台北現在的日曆日與鐘點。 */
export function taipeiClock(now: Date): { date: string; hour: number } {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/** 期限離今天還有幾天:0 = 今天,負的 = 已經過了。 */
export function daysUntil(today: string, due: string): number {
  return Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

export function deadlineStage(today: string, due: string): DeadlineStage {
  const days = daysUntil(today, due);
  if (days < 0) return 3;
  if (days === 0) return 2;
  if (days === 1) return 1;
  return 0;
}

export type DeadlineTone = "overdue" | "today" | "soon" | "later";

/** 「逾期 3 天」「今天到期」「明天到期」「5 天後」,加上顏色用的語氣。 */
export function describeDeadline(today: string, due: string): { text: string; tone: DeadlineTone } {
  const days = daysUntil(today, due);
  if (days < 0) return { text: `逾期 ${-days} 天`, tone: "overdue" };
  if (days === 0) return { text: "今天到期", tone: "today" };
  if (days === 1) return { text: "明天到期", tone: "soon" };
  return { text: `${days} 天後`, tone: "later" };
}

/** 「10/28」——跟儀表板其他清單的日期寫法一樣,不帶年。 */
export function formatDueShort(due: string): string {
  return `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}`;
}

/** 提醒的內文:哪個工作項目的哪個待辦事項、期限是哪天、現在是哪一階段。 */
export function reminderMessage(
  stage: Exclude<DeadlineStage, 0>,
  /** subject:這個待辦事項屬於哪一種東西,預設是工作項目;風險、問題、議題的待辦事項帶「風險 / 問題」。 */
  args: { itemName: string; todoText: string; dueDate: string; subject?: string }
): string {
  const what = `${args.subject ?? "工作項目"}「${args.itemName}」的待辦事項「${args.todoText}」`;
  if (stage === 1) return `${what}明天(${args.dueDate})到期`;
  if (stage === 2) return `${what}今天(${args.dueDate})到期`;
  return `${what}已經逾期(期限 ${args.dueDate}),還沒完成`;
}

/** 儀表板「待辦事項期限」清單的一列:工作項目 - 待辦事項,加上期限。 */
export type TodoDeadlineEntry = {
  todoId: string;
  text: string;
  dueDate: string;
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  groupName: string;
};

type TodoRow = { id: string; itemId: string; text: string; dueDate: string | null; done: boolean; createdById: string | null; assigneeId?: string | null };

/**
 * 儀表板要列哪些待辦事項:有期限、還沒完成、而且是這幾位的——工作項目指派給他們(負責人欄位或人員分配),
 * 或是他們自己寫的待辦事項。userIds 是 undefined = 不篩(管理者看全部)。
 * 只在 boards 裡的項目才會列(boards 已經濾掉這個人看不到的項目與看板)。依期限由近到遠排。
 */
export function todoDeadlineEntries(
  boards: BoardWithData[],
  todos: TodoRow[],
  userIds: string[] | undefined
): TodoDeadlineEntry[] {
  const wanted = userIds ? new Set(userIds) : null;
  const itemInfo = new Map<string, { item: BoardWithData["items"][number]; board: BoardWithData }>();
  for (const board of boards) for (const item of board.items) itemInfo.set(item.id, { item, board });

  const entries: TodoDeadlineEntry[] = [];
  for (const todo of todos) {
    if (todo.done || !todo.dueDate) continue;
    const info = itemInfo.get(todo.itemId);
    if (!info) continue;
    if (wanted) {
      const { item, board } = info;
      const personColumnIds = new Set(board.columns.filter((c) => c.type === "PERSON").map((c) => c.id));
      const assigned =
        item.assignments.some((a) => wanted.has(a.userId)) ||
        item.cellValues.some((cv) => personColumnIds.has(cv.columnId) && getPersonIds(cv.value).some((id) => wanted.has(id)));
      const wroteIt = !!todo.createdById && wanted.has(todo.createdById);
      // 指定給他處理的,即使工作項不是他的也列出來。
      const handlesIt = !!todo.assigneeId && wanted.has(todo.assigneeId);
      if (!assigned && !wroteIt && !handlesIt) continue;
    }
    entries.push({
      todoId: todo.id,
      text: todo.text,
      dueDate: todo.dueDate,
      itemId: info.item.id,
      itemName: info.item.name,
      boardId: info.board.id,
      boardName: info.board.name,
      groupName: info.board.groups.find((g) => g.id === info.item.groupId)?.name ?? "",
    });
  }
  return entries.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.itemName.localeCompare(b.itemName, "zh-Hant"));
}
