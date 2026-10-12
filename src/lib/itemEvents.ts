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

/** 台灣時間(UTC+8)的日期 "YYYY-MM-DD"。 */
export function taipeiDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 顯示用:「10/12 09:12」(台灣時間)。 */
export function formatEventTime(iso: string): string {
  const t = new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString();
  return `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`;
}

/** 項目視窗的分頁(跟 ItemDetailModal 的 TABS 同一組 id)。 */
export type ItemDetailTab = "updates" | "files" | "links" | "activity" | "card" | "checklist" | "cost";

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
