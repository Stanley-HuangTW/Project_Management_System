import { describe, expect, it } from "vitest";
import {
  EMPTY_HISTORY,
  MAX_HISTORY,
  pushEntry,
  redoneState,
  sameJson,
  undoneState,
  type HistoryEntry,
} from "./editHistory";

function entry(id: string): HistoryEntry {
  return { id, label: id, undo: async () => ({ ok: true }), redo: async () => ({ ok: true }) };
}

const ids = (list: HistoryEntry[]) => list.map((e) => e.id);

describe("pushEntry", () => {
  it("新修改接在 past 最後面", () => {
    const state = pushEntry(pushEntry(EMPTY_HISTORY, entry("a")), entry("b"));
    expect(ids(state.past)).toEqual(["a", "b"]);
  });

  it("新修改會清掉 future——接在分支上做了新的事,原本的下一步就不存在了", () => {
    let state = pushEntry(pushEntry(EMPTY_HISTORY, entry("a")), entry("b"));
    state = undoneState(state);
    expect(ids(state.future)).toEqual(["b"]);
    state = pushEntry(state, entry("c"));
    expect(ids(state.past)).toEqual(["a", "c"]);
    expect(state.future).toEqual([]);
  });

  it("超過上限就丟掉最舊的", () => {
    let state = EMPTY_HISTORY;
    for (let i = 0; i < MAX_HISTORY + 5; i++) state = pushEntry(state, entry(`e${i}`));
    expect(state.past).toHaveLength(MAX_HISTORY);
    expect(state.past[0].id).toBe("e5");
    expect(state.past[MAX_HISTORY - 1].id).toBe(`e${MAX_HISTORY + 4}`);
  });
});

describe("undoneState / redoneState", () => {
  it("上一步把最近一筆從 past 搬到 future,下一步再搬回來", () => {
    let state = pushEntry(pushEntry(pushEntry(EMPTY_HISTORY, entry("a")), entry("b")), entry("c"));
    state = undoneState(state);
    state = undoneState(state);
    expect(ids(state.past)).toEqual(["a"]);
    // 最近被還原的排在最後面,下一步先重做的是 b(先被還原的 c 要等 b 之後)。
    expect(ids(state.future)).toEqual(["c", "b"]);
    state = redoneState(state);
    expect(ids(state.past)).toEqual(["a", "b"]);
    expect(ids(state.future)).toEqual(["c"]);
  });

  it("空堆疊上按上一步/下一步不會動,也不會壞掉", () => {
    expect(undoneState(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
    expect(redoneState(EMPTY_HISTORY)).toBe(EMPTY_HISTORY);
  });

  it("不是原地修改,舊的 state 物件不會被動到", () => {
    const before = pushEntry(EMPTY_HISTORY, entry("a"));
    undoneState(before);
    expect(ids(before.past)).toEqual(["a"]);
    expect(before.future).toEqual([]);
  });
});

describe("sameJson", () => {
  it("字串、數字、null 與陣列都能比", () => {
    expect(sameJson("done", "done")).toBe(true);
    expect(sameJson(3, 3)).toBe(true);
    expect(sameJson(3, "3")).toBe(false);
    expect(sameJson(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameJson(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("undefined 跟 null 視為同一件事(沒有那一格 = 空值)", () => {
    expect(sameJson(undefined, null)).toBe(true);
    expect(sameJson(undefined, "x")).toBe(false);
  });
});
