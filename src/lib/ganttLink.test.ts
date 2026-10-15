import { describe, expect, it } from "vitest";
import { buildWbsIndexFromItems } from "@/lib/predecessorLink";
import {
  lagToKeepDates,
  relationshipForEdges,
  validateNewLink,
  withoutPredEntry,
  withPredEntry,
  type LinkItem,
} from "@/lib/ganttLink";

const PRED = "col-pred";
const item = (id: string, order: number, pred: string | null = null, parentId: string | null = null): LinkItem => ({
  id,
  parentId,
  order,
  groupId: "g",
  cellValues: pred === null ? [] : [{ columnId: PRED, value: pred }],
});
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("relationshipForEdges", () => {
  it("從前置的哪一端拉到後續的哪一端,決定關係", () => {
    expect(relationshipForEdges("end", "start")).toBe("FS");
    expect(relationshipForEdges("start", "start")).toBe("SS");
    expect(relationshipForEdges("end", "end")).toBe("FF");
    expect(relationshipForEdges("start", "end")).toBe("SF");
  });
});

describe("validateNewLink", () => {
  it("合理的連結回 null", () => {
    const items = [item("a", 0), item("b", 1)];
    expect(validateNewLink(items, PRED, "a", "b")).toBeNull();
  });

  it("不能連到自己", () => {
    expect(validateNewLink([item("a", 0)], PRED, "a", "a")).toMatch(/自己/);
  });

  it("已經是前置就擋下,並指引去點箭頭", () => {
    const items = [item("a", 0), item("b", 1, "a:SS")];
    expect(validateNewLink(items, PRED, "a", "b")).toMatch(/已經存在/);
  });

  it("父項與子項不能互連(兩個方向都擋)", () => {
    const items = [item("p", 0), item("c", 0, null, "p"), item("g", 0, null, "c")];
    expect(validateNewLink(items, PRED, "p", "c")).toMatch(/父項目/);
    expect(validateNewLink(items, PRED, "c", "p")).toMatch(/父項目/);
    expect(validateNewLink(items, PRED, "p", "g")).toMatch(/父項目/);
  });

  it("直接循環:前置自己已經在等後續任務", () => {
    const items = [item("a", 0, "b"), item("b", 1)];
    expect(validateNewLink(items, PRED, "a", "b")).toMatch(/循環/);
  });

  it("間接循環:a 等 b、b 等 c,不能再讓 c 等 a", () => {
    const items = [item("a", 0, "b"), item("b", 1, "c"), item("c", 2)];
    expect(validateNewLink(items, PRED, "a", "c")).toMatch(/循環/);
  });

  it("不是循環的長鏈照樣放行", () => {
    const items = [item("a", 0, "b"), item("b", 1, "c"), item("c", 2), item("d", 3)];
    expect(validateNewLink(items, PRED, "d", "a")).toBeNull();
  });

  it("找不到項目", () => {
    expect(validateNewLink([item("a", 0)], PRED, "zzz", "a")).toMatch(/找不到/);
  });
});

describe("withPredEntry / withoutPredEntry", () => {
  const items = [item("a", 0), item("b", 1), item("c", 2, "a:SS+2")];
  const index = buildWbsIndexFromItems(items);

  it("新增一條:保留原有的依賴與它們各自的關係、延遲", () => {
    expect(withPredEntry(index, "g", "a:SS+2", { itemId: "b", relationship: "FS", lag: null })).toBe("a:SS+2,b:FS");
  });

  it("同一個前置再設一次就是取代,不會變兩條", () => {
    expect(withPredEntry(index, "g", "a:SS+2", { itemId: "a", relationship: "FF", lag: 3 })).toBe("a:FF+3");
  });

  it("原本沒有前置", () => {
    expect(withPredEntry(index, "g", null, { itemId: "a", relationship: "FS", lag: null })).toBe("a:FS");
  });

  it("負的延遲(提前)也寫得進去", () => {
    expect(withPredEntry(index, "g", null, { itemId: "a", relationship: "FS", lag: -2 })).toBe("a:FS-2");
  });

  it("拿掉一條,其他不動;拿光了是 null", () => {
    expect(withoutPredEntry(index, "g", "a:SS+2,b:FS", "a")).toBe("b:FS");
    expect(withoutPredEntry(index, "g", "a:SS+2", "a")).toBeNull();
  });
});

describe("lagToKeepDates", () => {
  const pred = { start: d("2026-10-05"), end: d("2026-10-09") }; // 週一到週五
  const none = new Set<string>();

  it("FS(工作天):下週三開始 = 下週一再晚 2 天", () => {
    const succ = { start: d("2026-10-14"), end: d("2026-10-16") };
    expect(lagToKeepDates(pred, succ, "FS", "BUSINESS", none)).toBe(2);
  });

  it("FS(日曆天):同一個日期要補 4 天", () => {
    const succ = { start: d("2026-10-14"), end: d("2026-10-16") };
    expect(lagToKeepDates(pred, succ, "FS", "CALENDAR", none)).toBe(4);
  });

  it("緊接著前置的完成日就是 0", () => {
    const succ = { start: d("2026-10-12"), end: d("2026-10-14") };
    expect(lagToKeepDates(pred, succ, "FS", "BUSINESS", none)).toBe(0);
  });

  it("後續任務比前置完成得早:延遲是負的(提前)", () => {
    const succ = { start: d("2026-10-07"), end: d("2026-10-08") };
    expect(lagToKeepDates(pred, succ, "FS", "BUSINESS", none)).toBe(-3);
  });

  it("FF 對準完成日", () => {
    const succ = { start: d("2026-10-14"), end: d("2026-10-16") };
    expect(lagToKeepDates(pred, succ, "FF", "BUSINESS", none)).toBe(5);
  });

  it("SS 對準開始日", () => {
    const succ = { start: d("2026-10-14"), end: d("2026-10-16") };
    expect(lagToKeepDates(pred, succ, "SS", "BUSINESS", none)).toBe(7);
  });

  it("算出來的延遲真的能還原成原本的日期(假日也算進去)", () => {
    const holidays = new Set(["2026-10-12"]);
    const succ = { start: d("2026-10-14"), end: d("2026-10-16") };
    const lag = lagToKeepDates(pred, succ, "FS", "BUSINESS", holidays);
    expect(lag).toBe(1); // 10/12 放假,下一個工作日是 10/13,再晚 1 天就是 10/14
  });
});
