/**
 * 工作項上發生的事:狀態切換、更新(留言)、連結、待辦事項、其他欄位。
 *
 * 寫在活動紀錄(ActivityLogEntry)上的結構化欄位——「更新記錄」欄、儀表板的本週完成、週報都讀它,
 * 不必去解析那句中文。純邏輯,不碰資料庫。
 */

export type ItemEventKind = "STATUS" | "UPDATE" | "LINK" | "TODO" | "FIELD";

export const ITEM_EVENT_LABELS: Record<ItemEventKind, string> = {
  STATUS: "狀態",
  UPDATE: "更新",
  LINK: "連結",
  TODO: "待辦事項",
  FIELD: "欄位修改",
};

/** 狀態選項算哪一種:切到「進行中」或「完成」的時間要單獨記下來。 */
export type StatusKind = "inProgress" | "done" | "other";

/**
 * 一個狀態選項是進行中、完成,還是其他。
 *
 * 不是每個看板的狀態選項 id 都認得(從別的系統匯入的看板,選項是隨機 id,只有標籤穩定),所以標籤也要看:
 * 完成 = 報表設定裡指定的完成選項、預設的 done、或標籤叫 Completed / Done / 完成 / 已完成 / 已結案;
 * 進行中 = 預設的 in_progress、或標籤含 In Progress / 進行中 / 實作中 / 處理中 / doing / working。
 */
export function classifyStatusOption(
  option: { id: string; label: string },
  doneOptionIds: string[] = []
): StatusKind {
  const label = option.label.trim();
  if (doneOptionIds.includes(option.id) || option.id === "done" || /^(completed?|done|完成|已完成|已結案)$/i.test(label)) {
    return "done";
  }
  if (option.id === "in_progress" || /(in[ _-]?progress|進行中|實作中|處理中|doing|working)/i.test(label)) {
    return "inProgress";
  }
  return "other";
}

/** 看板上哪一欄是「狀態」:名叫 Status 的狀態型欄位優先,沒有就第一個狀態型欄位(跟 resolveStatusColumn 同一個規則)。 */
export function pickStatusColumnId(columns: { id: string; name: string; type: string }[]): string | null {
  const statuses = columns.filter((c) => c.type === "STATUS");
  return (statuses.find((c) => c.name === "Status") ?? statuses[0])?.id ?? null;
}

/** 一筆事件,給「更新記錄」欄與週報用。 */
export type ItemEventLine = {
  kind: ItemEventKind;
  /** ISO 字串 */
  at: string;
  actorName: string | null;
  /** 活動紀錄那一句(例如「「Status」已更新:Planned → Completed」)。 */
  summary: string;
};

/** 一個工作項的事件摘要。 */
export type ItemEventSummary = {
  /** 最近一次切成進行中的時間(ISO)。 */
  startedAt: string | null;
  /** 最近一次切成完成的時間(ISO)。是否「現在還是完成」要配合目前的狀態判斷,見 completedAtOf。 */
  completedAt: string | null;
  /** 最近一筆更新或變化。 */
  last: ItemEventLine | null;
};

/**
 * 這個工作項實際完成的時間:現在是完成狀態、而且有切成完成的紀錄才有。
 * 切回別的狀態之後就不算完成,完成時間清掉;沒有紀錄(舊資料、或不是靠狀態欄完成的)是 null——
 * 由呼叫端決定要不要退回用計畫完成日。
 */
export function completedAtOf(summary: ItemEventSummary | undefined, isCompleteNow: boolean): string | null {
  return isCompleteNow ? (summary?.completedAt ?? null) : null;
}

/** 標籤的顏色:跟通知列表同一組(修改藍、指派紫、留言黃);連結與待辦事項沒有對應的通知,用中性色。 */
export type EventTone = "UPDATED" | "ASSIGNED" | "COMMENTED" | "CREATED" | "NEUTRAL";

/**
 * 「更新記錄」那一格顯示什麼——跟通知列表同一套:一個類型標籤(修改 / 指派 / 留言,連結與待辦事項另標)、
 * 改了什麼(通知的寫法,例如「「Status」:Planned → Completed」)。誰做的、什麼時候另外顯示。
 * 管理者代操作時活動紀錄尾端的註記只留在滑鼠停上去的完整說明裡,格子裡不佔位置。
 */
export function describeEvent(line: ItemEventLine): { label: string; tone: EventTone; message: string } {
  const text = line.summary.replace(/〔管理者以「[^」]*」的身分操作〕$/, "").trim();
  switch (line.kind) {
    case "UPDATE":
      return { label: "留言", tone: "COMMENTED", message: text.replace(/^新增留言:?/, "").trim() || "新增留言" };
    case "LINK":
      return { label: "連結", tone: "NEUTRAL", message: text };
    case "TODO":
      return { label: "待辦事項", tone: "NEUTRAL", message: text };
    default:
      // 指派(負責人、人員分配)通知叫「指派」;其餘欄位修改叫「修改」,訊息把「已更新:」改成通知的「:」。
      if (/指派給|人員分配/.test(text)) return { label: "指派", tone: "ASSIGNED", message: text };
      return { label: "修改", tone: "UPDATED", message: text.replace(/^(「[^」]*」)已更新:/, "$1:") };
  }
}

/**
 * 風險 / 議題(含 Mantis 同步來的)的事件,在「更新記錄」顯示的類型與說法:建立 → 新增;指派、換負責人、換審核人 → 指派;
 * 其他(改欄位、申請結案、審核、狀態)→ 修改。跟通知同一組標籤與顏色。
 */
export function describeRiskEvent(summary: string): { label: string; tone: EventTone; message: string } {
  const text = summary.replace(/〔管理者以「[^」]*」的身分操作〕$/, "").trim();
  if (/^(建立|從 Mantis 同步建立)/.test(text)) return { label: "新增", tone: "CREATED", message: text };
  if (/指派給|取消指派|負責人|審核人/.test(text)) return { label: "指派", tone: "ASSIGNED", message: text };
  return { label: "修改", tone: "UPDATED", message: text };
}

/** 一次狀態切換:什麼時候、誰切的。 */
export type StatusSwitch = { at: string; by: string | null };

/**
 * 項目卡片 Status 那一列下面要顯示的兩個時間。規則跟表格的「進行中時間 / 完成時間」一樣:
 * - 進行中:最近一次切成進行中。
 * - 完成:現在是完成狀態才有(最近一次切成完成);切回別的狀態就清掉,但 wasCompleted 留著最近一次完成的時間,
 *   讓畫面能說「曾於某時完成,之後改回其他狀態」。
 * rows 照時間新到舊排。
 */
export function pickStatusTimes(
  rows: { statusKind: string | null; at: string; by: string | null }[],
  doneNow: boolean
): { started: StatusSwitch | null; completed: StatusSwitch | null; wasCompleted: StatusSwitch | null } {
  const latest = (kind: string): StatusSwitch | null => {
    const row = rows.find((r) => r.statusKind === kind);
    return row ? { at: row.at, by: row.by } : null;
  };
  const done = latest("done");
  return { started: latest("inProgress"), completed: doneNow ? done : null, wasCompleted: doneNow ? null : done };
}

/** 台灣時間(UTC+8)的日期 "YYYY-MM-DD"。 */
export function taipeiDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 顯示用:「10/12 09:12」(台灣時間)。 */
export function formatEventTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString();
  return `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`;
}

/** 顯示用:「2026/10/12 09:12」(台灣時間,含年份)——任務是什麼時候派遣的,可能是很久以前。 */
export function formatEventDateTime(value: Date | string): string {
  const t = new Date(new Date(value).getTime() + 8 * 3_600_000).toISOString();
  return `${t.slice(0, 4)}/${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`;
}

/** 項目視窗的分頁(跟 ItemDetailModal 的 TABS 同一組 id)。 */
export type ItemDetailTab = "updates" | "files" | "links" | "activity" | "card" | "checklist" | "cost";

/**
 * 「更新記錄」點下去,項目卡片要標出哪一個欄位:狀態與其他欄位的修改,訊息開頭是「欄位名稱」
 * (例如「「duration」:28 → 29」);留言、連結、待辦事項沒有對應的欄位,回 null。
 */
export function eventTargetField(kind: ItemEventKind, summary: string): string | null {
  if (kind !== "FIELD" && kind !== "STATUS") return null;
  return /^「([^」]+)」/.exec(summary.trim())?.[1] ?? null;
}

/** 「更新記錄」點下去要跳哪一頁:更新跳「更新」、連結跳「連結」、待辦事項跳「待辦事項」,狀態與其他欄位跳「項目卡片」。 */
export function eventTargetTab(kind: ItemEventKind): ItemDetailTab {
  switch (kind) {
    case "UPDATE":
      return "updates";
    case "LINK":
      return "links";
    case "TODO":
      return "checklist";
    default:
      return "card";
  }
}
