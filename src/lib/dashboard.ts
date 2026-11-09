import type { BoardWithData, ColumnData, ItemData, UserOption } from "@/types/board";
import { getPersonIds, getStatusOptions, type StatusOption } from "@/types/column";
import {
  getItemDateRange,
  computeDailyLoadByUser,
  manualScheduleHint,
  DEFAULT_OWNER_ALLOCATION_PCT,
} from "@/lib/gantt";
import { computeItemProgress } from "@/lib/progress";
import { resolveLockedScheduleFields, type ScheduleLock } from "@/lib/predecessorLink";
import { computeWbsCodes } from "@/lib/wbs";
import { weekRangeOf } from "@/lib/weeklyReport";
import { taipeiDateOf } from "@/lib/itemEvents";

export type WorkloadPeriod = "day" | "week" | "month";

function todayUtc(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export type WorkloadRange = { from: string; to: string };

/** All dates (inclusive) covering the requested period, anchored on today —
 *  or, given an explicit {from, to} (both YYYY-MM-DD), every date in that
 *  range instead. */
function datesForPeriod(period: WorkloadPeriod | WorkloadRange): Date[] {
  if (typeof period === "object") {
    const dates: Date[] = [];
    let cursor = new Date(period.from);
    const end = new Date(period.to);
    while (cursor <= end) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  const today = todayUtc();
  if (period === "day") return [today];

  if (period === "week") {
    const dayOfWeek = today.getUTCDay(); // 0 = Sunday
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = addDays(today, mondayOffset);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }

  const firstOfMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, i) => addDays(firstOfMonth, i));
}

export type TeamWorkloadEntry = { userId: string; userName: string; avgPct: number };

/**
 * Each user's average allocation % across the requested period (day/week/month),
 * summed across every board that has Gantt columns configured.
 */
export function computeTeamWorkload(
  boards: BoardWithData[],
  users: UserOption[],
  period: WorkloadPeriod | WorkloadRange = "day",
  holidays: Set<string> = new Set(),
  ownerDefaultPct: number = DEFAULT_OWNER_ALLOCATION_PCT
): TeamWorkloadEntry[] {
  const dates = datesForPeriod(period).map(toIsoDate);
  const totals = new Map<string, number>();

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const dailyLoad = computeDailyLoadByUser(
      board.items,
      board.ganttStartColumnId,
      board.ganttDurationColumnId,
      board.ganttDurationMode,
      holidays,
      {
        personColumnIds: board.columns.filter((c) => c.type === "PERSON").map((c) => c.id),
        defaultPct: ownerDefaultPct,
      }
    );
    for (const [userId, dayMap] of dailyLoad) {
      const sum = dates.reduce((acc, date) => acc + (dayMap.get(date) ?? 0), 0);
      totals.set(userId, (totals.get(userId) ?? 0) + sum);
    }
  }

  return users
    .map((u) => ({
      userId: u.id,
      userName: u.name,
      avgPct: Math.round((totals.get(u.id) ?? 0) / dates.length),
    }))
    .sort((a, b) => b.avgPct - a.avgPct);
}

export type MemberItemWorkloadEntry = {
  boardId: string;
  boardName: string;
  itemId: string;
  itemName: string;
  avgPct: number;
};

/**
 * For one user, each of their assigned items' average allocation % across the
 * requested period (day/week/month) — only counting days the item's Gantt
 * date range actually overlaps the period. Used for the per-person pie
 * breakdown in the team workload overview.
 */
export function computeMemberItemWorkload(
  boards: BoardWithData[],
  userId: string,
  period: WorkloadPeriod | WorkloadRange = "day",
  holidays: Set<string> = new Set(),
  ownerDefaultPct: number = DEFAULT_OWNER_ALLOCATION_PCT
): MemberItemWorkloadEntry[] {
  const dates = new Set(datesForPeriod(period).map(toIsoDate));
  const entries: MemberItemWorkloadEntry[] = [];

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const personColumnIds = board.columns.filter((c) => c.type === "PERSON").map((c) => c.id);
    for (const item of board.items) {
      // 人員分配照它自己的百分比;只掛在負責人欄位的,照系統設定的預設比例(0 = 不算)。
      const assignment = item.assignments.find((a) => a.userId === userId);
      const isOwner = item.cellValues
        .filter((cv) => personColumnIds.includes(cv.columnId))
        .flatMap((cv) => getPersonIds(cv.value))
        .includes(userId);
      if (!assignment && !(isOwner && ownerDefaultPct > 0)) continue;
      const allocationPct = assignment ? assignment.allocationPct : ownerDefaultPct;
      const range = getItemDateRange(
        item,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidays
      );
      if (!range) continue;

      let activeDays = 0;
      const cursor = new Date(range.start);
      while (cursor <= range.end) {
        if (dates.has(toIsoDate(cursor))) activeDays++;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      if (activeDays === 0) continue;

      entries.push({
        boardId: board.id,
        boardName: board.name,
        itemId: item.id,
        itemName: item.name,
        avgPct: Math.round((allocationPct * activeDays) / dates.size),
      });
    }
  }

  return entries.sort((a, b) => b.avgPct - a.avgPct);
}

const WORKLOAD_PERIODS: WorkloadPeriod[] = ["day", "week", "month"];

/**
 * 一次算出一群人、日 / 週 / 月三個期間的「每個項目平均佔多少 %」——結果跟對每個人、每個期間各呼叫一次
 * computeMemberItemWorkload 逐筆一樣(測試拿它當對照),但每個工作項只看一次、日期範圍只算一次、
 * 每個期間的有效天數只算一次。儀表板有幾十個人 × 3 個期間,逐一呼叫等於把全部項目掃幾十遍。
 */
export function computeMemberItemWorkloadForUsers(
  boards: BoardWithData[],
  userIds: string[],
  holidays: Set<string> = new Set(),
  ownerDefaultPct: number = DEFAULT_OWNER_ALLOCATION_PCT
): Record<string, Record<WorkloadPeriod, MemberItemWorkloadEntry[]>> {
  const result: Record<string, Record<WorkloadPeriod, MemberItemWorkloadEntry[]>> = {};
  for (const id of userIds) result[id] = { day: [], week: [], month: [] };
  const wanted = new Set(userIds);
  const periodDates = WORKLOAD_PERIODS.map((p) => new Set(datesForPeriod(p).map(toIsoDate)));

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const personColumnIds = new Set(board.columns.filter((c) => c.type === "PERSON").map((c) => c.id));
    for (const item of board.items) {
      // 這個項目落在名單裡的人各自佔幾 %:人員分配照它自己的百分比(同一人有多筆取第一筆);
      // 只掛在負責人欄位的,照系統設定的預設比例(0 = 不算)。
      const pctByUser = new Map<string, number>();
      for (const a of item.assignments) if (wanted.has(a.userId) && !pctByUser.has(a.userId)) pctByUser.set(a.userId, a.allocationPct);
      if (ownerDefaultPct > 0) {
        for (const cv of item.cellValues) {
          if (!personColumnIds.has(cv.columnId)) continue;
          for (const id of getPersonIds(cv.value)) if (wanted.has(id) && !pctByUser.has(id)) pctByUser.set(id, ownerDefaultPct);
        }
      }
      if (pctByUser.size === 0) continue;

      const range = getItemDateRange(item, board.ganttStartColumnId, board.ganttDurationColumnId, board.ganttDurationMode, holidays);
      if (!range) continue;

      const activeDays = periodDates.map((dates) => {
        let n = 0;
        const cursor = new Date(range.start);
        while (cursor <= range.end) {
          if (dates.has(toIsoDate(cursor))) n++;
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return n;
      });
      for (const [userId, allocationPct] of pctByUser) {
        WORKLOAD_PERIODS.forEach((period, i) => {
          if (activeDays[i] === 0) return;
          result[userId][period].push({
            boardId: board.id,
            boardName: board.name,
            itemId: item.id,
            itemName: item.name,
            avgPct: Math.round((allocationPct * activeDays[i]) / periodDates[i].size),
          });
        });
      }
    }
  }

  for (const id of userIds) for (const period of WORKLOAD_PERIODS) result[id][period].sort((a, b) => b.avgPct - a.avgPct);
  return result;
}

export type BoardProgressEntry = {
  boardId: string;
  boardName: string;
  itemCount: number;
  statusBreakdown: { option: StatusOption; count: number }[];
  avgProgress: number | null;
};

/** Per-board item count, status breakdown (first STATUS column), and average progress. */
export function computeBoardProgressOverview(boards: BoardWithData[]): BoardProgressEntry[] {
  return boards.map((board) => {
    const statusColumn = board.columns.find((c) => c.type === "STATUS");
    const statusOptions = statusColumn ? getStatusOptions(statusColumn.options) : [];
    const statusBreakdown = statusOptions.map((option) => ({
      option,
      count: board.items.filter((item) =>
        item.cellValues.some(
          (cv) => cv.columnId === statusColumn!.id && cv.value === option.id
        )
      ).length,
    }));

    let avgProgress: number | null = null;
    if (board.progressColumnId) {
      const values = board.items
        .map((item) =>
          item.cellValues.find((cv) => cv.columnId === board.progressColumnId)?.value
        )
        .filter((v): v is number => typeof v === "number");
      if (values.length > 0) {
        avgProgress = values.reduce((a, b) => a + b, 0) / values.length;
      }
    }

    return {
      boardId: board.id,
      boardName: board.name,
      itemCount: board.items.length,
      statusBreakdown,
      avgProgress,
    };
  });
}

export type DueItemEntry = {
  boardId: string;
  boardName: string;
  /** 哪個分組 —— 清單照看板與分組收起來,一長串名稱才看得出屬於哪一塊。 */
  groupId: string;
  groupName: string;
  itemId: string;
  itemName: string;
  /** 它在分組裡的編號,例如 3.1.1。 */
  wbsCode: string;
  end: Date;
};

/**
 * Boards can have several STATUS-type columns (Type, Priority, Status,
 * Link, ...) for different purposes — prefer the one actually named
 * "Status" over just grabbing whichever STATUS column comes first.
 */
export function resolveStatusColumn(board: BoardWithData): ColumnData | null {
  return (
    board.columns.find((c) => c.type === "STATUS" && c.name === "Status") ??
    board.columns.find((c) => c.type === "STATUS") ??
    null
  );
}

/** 項目在 Status 欄上選的那個選項(標籤與顏色);沒選或選項已被刪掉就是 null。 */
export function resolveItemStatusOption(item: ItemData, statusColumn: ColumnData | null): StatusOption | null {
  if (!statusColumn) return null;
  const value = item.cellValues.find((cv) => cv.columnId === statusColumn.id)?.value;
  return getStatusOptions(statusColumn.options).find((o) => o.id === value) ?? null;
}

/** An item counts as done if its progress column reads 100% — stored as the
 *  0-1 fraction computeItemProgress uses, not a 0-100 percentage — or its
 *  report status column (configured in 報表設定) is set to one of the
 *  board's mapped "done" options. Falls back to the "done" id every board's
 *  un-imported default status set uses, for boards that haven't configured
 *  報表設定 at all. */
export function isItemComplete(item: ItemData, board: BoardWithData, statusColumn: ColumnData | null): boolean {
  if (board.progressColumnId) {
    const pct = computeItemProgress(item, board.items, board.progressColumnId);
    if (pct !== null && pct >= 1) return true;
  }
  if (board.reportStatusColumnId && board.reportDoneOptionIds.length > 0) {
    const value = item.cellValues.find((cv) => cv.columnId === board.reportStatusColumnId)?.value;
    if (typeof value === "string" && board.reportDoneOptionIds.includes(value)) return true;
  }
  if (statusColumn) {
    const value = item.cellValues.find((cv) => cv.columnId === statusColumn.id)?.value;
    if (value === "done") return true;
  }
  return false;
}

export type ItemStatusKind = "done" | "overdue" | "inProgress" | "notStarted";

/** Classifies an item into the 4 status kinds shared by the Gantt view, the
 *  board table, the dashboard's personal-items lists, and the kanban card
 *  order — 完成 beats 逾期 beats 實作中 beats 尚未處理 (an item that's both
 *  done and past its own end date still just reads as done). 實作中 is
 *  matched by the Status option's label, not its id, since imported boards
 *  give their Status options random ids. */
export function classifyItemStatus(
  item: ItemData,
  board: BoardWithData,
  statusColumn: ColumnData | null,
  range: { start: Date; end: Date } | null
): ItemStatusKind {
  if (isItemComplete(item, board, statusColumn)) return "done";
  if (range && range.end < todayUtc()) return "overdue";
  if (statusColumn) {
    const value = item.cellValues.find((cv) => cv.columnId === statusColumn.id)?.value;
    const option = getStatusOptions(statusColumn.options).find((o) => o.id === value);
    if (option?.label.toLowerCase() === "in progress") return "inProgress";
  }
  return "notStarted";
}

/** Task-name color by status — shared by the Gantt view, the board table,
 *  and the dashboard's personal-items lists so all three agree on the same
 *  rule and the same board-configured colors. 尚未處理 gets no override,
 *  just the theme's normal text color. */
export function resolveItemNameColor(
  item: ItemData,
  board: BoardWithData,
  statusColumn: ColumnData | null,
  range: { start: Date; end: Date } | null
): string | undefined {
  switch (classifyItemStatus(item, board, statusColumn, range)) {
    case "done":
      return board.ganttCompletedColor;
    case "overdue":
      return board.ganttOverdueColor;
    case "inProgress":
      return board.ganttInProgressColor;
    default:
      return undefined;
  }
}

/**
 * Items whose Gantt end date has passed (overdue) or falls within the next 7
 * days (upcoming), excluding anything already complete — those show up in
 * `completed` instead. Pass `userIds` to only include items whose 負責人
 * (PERSON column or Gantt Assignment) is one of those users.
 */
export function computeOverdueUpcoming(
  boards: BoardWithData[],
  userIds?: string[],
  holidays: Set<string> = new Set(),
  upcomingDays = 7
): {
  overdue: DueItemEntry[];
  upcoming: DueItemEntry[];
  completed: DueItemEntry[];
} {
  const today = todayUtc();
  const weekAhead = new Date(today);
  weekAhead.setDate(weekAhead.getDate() + upcomingDays);
  const idSet = userIds ? new Set(userIds) : null;

  const overdue: DueItemEntry[] = [];
  const upcoming: DueItemEntry[] = [];
  const completed: DueItemEntry[] = [];

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const statusColumn = resolveStatusColumn(board);
    const groupName = new Map(board.groups.map((g) => [g.id, g.name]));
    // WBS 是項目在它自己分組樹裡的位置,所以一個分組算一次,而不是每一筆
    // 逾期項目各算一次。
    const wbs = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) wbs.set(id, code);
    }
    for (const item of board.items) {
      if (idSet) {
        const personIds = item.cellValues
          .filter((cv) => board.columns.find((c) => c.id === cv.columnId)?.type === "PERSON")
          .flatMap((cv) => getPersonIds(cv.value));
        const isOwnedByScope =
          personIds.some((id) => idSet.has(id)) || item.assignments.some((a) => idSet.has(a.userId));
        if (!isOwnedByScope) continue;
      }

      const range = getItemDateRange(
        item,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidays
      );
      if (!range) continue;
      if (range.end > weekAhead) continue;

      const entry = {
        boardId: board.id,
        boardName: board.name,
        groupId: item.groupId,
        groupName: groupName.get(item.groupId) ?? "",
        itemId: item.id,
        itemName: item.name,
        wbsCode: wbs.get(item.id) ?? "",
        end: range.end,
      };
      if (isItemComplete(item, board, statusColumn)) {
        completed.push(entry);
      } else if (range.end < today) {
        overdue.push(entry);
      } else {
        upcoming.push(entry);
      }
    }
  }

  overdue.sort((a, b) => a.end.getTime() - b.end.getTime());
  upcoming.sort((a, b) => a.end.getTime() - b.end.getTime());
  completed.sort((a, b) => a.end.getTime() - b.end.getTime());
  return { overdue, upcoming, completed };
}

export type DashboardDueLists = {
  overdue: DueItemEntry[];
  completedThisWeek: DueItemEntry[];
  upcoming7: DueItemEntry[];
  upcoming30: DueItemEntry[];
};

/**
 * 儀表板「待辦事項到期清單」專用的四個分類:已逾期、本週完成、未來 7 天、
 * 未來 30 天 —— 每一筆只會落在其中一類,不像 computeOverdueUpcoming 那樣
 * 「完成的」跟「還沒完成的」各自獨立判斷、範圍也只有一種。故意另外寫一份,
 * 不去改 computeOverdueUpcoming 本身——那個函式週報、MCP 工具都在用,語意
 * 是「這個時間範圍內,完成的跟還沒完成的」,跟這裡「依照時間分成四段」是
 * 不同的需求。
 *
 * 「本週完成」以**實際切成完成的時間**為準(completedAtByItem:工作項 id → ISO 時間,台灣時間算哪一天),
 * 不管它的計畫完成日是哪天;沒有切換紀錄的(舊資料、不是靠狀態欄完成的)才退回用計畫完成日在本週的判斷。
 */
export function computeDashboardDueLists(
  boards: BoardWithData[],
  userIds?: string[],
  holidays: Set<string> = new Set(),
  completedAtByItem: Record<string, string> = {}
): DashboardDueLists {
  const today = todayUtc();
  const { weekStart } = weekRangeOf(toIsoDate(today));
  const weekStartDate = new Date(weekStart);
  // 實際完成的時間用台灣時間算哪一天,週的邊界也照台灣時間(跟工時、週報同一個時區)。
  const todayTaipei = taipeiDateOf(new Date().toISOString());
  const weekStartTaipei = weekRangeOf(todayTaipei).weekStart;
  const in7 = addDays(today, 7);
  const in30 = addDays(today, 30);
  const idSet = userIds ? new Set(userIds) : null;

  const overdue: DueItemEntry[] = [];
  const completedThisWeek: DueItemEntry[] = [];
  const upcoming7: DueItemEntry[] = [];
  const upcoming30: DueItemEntry[] = [];

  for (const board of boards) {
    if (!board.ganttStartColumnId || !board.ganttDurationColumnId) continue;
    const statusColumn = resolveStatusColumn(board);
    const groupName = new Map(board.groups.map((g) => [g.id, g.name]));
    const wbs = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) wbs.set(id, code);
    }

    for (const item of board.items) {
      if (idSet) {
        const personIds = item.cellValues
          .filter((cv) => board.columns.find((c) => c.id === cv.columnId)?.type === "PERSON")
          .flatMap((cv) => getPersonIds(cv.value));
        const isOwnedByScope =
          personIds.some((id) => idSet.has(id)) || item.assignments.some((a) => idSet.has(a.userId));
        if (!isOwnedByScope) continue;
      }

      const range = getItemDateRange(
        item,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidays
      );
      if (!range) continue;

      const entry = {
        boardId: board.id,
        boardName: board.name,
        groupId: item.groupId,
        groupName: groupName.get(item.groupId) ?? "",
        itemId: item.id,
        itemName: item.name,
        wbsCode: wbs.get(item.id) ?? "",
        end: range.end,
      };

      if (isItemComplete(item, board, statusColumn)) {
        const doneAt = completedAtByItem[item.id];
        if (doneAt) {
          const doneDay = taipeiDateOf(doneAt);
          if (doneDay >= weekStartTaipei && doneDay <= todayTaipei) completedThisWeek.push({ ...entry, end: new Date(doneDay) });
        } else if (range.end >= weekStartDate && range.end <= today) {
          completedThisWeek.push(entry);
        }
      } else if (range.end < today) {
        overdue.push(entry);
      } else if (range.end <= in7) {
        upcoming7.push(entry);
      } else if (range.end <= in30) {
        upcoming30.push(entry);
      }
    }
  }

  overdue.sort((a, b) => a.end.getTime() - b.end.getTime());
  completedThisWeek.sort((a, b) => a.end.getTime() - b.end.getTime());
  upcoming7.sort((a, b) => a.end.getTime() - b.end.getTime());
  upcoming30.sort((a, b) => a.end.getTime() - b.end.getTime());
  return { overdue, completedThisWeek, upcoming7, upcoming30 };
}

export type PersonalItemAssignee = { name: string; allocationPct: number | null };

export type PersonalItemEntry = {
  boardId: string;
  boardName: string;
  itemId: string;
  itemName: string;
  wbsCode: string;
  groupId: string;
  groupName: string;
  createdById: string | null;
  status: StatusOption | null;
  progressPct: number | null;
  startDate: Date | null;
  dueDate: Date | null;
  assignees: PersonalItemAssignee[];
  /** The full item + its board's columns, for the dashboard's item-detail
   *  and assignment modals (same components the board table uses). */
  fullItem: ItemData;
  columns: ColumnData[];
  progressColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
  predColumnId: string | null;
  /** For the item card's 相關項目 list — see listDependentItems. */
  linkColumnId: string | null;
  /** Every item in the same group — for the Pred dropdown, same as the
   *  board table/gantt views. */
  groupItems: ItemData[];
  /** Whether this item's Start/Days/Finish are computed (Pred/Link chain,
   *  a Summary rollup, or the board's manual-schedule mode) and therefore
   *  not freely editable here — same rule the board table/gantt enforce. */
  scheduleLock: ScheduleLock | null;
  /** Task-name color by status, same rule and same board-configured colors
   *  as the Gantt view (BoardGantt.tsx's ganttStatusColor) — 完成 beats
   *  逾期 beats 實作中, 尚未處理 gets no override. */
  nameColor: string | undefined;
  /** What to tell the user to edit instead when this item's Start/Days/
   *  Finish are locked — see manualScheduleHint in @/lib/gantt. */
  scheduleHint: string | undefined;
};

/**
 * Items assigned to any of the given users, either via a PERSON column or a
 * Gantt Assignment, across all boards. Pass a single id for "my items"; pass
 * a team's ids to see everyone's items at once (assignees disambiguates who,
 * and at what allocation % when known from a Gantt Assignment).
 */
export function computePersonalItems(
  boards: BoardWithData[],
  userIds: string[],
  userById: Map<string, string> = new Map(),
  holidays: Set<string> = new Set()
): PersonalItemEntry[] {
  const idSet = new Set(userIds);
  const result: PersonalItemEntry[] = [];

  for (const board of boards) {
    // Boards can have several STATUS-type columns (Type, Priority, Status,
    // Link, ...) for different purposes — prefer the one actually named
    // "Status" over just grabbing whichever STATUS column comes first.
    const statusColumn =
      board.columns.find((c) => c.type === "STATUS" && c.name === "Status") ??
      board.columns.find((c) => c.type === "STATUS");
    const statusOptions = statusColumn ? getStatusOptions(statusColumn.options) : [];
    const groupNameById = new Map(board.groups.map((g) => [g.id, g.name]));
    const scheduleHint = manualScheduleHint(
      board.columns,
      board.manualStartColumnId,
      board.manualDurationColumnId
    );
    const linkColumn = board.columns.find((c) => c.id === board.linkColumnId);
    const typeColumn = board.columns.find((c) => c.id === board.typeColumnId);
    const scheduleLocks = resolveLockedScheduleFields(
      board.items,
      board.predColumnId,
      board.linkColumnId,
      linkColumn?.options,
      board.typeColumnId,
      typeColumn?.options,
      board.manualStartColumnId,
      board.manualDurationColumnId
    );
    const itemsByGroup = new Map<string, ItemData[]>();
    for (const i of board.items) {
      const list = itemsByGroup.get(i.groupId) ?? [];
      list.push(i);
      itemsByGroup.set(i.groupId, list);
    }
    // WBS 碼只在自己的分組樹裡有意義,逐組算。
    const wbsByItemId = new Map<string, string>();
    for (const groupItems of itemsByGroup.values()) {
      for (const [id, code] of computeWbsCodes(groupItems)) wbsByItemId.set(id, code);
    }

    for (const item of board.items) {
      const personIds = item.cellValues
        .filter((cv) => board.columns.find((c) => c.id === cv.columnId)?.type === "PERSON")
        .flatMap((cv) => getPersonIds(cv.value))
        .filter((id) => idSet.has(id));
      const matchedAssignments = item.assignments.filter((a) => idSet.has(a.userId));
      if (personIds.length === 0 && matchedAssignments.length === 0) continue;

      const allocationByUser = new Map<string, number | null>();
      for (const id of personIds) allocationByUser.set(id, null);
      for (const a of matchedAssignments) allocationByUser.set(a.userId, a.allocationPct);

      const statusValue = statusColumn
        ? item.cellValues.find((cv) => cv.columnId === statusColumn.id)?.value
        : null;
      const status = statusOptions.find((o) => o.id === statusValue) ?? null;

      const range =
        board.ganttStartColumnId && board.ganttDurationColumnId
          ? getItemDateRange(
              item,
              board.ganttStartColumnId,
              board.ganttDurationColumnId,
              board.ganttDurationMode,
              holidays
            )
          : null;

      const progressPct = board.progressColumnId
        ? computeItemProgress(item, board.items, board.progressColumnId)
        : null;

      const nameColor = resolveItemNameColor(item, board, statusColumn ?? null, range);

      result.push({
        boardId: board.id,
        boardName: board.name,
        itemId: item.id,
        itemName: item.name,
        wbsCode: wbsByItemId.get(item.id) ?? "",
        groupId: item.groupId,
        groupName: groupNameById.get(item.groupId) ?? "",
        createdById: item.createdById,
        status,
        progressPct,
        startDate: range?.start ?? null,
        dueDate: range?.end ?? null,
        assignees: [...allocationByUser.entries()]
          .map(([id, allocationPct]) => ({ name: userById.get(id) ?? "", allocationPct }))
          .filter((a) => a.name),
        fullItem: item,
        columns: board.columns,
        progressColumnId: board.progressColumnId,
        ganttStartColumnId: board.ganttStartColumnId,
        ganttDurationColumnId: board.ganttDurationColumnId,
        ganttEndColumnId: board.ganttEndColumnId,
        predColumnId: board.predColumnId,
        linkColumnId: board.linkColumnId,
        groupItems: itemsByGroup.get(item.groupId) ?? [],
        scheduleLock: scheduleLocks.get(item.id) ?? null,
        nameColor,
        scheduleHint,
      });
    }
  }

  result.sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.getTime() - b.dueDate.getTime();
  });
  return result;
}
