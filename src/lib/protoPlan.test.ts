import { describe, expect, it } from "vitest";
import { summariseProtoPlan, type ProtoCell } from "./protoPlan";

const phases = ["evt", "dvt1", "dvt2", "pvt1"];

const cell = (
  product: string,
  unit: string,
  phaseId: string,
  qty: number,
  note = ""
): ProtoCell => ({ product, unit, phaseId, qty, note });

describe("summariseProtoPlan", () => {
  const cells = [
    cell("M3", "HW-EE", "dvt1", 1),
    cell("M3", "HW-EE", "dvt2", 1),
    cell("M3", "HW-EE", "pvt1", 1),
    cell("M3", "SW", "evt", 2, "mock up"),
    cell("M3", "SW", "dvt1", 4),
    cell("M3", "SW", "dvt2", 4),
    cell("M3", "SW", "pvt1", 2),
    cell("充電站", "SW", "dvt1", 3),
  ];

  it("照產品分開,同一個產品裡一個單位一列", () => {
    const summary = summariseProtoPlan(phases, cells);
    expect(summary.products.map((p) => p.product)).toEqual(["M3", "充電站"]);
    expect(summary.products[0].rows.map((r) => r.unit)).toEqual(["HW-EE", "SW"]);
  });

  it("一列的合計是它跨階段加起來", () => {
    const summary = summariseProtoPlan(phases, cells);
    const sw = summary.products[0].rows.find((r) => r.unit === "SW")!;
    expect(sw.total).toBe(12);
    expect(sw.cells.find((c) => c.phaseId === "evt")!.qty).toBe(2);
  });

  it("備註跟著格子走", () => {
    const summary = summariseProtoPlan(phases, cells);
    const sw = summary.products[0].rows.find((r) => r.unit === "SW")!;
    expect(sw.cells.find((c) => c.phaseId === "evt")!.note).toBe("mock up");
  });

  it("每個階段的小計 —— 那張表的 sub 那一列", () => {
    const summary = summariseProtoPlan(phases, cells);
    const m3 = summary.products[0];
    expect(m3.byPhase.find((p) => p.phaseId === "dvt1")!.qty).toBe(5);
    expect(m3.total).toBe(15);
  });

  it("全部產品加起來,備料看的是這一列", () => {
    const summary = summariseProtoPlan(phases, cells);
    expect(summary.byPhase.find((p) => p.phaseId === "dvt1")!.qty).toBe(8);
    expect(summary.total).toBe(18);
  });

  it("每一列都有完整的階段欄位,沒填的是 0 —— 不然欄位會對不齊", () => {
    const summary = summariseProtoPlan(phases, cells);
    for (const product of summary.products) {
      for (const row of product.rows) {
        expect(row.cells.map((c) => c.phaseId)).toEqual(phases);
      }
    }
  });

  it("階段被刪掉之後留下的格子不會撐出沒有表頭的欄位", () => {
    const summary = summariseProtoPlan(phases, [...cells, cell("M3", "SW", "已刪除的階段", 99)]);
    const sw = summary.products[0].rows.find((r) => r.unit === "SW")!;
    expect(sw.total).toBe(12);
    expect(summary.total).toBe(18);
  });

  it("同一格填兩次是相加,不是後面蓋掉前面", () => {
    const summary = summariseProtoPlan(phases, [
      cell("M3", "SW", "dvt1", 2),
      cell("M3", "SW", "dvt1", 3),
    ]);
    expect(summary.products[0].rows[0].cells.find((c) => c.phaseId === "dvt1")!.qty).toBe(5);
  });

  it("沒有資料的時候是空的,不是壞的", () => {
    const summary = summariseProtoPlan(phases, []);
    expect(summary.products).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.byPhase).toHaveLength(4);
  });
});
