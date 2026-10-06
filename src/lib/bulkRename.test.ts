import { describe, expect, it } from "vitest";
import { planNameReplace } from "./bulkRename";

const item = (id: string, name: string) => ({ id, name });

describe("planNameReplace", () => {
  it("取代名稱裡所有出現的地方", () => {
    const plan = planNameReplace([item("a", "PoC-1 spec / PoC-1 review")], "PoC", "POC");
    expect(plan.changes).toEqual([{ id: "a", from: "PoC-1 spec / PoC-1 review", to: "POC-1 spec / POC-1 review" }]);
  });

  it("沒有出現字樣的項目列為沒變", () => {
    const plan = planNameReplace([item("a", "EVT"), item("b", "PoC-2")], "PoC", "POC");
    expect(plan.unchangedIds).toEqual(["a"]);
    expect(plan.changes.map((c) => c.id)).toEqual(["b"]);
  });

  it("區分大小寫", () => {
    const plan = planNameReplace([item("a", "poc-1")], "PoC", "POC");
    expect(plan.changes).toEqual([]);
    expect(plan.unchangedIds).toEqual(["a"]);
  });

  it("特殊字元照字面比對,取代文字裡的 $ 也不會被當成樣式", () => {
    const plan = planNameReplace([item("a", "費用(NRE/BOM).v1")], "(NRE/BOM).", "$&-");
    expect(plan.changes).toEqual([{ id: "a", from: "費用(NRE/BOM).v1", to: "費用$&-v1" }]);
  });

  it("取代成空字串等於刪掉那段字,結果會 trim", () => {
    const plan = planNameReplace([item("a", "POC-3 費用 (draft)")], "(draft)", "");
    expect(plan.changes).toEqual([{ id: "a", from: "POC-3 費用 (draft)", to: "POC-3 費用" }]);
  });

  it("取代後整個名稱變空白的不改", () => {
    const plan = planNameReplace([item("a", "draft"), item("b", "draft v2")], "draft", "");
    expect(plan.blankIds).toEqual(["a"]);
    expect(plan.changes).toEqual([{ id: "b", from: "draft v2", to: "v2" }]);
  });

  it("要找的字樣是空的時候什麼都不改", () => {
    const plan = planNameReplace([item("a", "PoC-1")], "", "x");
    expect(plan.changes).toEqual([]);
    expect(plan.unchangedIds).toEqual(["a"]);
  });

  it("找的跟換的一樣就是沒變", () => {
    const plan = planNameReplace([item("a", "PoC-1")], "PoC", "PoC");
    expect(plan.changes).toEqual([]);
    expect(plan.unchangedIds).toEqual(["a"]);
  });
});
