/**
 * 工時預估對照 — 純邏輯。
 *
 * 一個人的工時有兩種「預估」,跟實際登記的工時並排看:
 *
 *   人力表預估:人力表(預算頁)裡指到這個人的名額,每月投入多少(1 = 整個月全職),
 *             攤到那個月的每個工作日 → 投入 × 每日工時。
 *   工作項預估:指派給這個人的工作項,依它的配置比例 × 每日工時,攤到工作項起訖之間的每個工作日。
 *
 * 兩者都只落在工作日(週一到週五、不是公司假日);假日加班登記的工時照算實際,但沒有預估可比。
 * 實際只算有對應專案的(專案工作項,與對應專案的會議)——沒有對應專案的會議與其他另外列出,
 * 不拿去跟專案的預估比,否則每開一場部門週會,專案就「少做」兩小時。
 */

/** "YYYY-MM-DD" → 小時。 */
export type DayHours = Record<string, number>;

export type EstimateItem = {
  itemId: string;
  itemName: string;
  allocationPct: number;
  /** 工作項起訖,"YYYY-MM-DD"。 */
  startDate: string;
  endDate: string;
  hours: DayHours;
};

export type EstimateProject = {
  boardId: string;
  boardName: string;
  /** 人力表裡指到這個人的名額代號(PM、SW2…)。 */
  slotLabels: string[];
  labour: DayHours;
  items: EstimateItem[];
};

export type EstimateWeek = {
  weekStart: string;
  hoursPerDay: number;
  /** 這一週的七天裡,哪幾天是工作日。 */
  workdays: string[];
  projects: EstimateProject[];
};

/** 一筆已登記(沒被退回)的工時。 */
export type ActualEntry = {
  date: string;
  hours: number;
  boardId: string | null;
  boardName: string | null;
  itemId: string | null;
  itemName: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoMonth(day: string): string {
  return day.slice(0, 7);
}

/** 週一到週五、而且不是公司假日。 */
export function isWorkday(day: string, holidays: Set<string>): boolean {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !holidays.has(day);
}

/** 人力表:每月投入(FTE)攤到那個月的每個工作日。同一個人在同一個專案有好幾個名額時,先把每月投入加總再傳進來。 */
export function labourHoursByDay(
  fteByMonth: Record<string, number>,
  days: string[],
  workdays: Set<string>,
  hoursPerDay: number
): DayHours {
  const out: DayHours = {};
  for (const day of days) {
    if (!workdays.has(day)) continue;
    const hours = round2((fteByMonth[isoMonth(day)] ?? 0) * hoursPerDay);
    if (hours > 0) out[day] = hours;
  }
  return out;
}

/** 工作項:配置比例 × 每日工時,攤到起訖之間(含頭尾)的每個工作日。 */
export function itemHoursByDay(
  allocationPct: number,
  startDate: string,
  endDate: string,
  days: string[],
  workdays: Set<string>,
  hoursPerDay: number
): DayHours {
  const out: DayHours = {};
  const hours = round2((allocationPct / 100) * hoursPerDay);
  if (hours <= 0) return out;
  for (const day of days) {
    if (workdays.has(day) && day >= startDate && day <= endDate) out[day] = hours;
  }
  return out;
}

export function sumHours(hours: DayHours, days: string[]): number {
  return round2(days.reduce((sum, d) => sum + (hours[d] ?? 0), 0));
}

export type Comparison = {
  estimate: number;
  actual: number;
  /** 實際 − 預估;正的是多做、負的是還沒做到。 */
  diff: number;
  /** 實際 ÷ 預估,四捨五入的百分比。沒有預估(0)就是 null——除不出來,不顯示 0% 騙人。 */
  pct: number | null;
  /** 100 − 達成率;負的是超出預估。沒有預估是 null。 */
  remainingPct: number | null;
};

export function compareHours(estimate: number, actual: number): Comparison {
  const e = round2(estimate);
  const a = round2(actual);
  const pct = e > 0 ? Math.round((a / e) * 100) : null;
  return { estimate: e, actual: a, diff: round2(a - e), pct, remainingPct: pct === null ? null : 100 - pct };
}

export type EstimateRow = {
  key: string;
  kind: "project" | "item";
  label: string;
  /** 專案列:人力表的名額代號。 */
  sublabel: string;
  /** 人力表預估;工作項列沒有(人力表是專案層級的)。 */
  labour: number | null;
  work: number;
  actual: number;
  vsLabour: Comparison | null;
  vsWork: Comparison;
  children: EstimateRow[];
};

export type EstimateTable = {
  rows: EstimateRow[];
  /** 全部專案加起來。 */
  total: { labour: number; work: number; actual: number; vsLabour: Comparison; vsWork: Comparison };
  /** 沒有對應專案的工時(部門週會、請假…),不跟預估比。 */
  other: number;
};

/**
 * 某幾天(一整週,或點選的某一天)的對照表:每個專案一列、底下是它的工作項。
 * 專案的實際 = 專案工作項的工時 + 對應到這個專案的會議與其他;工作項的實際 = 登記在那個工作項上的工時。
 * 沒有預估、只有實際的專案(登記了沒被指派的專案)也要有一列,預估是 0。
 */
export function buildEstimateTable(week: EstimateWeek, actuals: ActualEntry[], dates: string[]): EstimateTable {
  const inScope = new Set(dates);
  const scoped = actuals.filter((a) => inScope.has(a.date));

  type Draft = {
    boardId: string;
    boardName: string;
    sublabel: string;
    labour: number;
    items: Map<string, { name: string; work: number; actual: number }>;
    actual: number;
  };
  const drafts = new Map<string, Draft>();
  const draftOf = (boardId: string, boardName: string): Draft => {
    let d = drafts.get(boardId);
    if (!d) {
      d = { boardId, boardName, sublabel: "", labour: 0, items: new Map(), actual: 0 };
      drafts.set(boardId, d);
    }
    return d;
  };

  for (const p of week.projects) {
    const d = draftOf(p.boardId, p.boardName);
    d.sublabel = p.slotLabels.join("、");
    d.labour = sumHours(p.labour, dates);
    for (const item of p.items) {
      d.items.set(item.itemId, { name: item.itemName, work: sumHours(item.hours, dates), actual: 0 });
    }
  }

  let other = 0;
  for (const a of scoped) {
    if (!a.boardId) {
      other += a.hours;
      continue;
    }
    const d = draftOf(a.boardId, a.boardName ?? "");
    d.actual += a.hours;
    if (a.itemId) {
      const item = d.items.get(a.itemId) ?? { name: a.itemName ?? "", work: 0, actual: 0 };
      item.actual += a.hours;
      d.items.set(a.itemId, item);
    }
  }

  const rows: EstimateRow[] = [...drafts.values()]
    .map((d): EstimateRow => {
      const children: EstimateRow[] = [...d.items.entries()]
        .map(([itemId, item]): EstimateRow => ({
          key: `${d.boardId}:${itemId}`,
          kind: "item",
          label: item.name,
          sublabel: "",
          labour: null,
          work: round2(item.work),
          actual: round2(item.actual),
          vsLabour: null,
          vsWork: compareHours(item.work, item.actual),
          children: [],
        }))
        // 預估與實際都是 0 的(這幾天它不在範圍裡)不列出來。
        .filter((c) => c.work > 0 || c.actual > 0)
        .sort((a, b) => b.work - a.work || b.actual - a.actual || a.label.localeCompare(b.label, "zh-TW"));
      const work = round2(children.reduce((s, c) => s + c.work, 0));
      return {
        key: d.boardId,
        kind: "project",
        label: d.boardName,
        sublabel: d.sublabel,
        labour: round2(d.labour),
        work,
        actual: round2(d.actual),
        vsLabour: compareHours(d.labour, d.actual),
        vsWork: compareHours(work, d.actual),
        children,
      };
    })
    // 這幾天跟這個專案完全沒關係(沒預估也沒實際)的不列出來。
    .filter((r) => r.labour! > 0 || r.work > 0 || r.actual > 0)
    .sort((a, b) => a.label.localeCompare(b.label, "zh-TW"));

  const labour = round2(rows.reduce((s, r) => s + (r.labour ?? 0), 0));
  const work = round2(rows.reduce((s, r) => s + r.work, 0));
  const actual = round2(rows.reduce((s, r) => s + r.actual, 0));
  return {
    rows,
    total: { labour, work, actual, vsLabour: compareHours(labour, actual), vsWork: compareHours(work, actual) },
    other: round2(other),
  };
}

export type DaySummary = {
  date: string;
  workday: boolean;
  labour: number;
  work: number;
  /** 有對應專案的實際。 */
  actual: number;
  /** 沒有對應專案的實際。 */
  other: number;
  vsLabour: Comparison;
  vsWork: Comparison;
};

/** 每天一列:人力表預估、工作項預估、實際,以及各自的差異與達成率。 */
export function summarizeByDay(week: EstimateWeek, actuals: ActualEntry[], days: string[]): DaySummary[] {
  const workdays = new Set(week.workdays);
  return days.map((date) => {
    const labour = round2(week.projects.reduce((s, p) => s + (p.labour[date] ?? 0), 0));
    const work = round2(week.projects.reduce((s, p) => s + p.items.reduce((t, i) => t + (i.hours[date] ?? 0), 0), 0));
    let actual = 0;
    let other = 0;
    for (const a of actuals) {
      if (a.date !== date) continue;
      if (a.boardId) actual += a.hours;
      else other += a.hours;
    }
    return {
      date,
      workday: workdays.has(date),
      labour,
      work,
      actual: round2(actual),
      other: round2(other),
      vsLabour: compareHours(labour, actual),
      vsWork: compareHours(work, actual),
    };
  });
}
