/**
 * 週報:一週一份的快照與差異。
 *
 * 這個檔案刻意不碰資料庫 —— 它只做三件事:算出一週的邊界、把這一週跟上
 * 一週比出差異、把結果排版成 Markdown。這樣它整個測得到,而「這週完成了
 * 什麼」也就不必靠解析活動紀錄那幾句中文去猜。
 *
 * 差異是拿上一週存下來的那份比出來的,不是從日誌推的:一個工作項這週在
 * 已完成、上一週不在,就是這週完成的。上一週沒有任何一份時不假裝比得出
 * 來,直接說這是第一份。
 */

/** 一個工作項在週報裡的樣子 —— 剛好夠識別它、又不會把整包資料存兩份。 */
export type ReportItem = {
  id: string;
  wbsCode: string;
  name: string;
  boardName: string;
  groupName: string;
  /** 甘特圖上的結束日,"YYYY-MM-DD"。 */
  end: string;
};

export type BoardLine = {
  boardId: string;
  boardName: string;
  programName: string | null;
  total: number;
  done: number;
  overdue: number;
  inProgress: number;
  notStarted: number;
};

export type BudgetLine = {
  itemId: string;
  boardName: string;
  phaseName: string;
  approved: number;
  spent: number;
  committed: number;
  remaining: number;
  /** 已花費 + 已下單 > 核准。 */
  over: boolean;
};

export type DelayLine = {
  boardName: string;
  projectDelayDays: number;
  culprits: { wbsCode: string; name: string; ownDelayDays: number; downstreamCount: number }[];
};

export type WeeklyReportData = {
  weekStart: string;
  weekEnd: string;
  /** 產出的那一刻 —— 快照的部分是這個時間點的樣子。 */
  generatedAt: string;
  viewerName: string;
  boards: BoardLine[];
  overdue: ReportItem[];
  upcoming: ReportItem[];
  doneTotal: number;
  budgets: BudgetLine[];
  delays: DelayLine[];
  /** 這一週的異動筆數,照看板分。 */
  activity: { boardName: string; count: number }[];
};

export type WeeklyReportDiff = {
  /** 上一週沒有可比的那一份。 */
  firstEver: boolean;
  /** 這週進到已完成的。 */
  completed: ReportItem[];
  /** 這週才變成逾期的。 */
  newlyOverdue: ReportItem[];
  /** 上週逾期、這週不逾期了的。 */
  recovered: ReportItem[];
};

const DAY_MS = 86_400_000;

function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 包含這一天的那個 ISO 週(週一到週日)。
 *
 * 用 UTC 算,因為週報的日期一路上都是 "YYYY-MM-DD" 字串;用本地時間的話,
 * 同一個字串在不同時區會落到不同的週。
 */
export function weekRangeOf(dayIso: string): { weekStart: string; weekEnd: string } {
  const date = utc(dayIso);
  // getUTCDay:週日是 0。往前推到週一,所以週日要退 6 天而不是 0 天。
  const backToMonday = (date.getUTCDay() + 6) % 7;
  const start = new Date(date.getTime() - backToMonday * DAY_MS);
  return { weekStart: iso(start), weekEnd: iso(new Date(start.getTime() + 6 * DAY_MS)) };
}

/** 上一個 ISO 週。週一早上跑的排程要的是這個,不是它自己那一週。 */
export function previousWeekOf(weekStartIso: string): { weekStart: string; weekEnd: string } {
  return weekRangeOf(iso(new Date(utc(weekStartIso).getTime() - 7 * DAY_MS)));
}

/** ISO 週數 —— 週四落在哪一年,那一週就算哪一年的。 */
export function isoWeekLabel(weekStartIso: string): string {
  const thursday = new Date(utc(weekStartIso).getTime() + 3 * DAY_MS);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const backToMonday = (firstThursday.getUTCDay() + 6) % 7;
  const week1Monday = new Date(firstThursday.getTime() - backToMonday * DAY_MS);
  const weekNumber = Math.round((utc(weekStartIso).getTime() - week1Monday.getTime()) / (7 * DAY_MS)) + 1;
  return `${thursday.getUTCFullYear()} W${String(weekNumber).padStart(2, "0")}`;
}

/**
 * 這一週跟上一週的差異。
 *
 * previous 是 null 代表沒有上一週可比 —— 那就什麼都不宣稱,而不是把這週
 * 所有已完成的都說成「這週完成的」。第一份週報那樣講會是一份假的成績單。
 */
export function diffWeeks(
  current: { done: ReportItem[]; overdue: ReportItem[] },
  previous: { done: ReportItem[]; overdue: ReportItem[] } | null
): WeeklyReportDiff {
  if (!previous) return { firstEver: true, completed: [], newlyOverdue: [], recovered: [] };

  const wasDone = new Set(previous.done.map((i) => i.id));
  const wasOverdue = new Set(previous.overdue.map((i) => i.id));
  const isOverdue = new Set(current.overdue.map((i) => i.id));
  const isDone = new Set(current.done.map((i) => i.id));

  return {
    firstEver: false,
    completed: current.done.filter((i) => !wasDone.has(i.id)),
    newlyOverdue: current.overdue.filter((i) => !wasOverdue.has(i.id)),
    // 比的是「現在完成了沒」而不是「上週完成了沒」:一個上週逾期、這週做完
    // 的工作項不是趕上了,是做完了,它已經在完成那一欄,不該再數第二次。
    recovered: previous.overdue.filter((i) => !isOverdue.has(i.id) && !isDone.has(i.id)),
  };
}

function money(value: number): string {
  return value.toLocaleString("zh-TW");
}

function itemLines(items: ReportItem[], limit = 20): string[] {
  const shown = items.slice(0, limit);
  // 已完成的那幾項沒有到期日可談,不要留一個空括號在後面。
  const lines = shown.map(
    (i) => `- ${i.boardName} / ${i.groupName} · ${i.wbsCode} ${i.name}${i.end ? `(${i.end})` : ""}`
  );
  if (items.length > shown.length) lines.push(`- ……另外還有 ${items.length - shown.length} 項`);
  return lines;
}

/**
 * 排版成 Markdown。
 *
 * 快照的部分(逾期、七天內到期)標明是產出當下的樣子,差異的部分才是
 * 「這一週」發生的事 —— 兩者混在一起講,讀的人會把快照當成本週新增。
 */
export function renderWeeklyReportMarkdown(data: WeeklyReportData, diff: WeeklyReportDiff): string {
  const out: string[] = [];
  const label = isoWeekLabel(data.weekStart);

  out.push(`# 週報 ${label}(${data.weekStart} ~ ${data.weekEnd})`);
  out.push("");
  out.push(`視角:${data.viewerName}・產出時間:${data.generatedAt}`);
  out.push("");

  out.push("## 這一週");
  out.push("");
  if (diff.firstEver) {
    out.push("這是第一份週報,沒有上一週可以比,所以下面只有目前的狀態。");
  } else {
    out.push(
      `完成 ${diff.completed.length} 項・新逾期 ${diff.newlyOverdue.length} 項・` +
        `脫離逾期 ${diff.recovered.length} 項`
    );
    if (diff.completed.length > 0) {
      out.push("", "**完成**", ...itemLines(diff.completed));
    }
    if (diff.newlyOverdue.length > 0) {
      out.push("", "**新逾期**", ...itemLines(diff.newlyOverdue));
    }
    if (diff.recovered.length > 0) {
      out.push("", "**脫離逾期**", ...itemLines(diff.recovered));
    }
  }
  out.push("");

  out.push("## 看板進度(產出當下)");
  out.push("");
  if (data.boards.length === 0) {
    out.push("沒有看得到的看板。");
  } else {
    out.push("| 看板 | 專案群組 | 工作項 | 完成 | 逾期 | 進行中 | 未開始 |");
    out.push("|---|---|---:|---:|---:|---:|---:|");
    for (const b of data.boards) {
      out.push(
        `| ${b.boardName} | ${b.programName ?? "—"} | ${b.total} | ${b.done} | ` +
          `${b.overdue} | ${b.inProgress} | ${b.notStarted} |`
      );
    }
  }
  out.push("");

  out.push(`## 目前逾期(${data.overdue.length} 項)`);
  out.push("");
  out.push(data.overdue.length === 0 ? "沒有逾期。" : itemLines(data.overdue).join("\n"));
  out.push("");

  out.push(`## 七天內到期(${data.upcoming.length} 項)`);
  out.push("");
  out.push(data.upcoming.length === 0 ? "七天內沒有到期的。" : itemLines(data.upcoming).join("\n"));
  out.push("");

  if (data.delays.length > 0) {
    out.push("## 對比基準線的延誤");
    out.push("");
    for (const d of data.delays) {
      out.push(`**${d.boardName}**:整體晚 ${d.projectDelayDays} 天`);
      if (d.culprits.length > 0) {
        out.push(
          ...d.culprits.map(
            (c) =>
              `- ${c.wbsCode} ${c.name}:自己晚 ${c.ownDelayDays} 天,` +
              `後面壓著 ${c.downstreamCount} 項`
          )
        );
      }
      out.push("");
    }
  }

  const over = data.budgets.filter((b) => b.over);
  out.push("## 預算");
  out.push("");
  if (data.budgets.length === 0) {
    out.push("沒有編列預算的階段。");
  } else {
    out.push(over.length === 0 ? "沒有超支的階段。" : `**${over.length} 個階段超支:**`);
    for (const b of over) {
      out.push(
        `- ${b.boardName} / ${b.phaseName}:核准 ${money(b.approved)}、` +
          `已花 ${money(b.spent)}、已下單 ${money(b.committed)}、剩 ${money(b.remaining)}`
      );
    }
  }
  out.push("");

  if (data.activity.length > 0) {
    out.push("## 本週異動筆數");
    out.push("");
    out.push(...data.activity.map((a) => `- ${a.boardName}:${a.count} 筆`));
    out.push("");
  }

  return out.join("\n");
}
