import { describe, expect, it } from "vitest";
import { pareto, recentLists, summarize, summarizeByProduct, windowCounts, type StatCase } from "./issueStats";

function c(over: Partial<StatCase> & { id: string }): StatCase {
  return {
    caseNo: over.id,
    issueDate: "2026-06-01",
    closeDate: null,
    status: "OPEN",
    kind: "ISSUE",
    product: "M2",
    customer: "A",
    region: "Taiwan",
    warranty: "IN",
    errorType: "HW01-輪子馬達異常",
    parts: [],
    rma: false,
    rmaCuttingDisk: false,
    createdAt: "2026-06-01T00:00:00.000Z",
    firstResponseAt: null,
    ...over,
  };
}

const opts = { mode: "WORKDAY" as const, holidays: new Set<string>(), today: "2026-06-30" };

describe("pareto", () => {
  it("由多到少、佔比與累計佔比(跟 Sheet 的柏拉圖同一種算法)", () => {
    const rows = pareto(["a", "b", "b", "c", "b", "a"]);
    expect(rows.map((r) => [r.name, r.count])).toEqual([["b", 3], ["a", 2], ["c", 1]]);
    expect(rows[0].pct).toBeCloseTo(0.5);
    expect(rows[1].cumPct).toBeCloseTo(5 / 6);
    expect(rows[2].cumPct).toBeCloseTo(1);
  });
  it("空輸入不除以零", () => {
    expect(pareto([])).toEqual([]);
  });
  it("同數量依名稱排,結果穩定", () => {
    expect(pareto(["z", "a"]).map((r) => r.name)).toEqual(["a", "z"]);
  });
});

describe("summarize", () => {
  it("狀態、RMA、處理天數(工作天)、首次回覆時間", () => {
    const list = [
      c({ id: "1", issueDate: "2026-06-01", closeDate: "2026-06-05", status: "PC", rma: true, rmaCuttingDisk: true, firstResponseAt: "2026-06-01T04:00:00.000Z" }),
      c({ id: "2", issueDate: "2026-06-01", closeDate: "2026-06-03", status: "TC", firstResponseAt: "2026-06-01T02:00:00.000Z" }),
      c({ id: "3" }),
    ];
    const s = summarize("M2", list, opts);
    expect(s).toMatchObject({ total: 3, open: 1, tc: 1, pc: 1, na: 0, rma: 1, rmaCuttingDisk: 1 });
    expect(s.avgDays).toBeCloseTo(4); // (5 + 3) / 2
    expect(s.medianDays).toBe(4);
    expect(s.avgFirstResponseHours).toBeCloseTo(3);
  });
  it("零件統計用簡稱(沒有簡稱用完整名稱),一個案件可有多個零件", () => {
    const s = summarize("M2", [
      c({ id: "1", parts: [{ name: "M690 REAR WHEEL HUB", shortName: "M2 WHEEL HUB" }, { name: "X", shortName: null }] }),
      c({ id: "2", parts: [{ name: "M690 REAR WHEEL HUB", shortName: "M2 WHEEL HUB" }] }),
    ], opts);
    expect(s.parts.map((p) => [p.name, p.count])).toEqual([["M2 WHEEL HUB", 2], ["X", 1]]);
  });
  it("問題類型大類與月趨勢", () => {
    const s = summarize("M2", [
      c({ id: "1", errorType: "SW01-App異常", issueDate: "2026-05-02" }),
      c({ id: "2", errorType: "HW02-刀盤馬達異常", issueDate: "2026-06-02" }),
      c({ id: "3", errorType: null, issueDate: "2026-06-03" }),
    ], opts);
    expect(s.categories.map((r) => r.name).sort()).toEqual(["(未填)", "硬體", "軟體"]);
    expect(s.months).toEqual([{ month: "2026-05", count: 1 }, { month: "2026-06", count: 2 }]);
  });
});

describe("summarizeByProduct", () => {
  it("第一份是全部,之後每個產品由案件多到少", () => {
    const list = [c({ id: "1", product: "M1" }), c({ id: "2", product: "M2" }), c({ id: "3", product: "M2" }), c({ id: "4", product: null })];
    const out = summarizeByProduct(list, opts);
    expect(out.map((s) => [s.product, s.total])).toEqual([["全部", 4], ["M2", 2], ["(未填)", 1], ["M1", 1]]);
  });
});

describe("時間窗與近 30 天清單", () => {
  const list = [
    c({ id: "a", issueDate: "2026-06-28" }), // 2 天前
    c({ id: "b", issueDate: "2026-06-20", status: "PC", closeDate: "2026-06-25" }), // 10 天前
    c({ id: "d", issueDate: "2026-06-05", customer: "B" }), // 25 天前
    c({ id: "e", issueDate: "2026-04-01" }), // 90 天前
  ];
  it("<7、7–14、<30、全部", () => {
    const w = windowCounts(list, "2026-06-30");
    expect(Object.fromEntries(w.map((x) => [x.key, x.total]))).toEqual({ d7: 1, d14: 1, d30: 3, all: 4 });
  });
  it("客戶 × 問題類型與保固分組", () => {
    const w = windowCounts(list, "2026-06-30").find((x) => x.key === "all")!;
    expect(w.customerErrors[0]).toMatchObject({ customer: "A", count: 3 });
    expect(w.warranty[0]).toMatchObject({ name: "IN", count: 4 });
  });
  it("近 30 天:處理中 vs 已解決(TC/PC)", () => {
    const r = recentLists(list, "2026-06-30");
    expect(r.open.map((x) => x.id).sort()).toEqual(["a", "d"]);
    expect(r.resolved.map((x) => x.id)).toEqual(["b"]);
  });
  it("未來日期的案件不算進時間窗", () => {
    const w = windowCounts([c({ id: "f", issueDate: "2026-07-05" })], "2026-06-30");
    expect(w.find((x) => x.key === "all")!.total).toBe(0);
  });
});
