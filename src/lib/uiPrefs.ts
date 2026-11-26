/**
 * 每個使用者自己的畫面設定,存在帳號上(User.uiPrefs),換瀏覽器、換電腦都跟著人走:
 *  - theme:顯示背景(淺色 / 深色);
 *  - boards[看板 id]:這個人上次在這塊看板停在哪個分頁、表格捲到哪裡、甘特圖的時間刻度 / 顯示比例 /
 *    名稱欄寬 / 收合的列 / 捲到哪裡。
 *
 * 這份資料來自瀏覽器,所以讀進來一律先 parse 過(不信任形狀),存回去之前也 merge 並限制大小,
 * 不讓壞資料或無限成長的清單塞進帳號裡。純函式。
 */

export type ThemePref = "light" | "dark";
export type GanttZoomPref = "day" | "week" | "month";

export type BoardMemory = {
  /** 看板的分頁:table / kanban / gantt / report / risks / issues / gates / changes / budget。 */
  view?: string;
  /** 表格縱向捲到哪裡(px)。 */
  tableTop?: number;
  gantt?: {
    zoom?: GanttZoomPref;
    scalePct?: number;
    labelWidth?: number;
    /** 收合起來的列(工作項 id)。 */
    collapsed?: string[];
    /** 甘特圖最左邊那一天(YYYY-MM-DD)與縱向捲到哪裡(px)。用日期而不是像素,時間軸範圍變了也停在同一天。 */
    leftDay?: string;
    top?: number;
  };
  /** 最後更新時間(ms),超過上限時淘汰最久沒用的看板。 */
  at?: number;
};

export type UiPrefs = {
  theme?: ThemePref;
  boards?: Record<string, BoardMemory>;
};

export const MAX_BOARDS = 40;
export const MAX_COLLAPSED = 2000;
const VIEWS = new Set(["table", "kanban", "gantt", "report", "risks", "issues", "gates", "changes", "budget"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function num(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : undefined;
}

function cleanGantt(raw: unknown): BoardMemory["gantt"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;
  const out: NonNullable<BoardMemory["gantt"]> = {};
  if (g.zoom === "day" || g.zoom === "week" || g.zoom === "month") out.zoom = g.zoom;
  const scalePct = num(g.scalePct, 50, 150);
  if (scalePct !== undefined) out.scalePct = scalePct;
  const labelWidth = num(g.labelWidth, 140, 1600);
  if (labelWidth !== undefined) out.labelWidth = labelWidth;
  if (Array.isArray(g.collapsed)) {
    out.collapsed = g.collapsed.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 64).slice(0, MAX_COLLAPSED);
  }
  if (typeof g.leftDay === "string" && ISO_DAY.test(g.leftDay)) out.leftDay = g.leftDay;
  const top = num(g.top, 0, 10_000_000);
  if (top !== undefined) out.top = top;
  return Object.keys(out).length > 0 ? out : undefined;
}

function cleanBoard(raw: unknown): BoardMemory | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const out: BoardMemory = {};
  if (typeof b.view === "string" && VIEWS.has(b.view)) out.view = b.view;
  const tableTop = num(b.tableTop, 0, 10_000_000);
  if (tableTop !== undefined) out.tableTop = tableTop;
  const gantt = cleanGantt(b.gantt);
  if (gantt) out.gantt = gantt;
  const at = num(b.at, 0, Number.MAX_SAFE_INTEGER);
  if (at !== undefined) out.at = at;
  return Object.keys(out).length > 0 ? out : null;
}

/** 讀進來的值(資料庫、或瀏覽器送來的)整理成合法的 UiPrefs;不認得的欄位丟掉。 */
export function parseUiPrefs(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: UiPrefs = {};
  if (r.theme === "light" || r.theme === "dark") out.theme = r.theme;
  if (r.boards && typeof r.boards === "object") {
    const boards: Record<string, BoardMemory> = {};
    for (const [id, value] of Object.entries(r.boards as Record<string, unknown>)) {
      if (id.length === 0 || id.length > 64) continue;
      const clean = cleanBoard(value);
      if (clean) boards[id] = clean;
    }
    if (Object.keys(boards).length > 0) out.boards = boards;
  }
  return out;
}

/**
 * 把一次更動併進原本的設定:theme 直接換;看板的記憶只換有給的欄位(甘特圖的設定也是逐欄位合併,
 * 例如只更新捲動位置不會洗掉收合的列)。最多留 MAX_BOARDS 塊看板,淘汰最久沒更新的。
 */
export function mergeUiPrefs(current: unknown, patch: unknown, now: number = Date.now()): UiPrefs {
  const base = parseUiPrefs(current);
  const change = parseUiPrefs(patch);
  const merged: UiPrefs = { ...base };
  if (change.theme) merged.theme = change.theme;
  if (change.boards) {
    const boards = { ...(base.boards ?? {}) };
    for (const [id, memory] of Object.entries(change.boards)) {
      const old = boards[id] ?? {};
      const next: BoardMemory = { ...old, ...memory, at: now };
      if (memory.gantt) next.gantt = { ...(old.gantt ?? {}), ...memory.gantt };
      boards[id] = next;
    }
    const keep = Object.entries(boards)
      .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
      .slice(0, MAX_BOARDS);
    merged.boards = Object.fromEntries(keep);
  }
  return merged;
}
