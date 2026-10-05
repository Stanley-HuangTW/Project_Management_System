/**
 * 看板「上一步 / 下一步」的堆疊邏輯——只管堆疊怎麼進出,不碰 React、不碰 server。
 * 每一筆紀錄自己知道怎麼還原/重做(通常是用同一個 server action 把舊值/新值寫回去),
 * 並且在動手前自己檢查「目前的值是不是當初改完的值」——有人改過就回 ok:false。
 */

export type UndoResult = { ok: true } | { ok: false; reason: string };

export type HistoryEntry = {
  id: string;
  /** 顯示在按鈕提示上,例如「修改「狀態」」。 */
  label: string;
  undo: () => Promise<UndoResult>;
  redo: () => Promise<UndoResult>;
};

export type HistoryState = {
  /** 已經做過的修改,最後一筆是最近一次——「上一步」還原它。 */
  past: HistoryEntry[];
  /** 剛被還原的修改,最後一筆是最近被還原的——「下一步」重做它。 */
  future: HistoryEntry[];
};

/** 記憶體裡只留這麼多步;再多的人也不會一路按回去,舊的丟掉比無限成長合理。 */
export const MAX_HISTORY = 50;

export const EMPTY_HISTORY: HistoryState = { past: [], future: [] };

/** 新的修改進來。接在分支上做了新修改,原本「下一步」的那條路就不存在了。 */
export function pushEntry(state: HistoryState, entry: HistoryEntry): HistoryState {
  const past = [...state.past, entry];
  return { past: past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past, future: [] };
}

/** 最近一筆還原成功之後的堆疊:從 past 搬到 future。沒有可還原的就原樣回傳。 */
export function undoneState(state: HistoryState): HistoryState {
  const entry = state.past[state.past.length - 1];
  if (!entry) return state;
  return { past: state.past.slice(0, -1), future: [...state.future, entry] };
}

/** 最近一筆重做成功之後的堆疊:從 future 搬回 past。 */
export function redoneState(state: HistoryState): HistoryState {
  const entry = state.future[state.future.length - 1];
  if (!entry) return state;
  return { past: [...state.past, entry], future: state.future.slice(0, -1) };
}

/** 比對「目前的值」跟「當初改完的值」是不是同一個——儲存格的值是 JSON(字串、數字、
 *  null、陣列),不能用 ===。undefined 當成 null:資料庫裡沒有那一格跟存 null 是同一件事。 */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
