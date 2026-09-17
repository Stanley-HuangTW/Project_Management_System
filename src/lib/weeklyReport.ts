/**
 * 週報:一週一份的快照與差異。
 *
 * 這個檔案刻意不碰資料庫 —— 它只做三件事:算出一週的邊界、把這一週跟上
 * 一週比出差異、把結果排版成 Markdown。這樣它整個測得到,而「這週發生了
 * 什麼」也就不必靠解析活動紀錄那幾句中文去猜。
 *
 * 差異是拿上一週存下來的那份比出來的:一個工作項這週在已完成、上一週不
 * 在,就是這週完成的;日期跟上週不一樣,就是改期了。上一週沒有任何一份時
 * 不假裝比得出來,直接說這是第一份。
 */

/** 一個工作項在快照裡的樣子。存得下整份名單,差異才算得出來。 */
export type ReportItem = {
  id: string;
  wbsCode: string;
  name: string;
  boardName: string;
  groupName: string;
  /** 所屬專案群組;沒有歸屬的看板是 null。 */
  programName: string | null;
  start: string | null;
  end: string | null;
  /** 狀態欄的選項標籤。沒設狀態欄或還沒選就是 null。 */
  status: string | null;
  ownerIds: string[];
  ownerNames: string[];
  isMilestone: boolean;
  isCritical: boolean;
  /** 產出當下落在哪一桶 —— 差異就是拿它跟上週比。 */
  bucket: ItemBucket;
};

export type ItemBucket = "done" | "overdue" | "upcoming" | "other";

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
  over: boolean;
};

export type DelayLine = {
  boardName: string;
  projectDelayDays: number;
  culprits: { wbsCode: string; name: string; ownDelayDays: number; downstreamCount: number }[];
};

/** 一個部門:誰帶、有誰、手上有哪些事。 */
export type DepartmentSection = {
  /** 例如「SW(M3)」—— 部門是掛在分組底下的,同一個 SW 在不同分組是不同組人。 */
  key: string;
  discipline: string;
  groupName: string;
  boardName: string;
  dmNames: string[];
  memberNames: string[];
  overdue: ReportItem[];
  upcoming: ReportItem[];
  inProgress: ReportItem[];
};

export type ProgramSection = {
  programName: string | null;
  boards: BoardLine[];
  items: ReportItem[];
  budgets: BudgetLine[];
  delays: DelayLine[];
};

export type WeeklyReportData = {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  viewerName: string;
  programs: ProgramSection[];
  departments: DepartmentSection[];
  /** 這一週的異動筆數,照看板分。 */
  activity: { boardName: string; count: number }[];
};

/** 一項改期。前後都留著,不然讀的人只知道「變了」。 */
export type ScheduleChange = {
  item: ReportItem;
  fromStart: string | null;
  toStart: string | null;
  fromEnd: string | null;
  toEnd: string | null;
  /** 結束日往後幾天。往前是負的。 */
  slipDays: number | null;
};

export type StatusChange = { item: ReportItem; from: string | null; to: string | null };

export type BudgetChange = {
  line: BudgetLine;
  fromSpent: number;
  fromCommitted: number;
  /** 這週從「沒超支」變成「超支」。 */
  newlyOver: boolean;
};

export type WeeklyReportDiff = {
  firstEver: boolean;
  completed: ReportItem[];
  newlyOverdue: ReportItem[];
  recovered: ReportItem[];
  statusChanged: StatusChange[];
  scheduleChanged: ScheduleChange[];
  budgetChanged: BudgetChange[];
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

/** 快照裡全部的工作項,不分專案。差異是對整份名單算的。 */
export function allItems(data: { programs: ProgramSection[] }): ReportItem[] {
  return data.programs.flatMap((p) => p.items);
}

function allBudgets(data: { programs: ProgramSection[] }): BudgetLine[] {
  return data.programs.flatMap((p) => p.budgets);
}

function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / DAY_MS);
}

/**
 * 這一週跟上一週的差異。
 *
 * previous 是 null 代表沒有上一週可比 —— 那就什麼都不宣稱,而不是把這週
 * 所有已完成的都說成「這週完成的」。第一份週報那樣講會是一份假的成績單。
 *
 * previous 也可能是舊版格式(欄位比較少)。缺的欄位一律當成「沒有變化」而
 * 不是「從無變成有」,否則改版當週會生出一份每一項都在變的假報告。
 */
export function diffWeeks(
  current: { programs: ProgramSection[] },
  previous: { programs: ProgramSection[] } | null
): WeeklyReportDiff {
  const empty: WeeklyReportDiff = {
    firstEver: true,
    completed: [],
    newlyOverdue: [],
    recovered: [],
    statusChanged: [],
    scheduleChanged: [],
    budgetChanged: [],
  };
  if (!previous) return empty;

  const now = allItems(current);
  const before = allItems(previous);
  // 刻意不因為「上週沒有工作項」就整個放棄:預算可能動了。舊版格式擋在
  // loadSnapshot 那一層(沒有 programs 這個欄位就回 null),不是擋在這裡。

  const was = new Map(before.map((i) => [i.id, i]));
  const isNow = new Map(now.map((i) => [i.id, i]));

  const completed: ReportItem[] = [];
  const newlyOverdue: ReportItem[] = [];
  const statusChanged: StatusChange[] = [];
  const scheduleChanged: ScheduleChange[] = [];

  for (const item of now) {
    const old = was.get(item.id);
    if (!old) continue; // 這週才新增的,沒有「變化」可談。

    if (item.bucket === "done" && old.bucket !== "done") completed.push(item);
    if (item.bucket === "overdue" && old.bucket !== "overdue") newlyOverdue.push(item);

    // 狀態變成完成的那一筆已經在「完成」裡了,不重複講第二次。
    if (item.status !== old.status && item.bucket !== "done") {
      statusChanged.push({ item, from: old.status, to: item.status });
    }

    if (item.start !== old.start || item.end !== old.end) {
      scheduleChanged.push({
        item,
        fromStart: old.start,
        toStart: item.start,
        fromEnd: old.end,
        toEnd: item.end,
        slipDays: old.end && item.end ? daysBetween(old.end, item.end) : null,
      });
    }
  }

  // 比的是「現在完成了沒」而不是「上週完成了沒」:一個上週逾期、這週做完
  // 的工作項不是趕上了,是做完了,它已經在完成那一欄,不該再數第二次。
  const recovered = before.filter((old) => {
    if (old.bucket !== "overdue") return false;
    const item = isNow.get(old.id);
    return !!item && item.bucket !== "overdue" && item.bucket !== "done";
  });

  const oldBudgets = new Map(allBudgets(previous).map((b) => [b.itemId, b]));
  const budgetChanged: BudgetChange[] = [];
  for (const line of allBudgets(current)) {
    const old = oldBudgets.get(line.itemId);
    if (!old) continue;
    if (line.spent === old.spent && line.committed === old.committed && line.over === old.over) continue;
    budgetChanged.push({
      line,
      fromSpent: old.spent,
      fromCommitted: old.committed,
      newlyOver: line.over && !old.over,
    });
  }

  return {
    firstEver: false,
    completed,
    newlyOverdue,
    recovered,
    statusChanged,
    scheduleChanged,
    budgetChanged,
  };
}

function money(value: number): string {
  return value.toLocaleString("zh-TW");
}

function itemLine(i: ReportItem): string {
  const tags = [i.isMilestone ? "🚩里程碑" : "", i.isCritical ? "⚡要徑" : ""].filter(Boolean).join(" ");
  const owner = i.ownerNames.length > 0 ? `・${i.ownerNames.join("、")}` : "";
  const due = i.end ? `(${i.end})` : "";
  return `- ${i.boardName} / ${i.groupName} · ${i.wbsCode} ${i.name}${due}${owner}${tags ? ` ${tags}` : ""}`;
}

function itemLines(items: ReportItem[], limit = 15): string[] {
  const shown = items.slice(0, limit);
  const lines = shown.map(itemLine);
  if (items.length > shown.length) lines.push(`- ……另外還有 ${items.length - shown.length} 項`);
  return lines;
}

/** 只放某個專案的那幾項。差異是整份算的,分專案顯示時才切開。 */
function inProgram<T extends { item: ReportItem }>(rows: T[], programName: string | null): T[] {
  return rows.filter((r) => r.item.programName === programName);
}

function section(title: string, body: string[]): string[] {
  return body.length === 0 ? [] : ["", title, ...body];
}

/**
 * 排版成 Markdown。
 *
 * 分專案排,因為看週報的人是照專案在想事情的;部門那一段再切一次,因為
 * 帶人的人要問的是「我的人手上有什麼」。快照的部分標明是產出當下的樣子,
 * 差異的部分才是「這一週」發生的事 —— 兩者混在一起講,讀的人會把快照當成
 * 本週新增。
 */
export function renderWeeklyReportMarkdown(data: WeeklyReportData, diff: WeeklyReportDiff): string {
  const out: string[] = [];
  const label = isoWeekLabel(data.weekStart);

  out.push(`# 週報 ${label}(${data.weekStart} ~ ${data.weekEnd})`);
  out.push("");
  out.push(`視角:${data.viewerName}・產出時間:${data.generatedAt}`);
  out.push("");

  out.push("## 本週摘要");
  out.push("");
  if (diff.firstEver) {
    out.push("這是第一份週報,沒有上一週可以比,所以下面只有目前的狀態。");
  } else {
    out.push(
      `完成 ${diff.completed.length}・新逾期 ${diff.newlyOverdue.length}・` +
        `脫離逾期 ${diff.recovered.length}・改期 ${diff.scheduleChanged.length}・` +
        `狀態更新 ${diff.statusChanged.length}・預算異動 ${diff.budgetChanged.length}`
    );
    const newlyOver = diff.budgetChanged.filter((b) => b.newlyOver);
    if (newlyOver.length > 0) {
      out.push("");
      out.push(`⚠ 這週有 ${newlyOver.length} 個階段從沒超支變成超支。`);
    }
  }
  out.push("");

  for (const program of data.programs) {
    out.push(`## 專案:${program.programName ?? "(未歸屬專案群組的看板)"}`);
    out.push(...renderProgram(program, diff));
    out.push("");
  }

  out.push("## 各部門工作事項");
  out.push("");
  if (data.departments.length === 0) {
    out.push("沒有設定分組角色與部門名冊,所以分不出部門。分組角色設定在「分組角色設定」頁。");
  } else {
    for (const dept of data.departments) {
      out.push(`### ${dept.discipline}・${dept.boardName} / ${dept.groupName}`);
      out.push("");
      out.push(
        `DM:${dept.dmNames.length > 0 ? dept.dmNames.join("、") : "未指定"}・` +
          `成員:${dept.memberNames.length > 0 ? dept.memberNames.join("、") : "未設定"}`
      );
      out.push(
        ...section(`**逾期(${dept.overdue.length})**`, itemLines(dept.overdue, 10)),
        ...section(`**未來七天(${dept.upcoming.length})**`, itemLines(dept.upcoming, 10)),
        ...section(`**進行中(${dept.inProgress.length})**`, itemLines(dept.inProgress, 10))
      );
      if (dept.overdue.length + dept.upcoming.length + dept.inProgress.length === 0) {
        out.push("", "目前沒有進行中、逾期或七天內到期的工作項。");
      }
      out.push("");
    }
  }

  if (data.activity.length > 0) {
    out.push("## 本週異動筆數");
    out.push("");
    out.push(...data.activity.map((a) => `- ${a.boardName}:${a.count} 筆`));
    out.push("");
  }

  return out.join("\n");
}

function renderProgram(program: ProgramSection, diff: WeeklyReportDiff): string[] {
  const out: string[] = [];
  const name = program.programName;
  const items = program.items;

  const overdue = items.filter((i) => i.bucket === "overdue");
  const upcoming = items.filter((i) => i.bucket === "upcoming");
  const milestones = items.filter((i) => i.isMilestone && i.bucket !== "done");
  const critical = items.filter((i) => i.isCritical && i.bucket !== "done");

  if (!diff.firstEver) {
    const completed = diff.completed.filter((i) => i.programName === name);
    const newlyOverdue = diff.newlyOverdue.filter((i) => i.programName === name);
    const recovered = diff.recovered.filter((i) => i.programName === name);
    const statusChanged = inProgram(diff.statusChanged, name);
    const scheduleChanged = inProgram(diff.scheduleChanged, name);

    const body = [
      ...section(`**完成(${completed.length})**`, itemLines(completed)),
      ...section(`**新逾期(${newlyOverdue.length})**`, itemLines(newlyOverdue)),
      ...section(`**脫離逾期(${recovered.length})**`, itemLines(recovered)),
      ...section(
        `**狀態更新(${statusChanged.length})**`,
        statusChanged
          .slice(0, 15)
          .map(
            (c) =>
              `- ${c.item.wbsCode} ${c.item.name}:${c.from ?? "未設定"} → ${c.to ?? "未設定"}`
          )
      ),
      ...section(
        `**時程變化(${scheduleChanged.length})**`,
        scheduleChanged
          .slice(0, 15)
          .map((c) => {
            const slip =
              c.slipDays === null ? "" : c.slipDays > 0 ? `,延後 ${c.slipDays} 天` : c.slipDays < 0 ? `,提前 ${-c.slipDays} 天` : "";
            return `- ${c.item.wbsCode} ${c.item.name}:${c.fromStart ?? "—"}~${c.fromEnd ?? "—"} → ${c.toStart ?? "—"}~${c.toEnd ?? "—"}${slip}`;
          })
      ),
    ];
    out.push("", "### 這一週");
    out.push(body.length === 0 ? "\n這個專案這一週沒有變化。" : body.join("\n"));
  }

  out.push("", `### 目前逾期(${overdue.length})`, "");
  out.push(overdue.length === 0 ? "沒有逾期。" : itemLines(overdue).join("\n"));

  out.push("", `### 未來七天(${upcoming.length})`, "");
  out.push(upcoming.length === 0 ? "七天內沒有到期的。" : itemLines(upcoming).join("\n"));

  out.push("", `### 里程碑(${milestones.length})`, "");
  out.push(milestones.length === 0 ? "沒有未完成的里程碑。" : itemLines(milestones, 20).join("\n"));

  out.push("", `### 要徑(${critical.length})`, "");
  out.push(
    critical.length === 0
      ? "沒有要徑工作項,或這個專案還沒設好前置依賴。"
      : itemLines(critical, 20).join("\n")
  );

  if (program.delays.length > 0) {
    out.push("", "### 對比基準線的延誤", "");
    for (const d of program.delays) {
      out.push(`**${d.boardName}**:整體晚 ${d.projectDelayDays} 天`);
      out.push(
        ...d.culprits.map(
          (c) => `- ${c.wbsCode} ${c.name}:自己晚 ${c.ownDelayDays} 天,後面壓著 ${c.downstreamCount} 項`
        )
      );
    }
  }

  out.push("", "### 預算", "");
  if (program.budgets.length === 0) {
    out.push("沒有編列預算的階段。");
  } else {
    const over = program.budgets.filter((b) => b.over);
    out.push(over.length === 0 ? "沒有超支的階段。" : `**${over.length} 個階段超支:**`);
    for (const b of over) {
      out.push(
        `- ${b.boardName} / ${b.phaseName}:核准 ${money(b.approved)}、已花 ${money(b.spent)}、` +
          `已下單 ${money(b.committed)}、剩 ${money(b.remaining)}`
      );
    }
    const changed = diff.budgetChanged.filter((c) =>
      program.budgets.some((b) => b.itemId === c.line.itemId)
    );
    out.push(
      ...section(
        `**本週異動(${changed.length})**`,
        changed.map(
          (c) =>
            `- ${c.line.phaseName}:已花 ${money(c.fromSpent)} → ${money(c.line.spent)}、` +
            `已下單 ${money(c.fromCommitted)} → ${money(c.line.committed)}${c.newlyOver ? " ⚠ 開始超支" : ""}`
        )
      )
    );
  }

  out.push("", "### 看板進度(產出當下)", "");
  if (program.boards.length === 0) {
    out.push("沒有看得到的看板。");
  } else {
    out.push("| 看板 | 工作項 | 完成 | 逾期 | 進行中 | 未開始 |");
    out.push("|---|---:|---:|---:|---:|---:|");
    for (const b of program.boards) {
      out.push(
        `| ${b.boardName} | ${b.total} | ${b.done} | ${b.overdue} | ${b.inProgress} | ${b.notStarted} |`
      );
    }
  }

  return out;
}
