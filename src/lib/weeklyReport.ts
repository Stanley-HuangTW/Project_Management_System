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

import { RISK_KIND_LABELS, RISK_STATUS_LABELS, riskLinkTag, riskScore } from "@/lib/riskRegister";
import { taipeiDateOf } from "@/lib/itemEvents";

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
  /** Priority 欄目前的選項標籤(CRITICAL/HIGH/NORMAL)。沒設定就是 null。 */
  priority: string | null;
  /** 產出當下落在哪一桶 —— 差異就是拿它跟上週比。 */
  bucket: ItemBucket;
  /** 實際切成完成的時間(ISO)。有的話「這週完成」就以它為準,不必拿上週的快照去猜;舊版快照與沒有切換紀錄的是 undefined / null。 */
  completedAt?: string | null;
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
  /** 這一列預算範圍的 id:預算階段的 id,或看板上那一列工作項的 id。
   *  週報比對上週用它當身分,所以欄位名沿用舊的。 */
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

/** 一個人手上的事:逾期、這週做完的、接下來要到期的。 */
export type PersonSection = {
  userId: string;
  userName: string;
  role: "TEAM_LEADER" | "DM" | "MEMBER";
  /** Team Leader 不屬於單一職能,這裡放「Team Leader」本身。 */
  discipline: string;
  /** 所屬專案群組;沒有歸屬的看板是 null —— 跟 ReportItem.programName 同一個概念,
   *  渲染時要靠它把這個人歸進對的專案群組分頁。 */
  programName: string | null;
  groupName: string;
  boardName: string;
  overdue: ReportItem[];
  completedThisWeek: ReportItem[];
  /** 未來 upcomingDays 天內到期的——這個數字是外面傳進來的,不是寫死。 */
  upcoming: ReportItem[];
};

/** 風險/議題上的一則進度更新(負責人寫的時間軸)。 */
export type RiskUpdateLine = {
  authorName: string;
  /** "YYYY-MM-DD"(台灣時間) */
  date: string;
  /** 已截短。 */
  text: string;
};

/** 風險/議題登記簿(RiskEntry)在快照裡的樣子。 */
export type RiskLine = {
  id: string;
  boardName: string;
  programName: string | null;
  kind: "RISK" | "ISSUE";
  status: "OPEN" | "MITIGATING" | "PENDING_REVIEW" | "CLOSED";
  title: string;
  probability: number;
  impact: number;
  ownerName: string | null;
  dueDate: string | null;
  /** ISO 字串——拿來判斷「狀態沒變,但其他欄位這週動過」。 */
  updatedAt: string;
  // 以下是逐筆列出時用的詳細資訊,舊版快照沒有。
  /** 說明、對策(已截短)。 */
  description?: string | null;
  mitigation?: string | null;
  /** 從 Mantis 同步來的有編號與網址。 */
  mantisId?: number | null;
  mantisUrl?: string | null;
  /** 這一週新增的進度更新,依日期由舊到新。 */
  updates?: RiskUpdateLine[];
  /** 最近一次進度更新(不限這一週);從來沒有更新就是 null。 */
  latestUpdate?: RiskUpdateLine | null;
};

/** 這一週工作項上新增的資訊:更新(留言)、連結(網址)、附件、待辦事項、狀態變化。 */
export type ItemUpdateKind = "COMMENT" | "LINK" | "ATTACHMENT" | "TODO" | "STATUS";

export const ITEM_UPDATE_LABELS: Record<ItemUpdateKind, string> = {
  COMMENT: "更新",
  LINK: "連結",
  ATTACHMENT: "附件",
  TODO: "待辦事項",
  STATUS: "狀態",
};

/** 產生週報時,工作項底下要附哪幾種資訊(狀態變化一定會附)。預設全部都附。 */
export type WeeklyInfoOptions = { updates: boolean; links: boolean; todos: boolean };
export const DEFAULT_WEEKLY_INFO: WeeklyInfoOptions = { updates: true, links: true, todos: true };

export type ItemUpdateLine = {
  itemId: string;
  wbsCode: string;
  name: string;
  boardName: string;
  kind: ItemUpdateKind;
  /** 留言內容(已截短)、連結的顯示名稱、附件的檔名。 */
  text: string;
  /** 連結或附件的完整網址;留言沒有。 */
  url: string | null;
  authorName: string;
  /** "YYYY-MM-DD" */
  date: string;
};

/** 這一週看板頻道(對話)裡的一則發言。 */
export type ChannelMessageLine = {
  boardName: string;
  authorName: string;
  /** "YYYY-MM-DD"、"HH:mm"(台北時間) */
  date: string;
  time: string;
  text: string;
  /** 這則發言附的檔案與圖片的檔名。 */
  attachments: string[];
};

export type ProgramSection = {
  programName: string | null;
  boards: BoardLine[];
  items: ReportItem[];
  budgets: BudgetLine[];
  /** 這個專案有看板的預算金額這份週報的讀者看不到(沒有預算檢視權限),所以沒有列進 budgets。 */
  budgetHidden?: boolean;
  delays: DelayLine[];
  risks: RiskLine[];
  /** 這一週工作項上新增的留言、連結、附件。舊版快照沒有這個欄位。 */
  itemUpdates?: ItemUpdateLine[];
  /** 這一週這個專案的看板頻道裡的對話(收回的不算)。舊版快照、沒勾「更新」的週報沒有這個欄位。 */
  channelMessages?: ChannelMessageLine[];
};

export type WeeklyReportData = {
  weekStart: string;
  weekEnd: string;
  generatedAt: string;
  viewerName: string;
  programs: ProgramSection[];
  departments: PersonSection[];
  /** 「未來 X 天」的 X——顯示區塊標題要用。 */
  upcomingDays: number;
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

export type RiskStatusChange = { line: RiskLine; from: RiskLine["status"]; to: RiskLine["status"] };

export type WeeklyReportDiff = {
  firstEver: boolean;
  completed: ReportItem[];
  newlyOverdue: ReportItem[];
  recovered: ReportItem[];
  statusChanged: StatusChange[];
  scheduleChanged: ScheduleChange[];
  budgetChanged: BudgetChange[];
  /** 這週才被標成里程碑/要徑的項目——上週還不是。 */
  milestoneFlagged: ReportItem[];
  criticalFlagged: ReportItem[];
  /** 上週名單裡沒有這個 id。 */
  riskAdded: RiskLine[];
  riskStatusChanged: RiskStatusChange[];
  /** 狀態沒變,但 updatedAt 比上次存的新——其他欄位動過。 */
  riskUpdated: RiskLine[];
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

/**
 * 現在(星期幾、幾點幾分)有沒有過了設定的觸發時刻——星期幾優先比,同一天
 * 才比時分。0=週日,沿用 JS Date.getDay() 的編號。
 */
export function isPastWeeklyTrigger(
  now: { dow: number; hour: number; minute: number },
  trigger: { dow: number; hour: number; minute: number }
): boolean {
  if (now.dow !== trigger.dow) return now.dow > trigger.dow;
  if (now.hour !== trigger.hour) return now.hour > trigger.hour;
  return now.minute >= trigger.minute;
}

/**
 * 週報涵蓋的日期範圍:從星期幾到星期幾(0=週日 … 6=週六,沿用 JS Date.getDay())。
 * 連續 1~7 天、每 7 天一輪,預設週三到週二——不一定是日曆上的週一到週日。
 */
export type ReportRangeConfig = { startDow: number; endDow: number };

export const DEFAULT_REPORT_RANGE: ReportRangeConfig = { startDow: 3, endDow: 2 };

/** 範圍有幾天:週三到週二 = 7、週一到週五 = 5、起訖同一天 = 1。 */
export function reportRangeDays(config: ReportRangeConfig): number {
  return ((config.endDow - config.startDow + 7) % 7) + 1;
}

/**
 * 這一天所屬的範圍;起訖不滿 7 天時,落在兩個範圍中間空檔的那天回前一個範圍。
 * 回傳的 weekStart / weekEnd 沿用週報原本的欄位名,但現在是「範圍的第一天與最後一天」。
 */
export function reportRangeOf(
  dayIso: string,
  config: ReportRangeConfig
): { weekStart: string; weekEnd: string } {
  const date = utc(dayIso);
  const back = (date.getUTCDay() - config.startDow + 7) % 7;
  const start = new Date(date.getTime() - back * DAY_MS);
  return {
    weekStart: iso(start),
    weekEnd: iso(new Date(start.getTime() + (reportRangeDays(config) - 1) * DAY_MS)),
  };
}

/** 上一輪範圍的第一天:不管範圍從星期幾開始,都是往前 7 天。 */
export function previousReportWeekStart(weekStartIso: string): string {
  return iso(new Date(utc(weekStartIso).getTime() - 7 * DAY_MS));
}

/**
 * 最近一個已經結束的範圍(結束日早於今天)。排程與「產生上一週」要的是這個:跟原本
 * 「週一早上報剛結束的那一週」同一個道理——範圍的最後一天還沒過完,就還不算結束。
 */
export function lastCompletedReportRange(
  todayIso: string,
  config: ReportRangeConfig
): { weekStart: string; weekEnd: string } {
  const current = reportRangeOf(todayIso, config);
  return current.weekEnd < todayIso ? current : reportRangeOf(previousReportWeekStart(current.weekStart), config);
}

/**
 * 週報的週數標籤,例如「2026 W41」:看範圍的最後一天落在哪個 ISO 週。週三到週二的範圍橫跨
 * 兩個日曆週,取最後一天——那是報告寄出時大家正在過的那一週。
 */
export function reportWeekLabel(weekEndIso: string): string {
  return isoWeekLabel(weekRangeOf(weekEndIso).weekStart);
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

function taipeiDate(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 週報裡逐筆列出的風險/議題:還沒結案的全部、已結案的只列這一週才動過的(剛結案的);
 * 分數高的在前,已結案的排最後。
 */
export function risksToList(risks: RiskLine[], weekStart: string, weekEnd: string): RiskLine[] {
  const touchedThisWeek = (r: RiskLine) => {
    const day = taipeiDate(r.updatedAt);
    return day >= weekStart && day <= weekEnd;
  };
  return risks
    .filter((r) => r.status !== "CLOSED" || touchedThisWeek(r))
    .sort(
      (a, b) =>
        Number(a.status === "CLOSED") - Number(b.status === "CLOSED") ||
        riskScore(b.probability, b.impact) - riskScore(a.probability, a.impact) ||
        a.title.localeCompare(b.title, "zh-TW")
    );
}

/** 一筆風險/議題的標題列:類型標記(風險 / 議題 / Mantis #編號)、名稱、狀態、負責人、到期日。 */
export function riskHeadline(r: RiskLine): string {
  const owner = r.ownerName ? `・負責:${r.ownerName}` : "";
  const due = r.dueDate ? `・到期 ${r.dueDate}` : "";
  return `[${riskLinkTag({ kind: r.kind, mantisId: r.mantisId ?? null })}] ${r.title} — ${RISK_STATUS_LABELS[r.status]}(分數 ${riskScore(r.probability, r.impact)})${owner}${due}`;
}

/** 標題列底下的詳細資訊:看板、說明、對策、Mantis 網址、這週的更新(沒有就放最近一次)。 */
export function riskDetailLines(r: RiskLine): string[] {
  const out: string[] = [];
  if (r.boardName) out.push(`看板:${r.boardName}`);
  if (r.description) out.push(`說明:${r.description}`);
  if (r.mitigation) out.push(`對策:${r.mitigation}`);
  if (r.mantisUrl) out.push(`Mantis:<${r.mantisUrl}>`);
  const updates = r.updates ?? [];
  if (updates.length > 0) {
    for (const u of updates) out.push(`💬 更新(${u.authorName} ${u.date.slice(5)}):${u.text}`);
  } else if (r.latestUpdate) {
    out.push(`最近一次更新(${r.latestUpdate.authorName} ${r.latestUpdate.date.slice(5)}):${r.latestUpdate.text}`);
  }
  return out;
}

function renderRiskList(risks: RiskLine[], weekStart: string, weekEnd: string): string[] {
  const list = risksToList(risks, weekStart, weekEnd);
  if (list.length === 0) return [];
  const out: string[] = ["", "**風險與議題明細**"];
  for (const r of list) {
    out.push(`- ${riskHeadline(r)}`);
    out.push(...riskDetailLines(r).map((line) => `  - ${line}`));
  }
  return out;
}

function allRisks(data: { programs: ProgramSection[] }): RiskLine[] {
  return data.programs.flatMap((p) => p.risks ?? []);
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
  /** weekStart / weekEnd 有給,而且工作項有實際完成的時間(completedAt),「這週完成」就以那個時間落在不在這週為準。 */
  current: { programs: ProgramSection[]; weekStart?: string; weekEnd?: string },
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
    milestoneFlagged: [],
    criticalFlagged: [],
    riskAdded: [],
    riskStatusChanged: [],
    riskUpdated: [],
  };
  // 實際完成的時間落在這一週(台灣時間)——有這個時間就不必靠上週的快照去猜,第一份週報也列得出來。
  const range = current.weekStart && current.weekEnd ? { start: current.weekStart, end: current.weekEnd } : null;
  const stampedIn = (item: ReportItem): boolean | null => {
    if (!range || item.bucket !== "done" || !item.completedAt) return null;
    const day = taipeiDateOf(item.completedAt);
    return day >= range.start && day <= range.end;
  };
  if (!previous) return { ...empty, completed: allItems(current).filter((i) => stampedIn(i) === true) };

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
  const milestoneFlagged: ReportItem[] = [];
  const criticalFlagged: ReportItem[] = [];

  for (const item of now) {
    const old = was.get(item.id);
    const stamped = stampedIn(item);
    // 有實際完成的時間:這週切成完成的就算(這週才新增的項目也算);沒有才拿上週的快照比。
    if (stamped === true) completed.push(item);
    if (!old) continue; // 這週才新增的,沒有「變化」可談。

    if (stamped === null && item.bucket === "done" && old.bucket !== "done") completed.push(item);
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

    if (item.isMilestone && !old.isMilestone) milestoneFlagged.push(item);
    if (item.isCritical && !old.isCritical) criticalFlagged.push(item);
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

  const oldRisks = new Map(allRisks(previous).map((r) => [r.id, r]));
  const riskAdded: RiskLine[] = [];
  const riskStatusChanged: RiskStatusChange[] = [];
  const riskUpdated: RiskLine[] = [];
  for (const line of allRisks(current)) {
    const old = oldRisks.get(line.id);
    if (!old) {
      riskAdded.push(line);
      continue;
    }
    if (line.status !== old.status) {
      riskStatusChanged.push({ line, from: old.status, to: line.status });
      continue;
    }
    if (line.updatedAt !== old.updatedAt) riskUpdated.push(line);
  }

  return {
    firstEver: false,
    completed,
    newlyOverdue,
    recovered,
    statusChanged,
    scheduleChanged,
    budgetChanged,
    milestoneFlagged,
    criticalFlagged,
    riskAdded,
    riskStatusChanged,
    riskUpdated,
  };
}

function money(value: number): string {
  return value.toLocaleString("zh-TW");
}

/** CRITICAL 排最前、NORMAL 其次,沒設定的排最後——不會因為漏填而噴錯。 */
const PRIORITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
function priorityRank(p: string | null): number {
  return p ? (PRIORITY_RANK[p.toUpperCase()] ?? 3) : 3;
}
/** 匯出給畫面用——分頁籤裡的清單要跟 Markdown 版用同一套排序規則。 */
export function byPriority(items: ReportItem[]): ReportItem[] {
  return [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}

/** 一個工作項這一週新增的資訊,依發生的先後排。 */
export type ItemUpdateGroup = {
  itemId: string;
  wbsCode: string;
  name: string;
  boardName: string;
  updates: ItemUpdateLine[];
};

const UPDATE_KIND_ORDER: Record<ItemUpdateKind, number> = { STATUS: 0, COMMENT: 1, LINK: 2, ATTACHMENT: 3, TODO: 4 };

/** 照工作項分組,工作項依 WBS 編號排(1.2 在 1.10 前面),組內依日期、再依留言/連結/附件。 */
export function groupItemUpdates(updates: ItemUpdateLine[]): ItemUpdateGroup[] {
  const byItem = new Map<string, ItemUpdateGroup>();
  for (const u of updates) {
    const group = byItem.get(u.itemId) ?? {
      itemId: u.itemId,
      wbsCode: u.wbsCode,
      name: u.name,
      boardName: u.boardName,
      updates: [],
    };
    group.updates.push(u);
    byItem.set(u.itemId, group);
  }
  const groups = [...byItem.values()];
  for (const g of groups) {
    g.updates.sort((a, b) => a.date.localeCompare(b.date) || UPDATE_KIND_ORDER[a.kind] - UPDATE_KIND_ORDER[b.kind]);
  }
  return groups.sort(
    (a, b) =>
      a.boardName.localeCompare(b.boardName, "zh-TW") ||
      a.wbsCode.localeCompare(b.wbsCode, "zh-TW", { numeric: true }) ||
      a.name.localeCompare(b.name, "zh-TW")
  );
}

/** 工作項 id → 它這一週新增的資訊(依日期排),給「這週已完成」的工作項底下附上。 */
export function updatesByItem(updates: ItemUpdateLine[] | undefined): Map<string, ItemUpdateLine[]> {
  return new Map(groupItemUpdates(updates ?? []).map((g) => [g.itemId, g.updates]));
}

/** 有新增資訊的工作項有幾個(同一個工作項新增好幾筆只算一個)。 */
export function countItemsWithUpdates(programs: { itemUpdates?: ItemUpdateLine[] }[]): number {
  return new Set(programs.flatMap((p) => (p.itemUpdates ?? []).map((u) => u.itemId))).size;
}

/** 看板頻道的對話依看板分組(看板依名稱排),每個看板內依發言的先後。 */
export function groupChannelMessages(messages: ChannelMessageLine[]): { boardName: string; messages: ChannelMessageLine[] }[] {
  const byBoard = new Map<string, ChannelMessageLine[]>();
  for (const m of messages) byBoard.set(m.boardName, [...(byBoard.get(m.boardName) ?? []), m]);
  return [...byBoard.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "zh-TW"))
    .map(([boardName, list]) => ({
      boardName,
      messages: [...list].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    }));
}

/** 一則頻道發言的一行:誰、幾月幾日幾點、說了什麼(有附檔案就把檔名接在後面)。 */
export function channelMessageLine(m: ChannelMessageLine): string {
  const files = m.attachments.length > 0 ? ` 📎${m.attachments.join("、")}` : "";
  return `${m.authorName} ${m.date.slice(5)} ${m.time}:${m.text}${files}`;
}

const UPDATE_ICON: Record<ItemUpdateKind, string> = { COMMENT: "💬", LINK: "🔗", ATTACHMENT: "📎", TODO: "☑️", STATUS: "🔄" };

/** 網址用 <…> 包起來:Markdown 與純文字信件都會把它當成可以點的連結。 */
function updateLine(u: ItemUpdateLine): string {
  const who = `${u.authorName} ${u.date.slice(5)}`;
  const detail = u.url ? (u.text && u.text !== u.url ? `${u.text} <${u.url}>` : `<${u.url}>`) : u.text;
  return `  - ${UPDATE_ICON[u.kind]} ${ITEM_UPDATE_LABELS[u.kind]}(${who}):${detail}`;
}

/** 全部列出,不截斷——週報要把內容完整交給看的人,不是「另外還有幾項」。 */
function renderItemUpdates(groups: ItemUpdateGroup[]): string[] {
  const out: string[] = [];
  for (const g of groups) {
    out.push(`- ${g.boardName} · ${g.wbsCode ? `${g.wbsCode} ` : ""}${g.name}`);
    out.push(...g.updates.map(updateLine));
  }
  return out;
}

/**
 * 只留某個專案的那一份:給分專案寄信用。差異與部門、異動筆數都是整份算好的,這裡只切出
 * 屬於這個專案的部分,排版時才不會把別的專案的數字算進這一封。
 */
export function programSubset(
  data: WeeklyReportData,
  diff: WeeklyReportDiff,
  programName: string | null
): { data: WeeklyReportData; diff: WeeklyReportDiff } {
  const program = data.programs.find((p) => p.programName === programName);
  const boardNames = new Set((program?.boards ?? []).map((b) => b.boardName));
  const budgetIds = new Set((program?.budgets ?? []).map((b) => b.itemId));
  const mine = (i: ReportItem) => i.programName === programName;
  return {
    data: {
      ...data,
      programs: program ? [program] : [],
      departments: data.departments.filter((d) => d.programName === programName),
      activity: data.activity.filter((a) => boardNames.has(a.boardName)),
    },
    diff: {
      ...diff,
      completed: diff.completed.filter(mine),
      newlyOverdue: diff.newlyOverdue.filter(mine),
      recovered: diff.recovered.filter(mine),
      statusChanged: diff.statusChanged.filter((c) => mine(c.item)),
      scheduleChanged: diff.scheduleChanged.filter((c) => mine(c.item)),
      budgetChanged: diff.budgetChanged.filter((c) => budgetIds.has(c.line.itemId)),
      milestoneFlagged: diff.milestoneFlagged.filter(mine),
      criticalFlagged: diff.criticalFlagged.filter(mine),
      riskAdded: diff.riskAdded.filter((r) => r.programName === programName),
      riskStatusChanged: diff.riskStatusChanged.filter((c) => c.line.programName === programName),
      riskUpdated: diff.riskUpdated.filter((r) => r.programName === programName),
    },
  };
}

/** 分專案寄的週報信件標題,例如「AMR BOX週報 W41 (2026-10-05 ~ 2026-10-11)」。 */
export function weeklyReportSubject(programName: string | null, weekStart: string, weekEnd: string): string {
  const week = reportWeekLabel(weekEnd).split(" ")[1];
  return `${programName ?? "未歸屬專案群組"}週報 ${week} (${weekStart} ~ ${weekEnd})`;
}

function itemLine(i: ReportItem): string {
  const priorityTag = i.priority === "CRITICAL" ? "🔴CRITICAL" : i.priority === "HIGH" ? "🟣HIGH" : "";
  const tags = [i.isMilestone ? "🚩里程碑" : "", i.isCritical ? "⚡要徑" : "", priorityTag]
    .filter(Boolean)
    .join(" ");
  const owner = i.ownerNames.length > 0 ? `・${i.ownerNames.join("、")}` : "";
  const due = i.end ? `(${i.end})` : "";
  return `- ${i.boardName} / ${i.groupName} · ${i.wbsCode} ${i.name}${due}${owner}${tags ? ` ${tags}` : ""}`;
}

/** 一個工作項底下的資訊更新(縮排的子項目);沒有就是空的。 */
function updateLinesOf(list: ItemUpdateLine[] | undefined): string[] {
  return (list ?? []).map(updateLine);
}

/** 依 Priority 排序後全部列出(不截斷)——CRITICAL/HIGH 的項目排在前面。
 *  updates 有給的話,每個工作項底下接著列它這週的留言、連結、附件。 */
function itemLines(items: ReportItem[], updates?: Map<string, ItemUpdateLine[]>): string[] {
  return byPriority(items).flatMap((i) => [itemLine(i), ...updateLinesOf(updates?.get(i.id))]);
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
export type WeeklyReportSections = {
  /** 標題的名稱,預設「週報」;分專案寄信時用「{專案名稱}週報」。 */
  title?: string;
  summary?: boolean;
  programs?: boolean;
  departments?: boolean;
  activity?: boolean;
};

export function renderWeeklyReportMarkdown(
  data: WeeklyReportData,
  diff: WeeklyReportDiff,
  include: WeeklyReportSections = {}
): string {
  const {
    summary: includeSummary = true,
    programs: includePrograms = true,
    departments: includeDepartments = true,
    activity: includeActivity = true,
    title = "週報",
  } = include;
  const out: string[] = [];
  const label = reportWeekLabel(data.weekEnd);

  out.push(`# ${title} ${label}(${data.weekStart} ~ ${data.weekEnd})`);
  out.push("");
  out.push(`視角:${data.viewerName}・產出時間:${data.generatedAt}`);
  out.push("");

  if (includeSummary) {
    out.push("## 本週摘要");
    out.push("");
    // 預算金額一點都沒列給這位讀者(沒有權限、或分發設定關掉)時,摘要也不報預算異動幾筆——那會讓人以為預算沒動。
    const budgetShown = !data.programs.every((p) => p.budgetHidden && p.budgets.length === 0);
    const infoItems = data.programs.some((p) => p.itemUpdates) ? countItemsWithUpdates(data.programs) : null;
    if (diff.firstEver) {
      out.push("這是第一份週報,沒有上一週可以比,所以下面只有目前的狀態。");
      // 有實際切成完成的時間的項目不必靠上一週去猜,第一份也列得出這週完成了哪些。
      if (diff.completed.length > 0) out.push("", `這週完成 ${diff.completed.length} 項(以實際切成完成的時間為準)。`);
      if (infoItems) out.push("", `這週有 ${infoItems} 個工作項有更新(狀態變化、留言、連結、待辦事項或附件)。`);
    } else {
      out.push(
        `完成 ${diff.completed.length}・新逾期 ${diff.newlyOverdue.length}・` +
          `脫離逾期 ${diff.recovered.length}・改期 ${diff.scheduleChanged.length}・` +
          `狀態更新 ${diff.statusChanged.length}` +
          (budgetShown ? `・預算異動 ${diff.budgetChanged.length}` : "") +
          (infoItems === null ? "" : `・資訊更新 ${infoItems}`)
      );
      const newlyOver = diff.budgetChanged.filter((b) => b.newlyOver);
      if (newlyOver.length > 0) {
        out.push("");
        out.push(`⚠ 這週有 ${newlyOver.length} 個階段從沒超支變成超支。`);
      }
    }
    out.push("");
  }

  for (const program of data.programs) {
    // 「各部門工作事項」跟「專案時程與預算」是兩個獨立的開關:只開前者時,專案段落只留部門那一塊。
    if (!includePrograms && !includeDepartments) continue;
    out.push(`## 專案:${program.programName ?? "(未歸屬專案群組的看板)"}`);
    out.push(
      ...(includePrograms
        ? renderProgram(program, diff, data.upcomingDays, data.departments, includeDepartments, data.weekStart, data.weekEnd)
        : renderProgramDepartments(program, data.departments, data.upcomingDays, updatesByItem(program.itemUpdates)))
    );
    out.push("");
  }

  if (includeActivity && data.activity.length > 0) {
    out.push("## 本週異動筆數");
    out.push("");
    out.push(...data.activity.map((a) => `- ${a.boardName}:${a.count} 筆`));
    out.push("");
  }

  return out.join("\n");
}

const ROLE_LABEL: Record<PersonSection["role"], string> = {
  TEAM_LEADER: "Team Leader",
  DM: "DM",
  MEMBER: "成員",
};

/** 屬於這個專案群組的人,依職能分組——組內保留原本的排序(DM/成員/Team Leader
 *  的排法是 gatherPersonSections 那邊決定的,這裡不重排,只是分組)。 */
function renderDepartments(people: PersonSection[], upcomingDays: number, updates: Map<string, ItemUpdateLine[]>): string[] {
  const out: string[] = [];
  if (people.length === 0) {
    out.push("沒有設定分組角色與部門名冊,所以分不出部門。分組角色設定在「分組角色設定」頁。");
    return out;
  }

  const byDiscipline = new Map<string, PersonSection[]>();
  for (const person of people) {
    byDiscipline.set(person.discipline, [...(byDiscipline.get(person.discipline) ?? []), person]);
  }

  for (const [discipline, group] of byDiscipline) {
    out.push("", `#### ${discipline}`);
    for (const person of group) {
      out.push("", `**[${ROLE_LABEL[person.role]}] ${person.userName}**`);
      out.push(
        ...section(`**逾期(${person.overdue.length})**`, itemLines(person.overdue)),
        ...section(`**這週已完成(${person.completedThisWeek.length})**`, itemLines(person.completedThisWeek, updates)),
        ...section(`**接下來 ${upcomingDays} 天(${person.upcoming.length})**`, itemLines(person.upcoming))
      );
      if (person.overdue.length + person.completedThisWeek.length + person.upcoming.length === 0) {
        out.push("", "目前沒有逾期、這週完成或近期到期的工作項。");
      }
    }
  }
  return out;
}

/** 某個專案群組底下「依職能的工作項」那一段(標題 + 各職能的人)。 */
function renderProgramDepartments(
  program: ProgramSection,
  departments: PersonSection[],
  upcomingDays: number,
  updates: Map<string, ItemUpdateLine[]>
): string[] {
  return [
    "",
    "### 依職能的工作項",
    ...renderDepartments(departments.filter((p) => p.programName === program.programName), upcomingDays, updates),
  ];
}

function renderProgram(
  program: ProgramSection,
  diff: WeeklyReportDiff,
  upcomingDays: number,
  departments: PersonSection[],
  includeDepartments: boolean,
  weekStart: string,
  weekEnd: string
): string[] {
  const out: string[] = [];
  const name = program.programName;
  const items = program.items;
  const updates = updatesByItem(program.itemUpdates);

  const overdue = items.filter((i) => i.bucket === "overdue");
  const upcoming = items.filter((i) => i.bucket === "upcoming");
  const milestones = items.filter((i) => i.isMilestone && i.bucket !== "done");
  const critical = items.filter((i) => i.isCritical && i.bucket !== "done");

  // 第一份週報沒有上一週可比,其他差異都是空的;但有實際完成時間的項目照樣列出這週完成了哪些。
  if (!diff.firstEver || diff.completed.length > 0) {
    const completed = diff.completed.filter((i) => i.programName === name);
    const newlyOverdue = diff.newlyOverdue.filter((i) => i.programName === name);
    const recovered = diff.recovered.filter((i) => i.programName === name);
    const statusChanged = inProgram(diff.statusChanged, name);
    const scheduleChanged = inProgram(diff.scheduleChanged, name);

    const body = [
      ...section(`**完成(${completed.length})**`, itemLines(completed, updates)),
      ...section(`**新逾期(${newlyOverdue.length})**`, itemLines(newlyOverdue)),
      ...section(`**脫離逾期(${recovered.length})**`, itemLines(recovered)),
      ...section(
        `**狀態更新(${statusChanged.length})**`,
        statusChanged.map(
          (c) => `- ${c.item.wbsCode} ${c.item.name}:${c.from ?? "未設定"} → ${c.to ?? "未設定"}`
        )
      ),
      ...section(
        `**時程變化(${scheduleChanged.length})**`,
        scheduleChanged.map((c) => {
          const slip =
            c.slipDays === null ? "" : c.slipDays > 0 ? `,延後 ${c.slipDays} 天` : c.slipDays < 0 ? `,提前 ${-c.slipDays} 天` : "";
          return `- ${c.item.wbsCode} ${c.item.name}:${c.fromStart ?? "—"}~${c.fromEnd ?? "—"} → ${c.toStart ?? "—"}~${c.toEnd ?? "—"}${slip}`;
        })
      ),
    ];
    out.push("", "### 這一週");
    out.push(body.length === 0 ? "\n這個專案這一週沒有變化。" : body.join("\n"));
  }

  if (program.itemUpdates) {
    const groups = groupItemUpdates(program.itemUpdates);
    out.push("", `### 工作項資訊更新(${groups.length})`, "");
    out.push(
      groups.length === 0
        ? "這週沒有工作項有更新(狀態變化、留言、連結、待辦事項或附件)。"
        : renderItemUpdates(groups).join("\n")
    );
  }

  if (program.channelMessages) {
    out.push("", `### 看板頻道對話(${program.channelMessages.length} 則)`, "");
    if (program.channelMessages.length === 0) {
      out.push("這週看板頻道沒有對話。");
    } else {
      for (const g of groupChannelMessages(program.channelMessages)) {
        out.push(`- ${g.boardName}(${g.messages.length} 則)`);
        out.push(...g.messages.map((m) => `  - 💬 ${channelMessageLine(m)}`));
      }
    }
  }

  if (includeDepartments) out.push(...renderProgramDepartments(program, departments, upcomingDays, updates));

  out.push("", `### 目前逾期(${overdue.length})`, "");
  out.push(overdue.length === 0 ? "沒有逾期。" : itemLines(overdue).join("\n"));

  out.push("", `### 未來 ${upcomingDays} 天(${upcoming.length})`, "");
  out.push(upcoming.length === 0 ? `${upcomingDays} 天內沒有到期的。` : itemLines(upcoming).join("\n"));

  out.push("", `### 里程碑(${milestones.length})`, "");
  out.push(milestones.length === 0 ? "沒有未完成的里程碑。" : itemLines(milestones).join("\n"));

  if (!diff.firstEver) {
    const flagged = diff.milestoneFlagged.filter((i) => i.programName === name);
    const changed = inProgram(diff.statusChanged, name).filter((c) => c.item.isMilestone);
    const rescheduled = inProgram(diff.scheduleChanged, name).filter((c) => c.item.isMilestone);
    out.push(
      ...section(`**這週新增標記(${flagged.length})**`, itemLines(flagged)),
      ...section(
        `**這週狀態改變(${changed.length})**`,
        changed.map((c) => `- ${c.item.wbsCode} ${c.item.name}:${c.from ?? "未設定"} → ${c.to ?? "未設定"}`)
      ),
      ...section(
        `**這週時程改變(${rescheduled.length})**`,
        rescheduled.map((c) => `- ${c.item.wbsCode} ${c.item.name}:${c.fromStart ?? "—"}~${c.fromEnd ?? "—"} → ${c.toStart ?? "—"}~${c.toEnd ?? "—"}`)
      )
    );
    if (flagged.length + changed.length + rescheduled.length === 0) out.push("", "這週里程碑沒有變化。");
  }

  out.push("", `### 要徑(${critical.length})`, "");
  out.push(
    critical.length === 0
      ? "沒有要徑工作項,或這個專案還沒設好前置依賴。"
      : itemLines(critical).join("\n")
  );

  if (!diff.firstEver) {
    const flagged = diff.criticalFlagged.filter((i) => i.programName === name);
    const changed = inProgram(diff.statusChanged, name).filter((c) => c.item.isCritical);
    const rescheduled = inProgram(diff.scheduleChanged, name).filter((c) => c.item.isCritical);
    out.push(
      ...section(`**這週新增標記(${flagged.length})**`, itemLines(flagged)),
      ...section(
        `**這週狀態改變(${changed.length})**`,
        changed.map((c) => `- ${c.item.wbsCode} ${c.item.name}:${c.from ?? "未設定"} → ${c.to ?? "未設定"}`)
      ),
      ...section(
        `**這週時程改變(${rescheduled.length})**`,
        rescheduled.map((c) => `- ${c.item.wbsCode} ${c.item.name}:${c.fromStart ?? "—"}~${c.fromEnd ?? "—"} → ${c.toStart ?? "—"}~${c.toEnd ?? "—"}`)
      )
    );
    if (flagged.length + changed.length + rescheduled.length === 0) out.push("", "這週要徑沒有變化。");
  }

  out.push("", `### 風險與議題`, "");
  const risks = program.risks ?? [];
  if (risks.length === 0) {
    out.push("沒有登記風險或議題。");
  } else {
    const open = risks.filter((r) => r.status !== "CLOSED");
    out.push(
      `${RISK_KIND_LABELS.RISK} ${risks.filter((r) => r.kind === "RISK").length} 項、` +
        `${RISK_KIND_LABELS.ISSUE} ${risks.filter((r) => r.kind === "ISSUE").length} 項,` +
        `尚未結案 ${open.length} 項。`
    );
    out.push(...renderRiskList(risks, weekStart, weekEnd));
  }
  if (!diff.firstEver) {
    const added = diff.riskAdded.filter((r) => r.programName === name);
    const statusChanged = diff.riskStatusChanged.filter((r) => r.line.programName === name);
    const updated = diff.riskUpdated.filter((r) => r.programName === name);
    out.push(
      ...section(
        `**這週新增(${added.length})**`,
        added.map((r) => `- [${RISK_KIND_LABELS[r.kind]}] ${r.title}(${RISK_STATUS_LABELS[r.status]})`)
      ),
      ...section(
        `**這週狀態改變(${statusChanged.length})**`,
        statusChanged.map(
          (c) => `- [${RISK_KIND_LABELS[c.line.kind]}] ${c.line.title}:${RISK_STATUS_LABELS[c.from]} → ${RISK_STATUS_LABELS[c.to]}`
        )
      ),
      ...section(
        `**這週更新(${updated.length})**`,
        updated.map((r) => `- [${RISK_KIND_LABELS[r.kind]}] ${r.title}`)
      )
    );
    if (added.length + statusChanged.length + updated.length === 0) out.push("", "這週風險/議題登記沒有變化。");
  }

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
    out.push(program.budgetHidden ? "預算金額僅限有權限的人檢視。" : "沒有編列預算的階段。");
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
    if (program.budgetHidden) out.push("", "部分看板的預算金額你沒有檢視權限,未列入。");
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

/** 排程對一個專案群組的處理結果。detail:失敗原因、或沒有寄的原因(沒有收件人、沒有看板)。 */
export type ProgramRunResult = { programName: string; sent: number; failed: number; detail?: string };

/**
 * 排程這一輪的結果,一句話,給系統設定頁看。排程在背景跑,寄成功還是失敗只有這一句留得下來:
 * 「2026 W44:【PS30】寄出 2 封;【M28E】略過(沒有收件人)」
 */
export function summarizeWeeklyRun(week: string, results: ProgramRunResult[]): string {
  if (results.length === 0) return `${week}:沒有任何專案群組設定週報收件人,沒有寄信`;
  const parts = results.map((r) => {
    if (r.sent === 0 && r.failed === 0) return `【${r.programName}】略過(${r.detail ?? "沒有可寄的內容"})`;
    const failed = r.failed > 0 ? `、失敗 ${r.failed} 封${r.detail ? `(${r.detail})` : ""}` : "";
    return `【${r.programName}】寄出 ${r.sent} 封${failed}`;
  });
  return `${week}:${parts.join(";")}`;
}

/** 排程這一輪(「立即執行一次」也是)叫什麼、報哪一個範圍:報的是剛結束的那個範圍,「這週跑過了沒」照日曆週算。 */
export function weeklyRunPlan(todayIso: string, range: ReportRangeConfig): { weekKey: string; target: string } {
  return {
    weekKey: isoWeekLabel(weekRangeOf(todayIso).weekStart),
    target: lastCompletedReportRange(todayIso, range).weekStart,
  };
}

/** 觸發時刻已經過了幾分鐘(只在「已經過了」的前提下算,星期幾的順序同 isPastWeeklyTrigger)。 */
export function minutesPastWeeklyTrigger(
  now: { dow: number; hour: number; minute: number },
  trigger: { dow: number; hour: number; minute: number }
): number {
  return (now.dow - trigger.dow) * 1440 + (now.hour * 60 + now.minute) - (trigger.hour * 60 + trigger.minute);
}

/** 這一輪全部寄失敗之後,隔多久才重試、以及觸發後多久內還肯重試——不要每 5 分鐘就去敲壞掉的 SMTP。 */
export const WEEKLY_RETRY_GAP_MINUTES = 30;
export const WEEKLY_RETRY_WINDOW_MINUTES = 180;

/** 一封都沒寄出去(寄信失敗或產生報告出錯),而且還在重試的時間內:這一輪不算跑過,下次再試。 */
export function shouldRetryWeeklyRun(results: ProgramRunResult[], minutesPast: number): boolean {
  const sent = results.reduce((sum, r) => sum + r.sent, 0);
  const failed = results.reduce((sum, r) => sum + r.failed, 0);
  return sent === 0 && failed > 0 && minutesPast < WEEKLY_RETRY_WINDOW_MINUTES;
}
