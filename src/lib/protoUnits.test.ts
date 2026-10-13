import { describe, expect, it } from "vitest";
import { planProtoUnitSync, protoSyncNotice, protoUnitLabel, type ExistingProtoUnit } from "./protoUnits";

const cell = (product: string, unit: string, phaseId: string, qty: number) => ({ product, unit, phaseId, qty });
const unit = (id: string, product: string, unit: string, phaseId: string, seq: number): ExistingProtoUnit => ({ id, product, unit, phaseId, seq });

describe("protoUnitLabel", () => {
  it("產品 / 階段 / 用途 #第幾台", () => {
    expect(protoUnitLabel({ product: "M3", unit: "SW", seq: 2 }, "EVT1")).toBe("M3 / EVT1 / SW #2");
  });
});

describe("planProtoUnitSync", () => {
  it("樣機計畫一格 N 台:一台都還沒有就補第 1 ~ N 台", () => {
    const plan = planProtoUnitSync([cell("M3", "SW", "p1", 3)], []);
    expect(plan.create.map((c) => c.seq)).toEqual([1, 2, 3]);
    expect(plan.remove).toEqual([]);
  });

  it("台數增加:只補新增的號碼,原本的不動", () => {
    const existing = [unit("a", "M3", "SW", "p1", 1), unit("b", "M3", "SW", "p1", 2)];
    const plan = planProtoUnitSync([cell("M3", "SW", "p1", 4)], existing);
    expect(plan.create.map((c) => c.seq)).toEqual([3, 4]);
    expect(plan.remove).toEqual([]);
  });

  it("台數減少:從最大的號碼開始拿掉,小號碼保留", () => {
    const existing = [1, 2, 3, 4, 5].map((n) => unit(`u${n}`, "M3", "SW", "p1", n));
    const plan = planProtoUnitSync([cell("M3", "SW", "p1", 2)], existing);
    expect(plan.create).toEqual([]);
    expect(plan.remove.map((u) => u.seq)).toEqual([3, 4, 5]);
  });

  it("台數沒變:什麼都不做", () => {
    const existing = [unit("a", "M3", "SW", "p1", 1), unit("b", "M3", "SW", "p1", 2)];
    expect(planProtoUnitSync([cell("M3", "SW", "p1", 2)], existing)).toEqual({ create: [], remove: [] });
  });

  it("改成 0 台或那一列被刪(計畫上已經沒有):底下的樣機全部拿掉", () => {
    const existing = [unit("a", "M3", "SW", "p1", 1), unit("b", "M3", "SW", "p1", 2), unit("c", "M3", "EE", "p1", 1)];
    // SW 那一格改成 0 台:SW 的兩台拿掉;EE 那一列計畫上已經沒有:它的一台也拿掉(排序:先 EE 再 SW,同一格小號在前)
    expect(planProtoUnitSync([cell("M3", "SW", "p1", 0)], existing).remove.map((u) => u.id)).toEqual(["c", "a", "b"]);
    expect(planProtoUnitSync([], existing).remove).toHaveLength(3);
  });

  it("不同產品、用途、階段各算各的,互不影響", () => {
    const existing = [unit("a", "M3", "SW", "p1", 1), unit("b", "M3", "SW", "p2", 1), unit("c", "充電站", "SW", "p1", 1)];
    const plan = planProtoUnitSync([cell("M3", "SW", "p1", 1), cell("M3", "SW", "p2", 2), cell("充電站", "SW", "p1", 0)], existing);
    expect(plan.create).toEqual([{ product: "M3", unit: "SW", phaseId: "p2", seq: 2 }]);
    expect(plan.remove.map((u) => u.id)).toEqual(["c"]);
  });

  it("沒有小數、負數的台數問題:負的當 0", () => {
    const existing = [unit("a", "M3", "SW", "p1", 1)];
    expect(planProtoUnitSync([cell("M3", "SW", "p1", -2)], existing).remove.map((u) => u.id)).toEqual(["a"]);
  });
});

describe("protoSyncNotice", () => {
  it("沒有樣機被拿掉:不用通知", () => {
    expect(protoSyncNotice({ added: 3, removed: [], cleared: [] })).toBeNull();
  });

  it("拿掉了樣機、沒有工作項在用:只說拿掉幾台", () => {
    const text = protoSyncNotice({ added: 0, removed: [{ label: "M3 / EVT1 / SW #3" }, { label: "M3 / EVT1 / SW #4" }], cleared: [] })!;
    expect(text).toContain("已拿掉 2 台樣機");
    expect(text).toContain("M3 / EVT1 / SW #3、M3 / EVT1 / SW #4");
    expect(text).not.toContain("使用樣機");
  });

  it("有工作項原本在用:列出哪個工作項、解除了哪幾台,並提醒重選(不擋、只通知)", () => {
    const text = protoSyncNotice({
      added: 0,
      removed: [{ label: "M3 / EVT1 / SW #3" }],
      cleared: [{ itemId: "i1", itemName: "EMC 預測試", labels: ["M3 / EVT1 / SW #3"] }],
    })!;
    expect(text).toContain("1 個工作項原本在使用");
    expect(text).toContain("・EMC 預測試:M3 / EVT1 / SW #3");
    expect(text).toContain("重新替它們選別的樣機");
  });

  it("太多的時候只列前幾個,其餘寫個數", () => {
    const removed = Array.from({ length: 12 }, (_, i) => ({ label: `M3 / DVT / QA #${i + 1}` }));
    const cleared = Array.from({ length: 10 }, (_, i) => ({ itemId: `i${i}`, itemName: `項目${i}`, labels: ["M3 / DVT / QA #1"] }));
    const text = protoSyncNotice({ added: 0, removed, cleared })!;
    expect(text).toContain("…等 12 台");
    expect(text).toContain("…還有 2 個工作項");
    expect(text).not.toContain("項目9");
  });
});
