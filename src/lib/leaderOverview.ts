import type { BoardWithData, ItemData } from "@/types/board";
import { getPersonIds } from "@/types/column";
import { getItemDateRange } from "@/lib/gantt";
import { classifyItemStatus, computeDashboardDueLists, resolveStatusColumn, type DueItemEntry, type ItemStatusKind } from "@/lib/dashboard";
import { computeWbsCodes } from "@/lib/wbs";

/**
 * 專案負責人(Team Leader)的總覽:一個專案(看板)裡每個人的時程,以及整個專案逾期、本週完成、未來 7 天的工作項。
 * 全部是純函式、吃儀表板已經載入的看板資料,日期一律輸出成 YYYY-MM-DD 字串(要從伺服器元件送到畫面)。
 * 逾期 / 本週完成 / 未來 7 天的定義跟儀表板的「待辦事項到期清單」同一套(computeDashboardDueLists),不另外算。
 */

export type LeaderEntry = {
  itemId: string;
  itemName: string;
  wbsCode: string;
  groupName: string;
  /** 逾期:計畫完成日;本週完成:實際完成日;未來 7 天:計畫完成日。 */
  date: string;
  assignees: string[];
};

export type LeaderPersonItem = {
  itemId: string;
  itemName: string;
  wbsCode: string;
  groupName: string;
  start: string | null;
  end: string | null;
  kind: ItemStatusKind;
  /** 這週切成完成的(完成的項目只列這週的)。 */
  completedThisWeek: boolean;
};

export type LeaderPerson = {
  id: string;
  name: string;
  /** 沒完成的項目數。 */
  open: number;
  overdue: number;
  completedThisWeek: number;
  upcoming7: number;
  /** 沒完成的項目裡,最早開始與最晚完成。沒有排程就是 null。 */
  spanStart: string | null;
  spanEnd: string | null;
  items: LeaderPersonItem[];
};

export type LeaderBoardOverview = {
  boardId: string;
  boardName: string;
  overdue: LeaderEntry[];
  completedThisWeek: LeaderEntry[];
  upcoming7: LeaderEntry[];
  people: LeaderPerson[];
  /** 逾期、未來 7 天的項目裡沒有指派任何人的(沒人負責,最容易被漏掉)。 */
  unassignedCount: number;
};

function iso(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** 這個工作項的負責人:人員欄位(PERSON)加甘特的人員分配,去重複。 */
function assigneeIdsOf(board: BoardWithData, item: ItemData): string[] {
  const personColumnIds = new Set(board.columns.filter((c) => c.type === "PERSON").map((c) => c.id));
  const ids = new Set<string>();
  for (const cv of item.cellValues) {
    if (personColumnIds.has(cv.columnId)) for (const id of getPersonIds(cv.value)) ids.add(id);
  }
  for (const a of item.assignments) ids.add(a.userId);
  return [...ids];
}

export function computeLeaderOverview(
  boards: BoardWithData[],
  /** id → 顯示名稱(使用者與資源都要,PERSON 欄位可能放資源)。 */
  nameOf: ReadonlyMap<string, string>,
  holidays: Set<string>,
  completedAtByItem: Record<string, string>
): LeaderBoardOverview[] {
  return boards.map((board) => {
    const lists = computeDashboardDueLists([board], undefined, holidays, completedAtByItem);
    const itemById = new Map(board.items.map((i) => [i.id, i]));
    const names = (itemId: string) => assigneeIdsOf(board, itemById.get(itemId)!).map((id) => nameOf.get(id) ?? "(已刪除的使用者)");
    const toEntry = (e: DueItemEntry): LeaderEntry => ({
      itemId: e.itemId,
      itemName: e.itemName,
      wbsCode: e.wbsCode,
      groupName: e.groupName,
      date: iso(e.end)!,
      assignees: names(e.itemId),
    });
    const overdue = lists.overdue.map(toEntry);
    const completedThisWeek = lists.completedThisWeek.map(toEntry);
    const upcoming7 = lists.upcoming7.map(toEntry);
    const overdueIds = new Set(overdue.map((e) => e.itemId));
    const doneThisWeekIds = new Set(completedThisWeek.map((e) => e.itemId));
    const upcomingIds = new Set(upcoming7.map((e) => e.itemId));

    const statusColumn = resolveStatusColumn(board);
    const groupName = new Map(board.groups.map((g) => [g.id, g.name]));
    const wbs = new Map<string, string>();
    for (const group of board.groups) {
      for (const [id, code] of computeWbsCodes(board.items.filter((i) => i.groupId === group.id))) wbs.set(id, code);
    }

    const people = new Map<string, LeaderPerson>();
    for (const item of board.items) {
      const assigneeIds = assigneeIdsOf(board, item);
      if (assigneeIds.length === 0) continue;
      const range =
        board.ganttStartColumnId && board.ganttDurationColumnId
          ? getItemDateRange(item, board.ganttStartColumnId, board.ganttDurationColumnId, board.ganttDurationMode, holidays)
          : null;
      const kind = classifyItemStatus(item, board, statusColumn, range);
      const finishedThisWeek = doneThisWeekIds.has(item.id);
      // 完成的項目只留這週完成的;更早完成的不是「現在的時程」。
      if (kind === "done" && !finishedThisWeek) continue;
      const row: LeaderPersonItem = {
        itemId: item.id,
        itemName: item.name,
        wbsCode: wbs.get(item.id) ?? "",
        groupName: groupName.get(item.groupId) ?? "",
        start: iso(range?.start ?? null),
        end: iso(range?.end ?? null),
        kind,
        completedThisWeek: finishedThisWeek,
      };
      for (const id of assigneeIds) {
        let person = people.get(id);
        if (!person) {
          person = { id, name: nameOf.get(id) ?? "(已刪除的使用者)", open: 0, overdue: 0, completedThisWeek: 0, upcoming7: 0, spanStart: null, spanEnd: null, items: [] };
          people.set(id, person);
        }
        person.items.push(row);
        if (kind !== "done") {
          person.open += 1;
          if (row.start && (!person.spanStart || row.start < person.spanStart)) person.spanStart = row.start;
          if (row.end && (!person.spanEnd || row.end > person.spanEnd)) person.spanEnd = row.end;
        }
        if (overdueIds.has(item.id)) person.overdue += 1;
        if (finishedThisWeek) person.completedThisWeek += 1;
        if (upcomingIds.has(item.id)) person.upcoming7 += 1;
      }
    }

    for (const person of people.values()) {
      // 沒完成的在前、依開始日;沒有排程的排最後;這週完成的放在最後面。
      person.items.sort((a, b) => Number(a.kind === "done") - Number(b.kind === "done") || (a.start ?? "9999").localeCompare(b.start ?? "9999") || a.itemName.localeCompare(b.itemName, "zh-TW"));
    }

    return {
      boardId: board.id,
      boardName: board.name,
      overdue,
      completedThisWeek,
      upcoming7,
      // 逾期最多的人在最前面,其次是未來 7 天最忙的,最後照名字。
      people: [...people.values()].sort((a, b) => b.overdue - a.overdue || b.upcoming7 - a.upcoming7 || a.name.localeCompare(b.name, "zh-TW")),
      unassignedCount: [...overdue, ...upcoming7].filter((e) => e.assignees.length === 0).length,
    };
  });
}
