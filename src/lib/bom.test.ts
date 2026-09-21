import { describe, it, expect } from "vitest";
import { summariseBom, flattenBom, bomMaterialBudget, type BomLineInput } from "./bom";

function line(over: Partial<BomLineInput> & { id: string }): BomLineInput {
  return {
    parentId: null,
    name: over.id,
    vendor: "",
    partNumber: "",
    qty: 1,
    unitPrice: 0,
    currency: "TWD",
    fxRate: 1,
    note: "",
    order: 0,
    ...over,
  };
}

describe("summariseBom", () => {
  it("平的一張表:單台價格 = 每一列的單價 × 數量加起來", () => {
    const out = summariseBom([
      line({ id: "a", qty: 2, unitPrice: 100, order: 1 }),
      line({ id: "b", qty: 1, unitPrice: 50, order: 2 }),
    ]);
    expect(out.unitCostTwd).toBe(250);
    expect(out.nodes.map((n) => n.name)).toEqual(["a", "b"]);
  });

  it("子集的單價是底下加起來的,自己填的單價不算數", () => {
    const out = summariseBom([
      // 這個子集自己填了 9999,但它有子項目,所以不該被採用。
      line({ id: "mod", qty: 1, unitPrice: 9999, order: 1 }),
      line({ id: "p1", parentId: "mod", qty: 2, unitPrice: 30, order: 1 }),
      line({ id: "p2", parentId: "mod", qty: 1, unitPrice: 40, order: 2 }),
    ]);
    expect(out.nodes[0].isAssembly).toBe(true);
    expect(out.nodes[0].unitCostTwd).toBe(100);
    expect(out.unitCostTwd).toBe(100);
  });

  it("子集要用兩組,整組內容乘以二", () => {
    const out = summariseBom([
      line({ id: "mod", qty: 2, order: 1 }),
      line({ id: "p1", parentId: "mod", qty: 3, unitPrice: 10, order: 1 }),
    ]);
    expect(out.nodes[0].unitCostTwd).toBe(30);
    expect(out.nodes[0].extendedTwd).toBe(60);
    expect(out.unitCostTwd).toBe(60);
  });

  it("三層:每一層的乘法只做一次", () => {
    const out = summariseBom([
      line({ id: "top", qty: 2, order: 1 }),
      line({ id: "mid", parentId: "top", qty: 3, order: 1 }),
      line({ id: "leaf", parentId: "mid", qty: 5, unitPrice: 7, order: 1 }),
    ]);
    // leaf 35 → mid 一組 35,用三組 = 105 → top 一組 105,用兩組 = 210
    expect(out.unitCostTwd).toBe(210);
    expect(flattenBom(out.nodes).map((n) => n.depth)).toEqual([0, 1, 2]);
  });

  it("外幣照它自己的匯率換算,而且會列出用到哪些幣別", () => {
    const out = summariseBom([
      line({ id: "usd", qty: 2, unitPrice: 7000, currency: "USD", fxRate: 32, order: 1 }),
      line({ id: "twd", qty: 1, unitPrice: 500, order: 2 }),
    ]);
    expect(out.unitCostTwd).toBe(448500);
    expect(out.foreignCurrencies).toEqual(["USD"]);
  });

  it("子集底下混幣別,各自換算後才相加", () => {
    const out = summariseBom([
      line({ id: "mod", qty: 1, order: 1 }),
      line({ id: "a", parentId: "mod", qty: 1, unitPrice: 10, currency: "USD", fxRate: 32, order: 1 }),
      line({ id: "b", parentId: "mod", qty: 1, unitPrice: 100, order: 2 }),
    ]);
    expect(out.nodes[0].unitCostTwd).toBe(420);
  });

  it("照 order 排,不是照傳進來的順序", () => {
    const out = summariseBom([
      line({ id: "b", order: 2 }),
      line({ id: "a", order: 1 }),
    ]);
    expect(out.nodes.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("掛在不存在的上層:挑出來,不當成最上層偷偷加進總價", () => {
    const out = summariseBom([
      line({ id: "a", qty: 1, unitPrice: 100, order: 1 }),
      line({ id: "ghost", parentId: "沒這個人", qty: 1, unitPrice: 999, order: 2 }),
    ]);
    expect(out.unitCostTwd).toBe(100);
    expect(out.orphanIds).toEqual(["ghost"]);
  });

  it("上層兜成一圈也算孤兒,不會無限遞迴", () => {
    const out = summariseBom([
      line({ id: "a", parentId: "b", unitPrice: 1, order: 1 }),
      line({ id: "b", parentId: "a", unitPrice: 1, order: 2 }),
    ]);
    expect(out.nodes).toEqual([]);
    expect(out.orphanIds.sort()).toEqual(["a", "b"]);
    expect(out.unitCostTwd).toBe(0);
  });

  it("自己是自己的上層也擋得住", () => {
    const out = summariseBom([line({ id: "a", parentId: "a", unitPrice: 1 })]);
    expect(out.orphanIds).toEqual(["a"]);
  });

  it("空的 BOM 就是 0,不是 NaN", () => {
    const out = summariseBom([]);
    expect(out.unitCostTwd).toBe(0);
    expect(out.lineCount).toBe(0);
  });

  it("小數數量(例如一台用 0.5 公尺線材)算得出來", () => {
    const out = summariseBom([line({ id: "wire", qty: 0.5, unitPrice: 33, order: 1 })]);
    expect(out.nodes[0].extendedTwd).toBe(16.5);
  });

  it("lineCount 含子集,讓畫面說得出這張表有幾列", () => {
    const out = summariseBom([
      line({ id: "mod", order: 1 }),
      line({ id: "p1", parentId: "mod", order: 1 }),
      line({ id: "p2", parentId: "mod", order: 2 }),
    ]);
    expect(out.lineCount).toBe(3);
  });
});

describe("bomMaterialBudget", () => {
  it("每個產品各自算完再加,不是拿平均", () => {
    expect(
      bomMaterialBudget([
        { product: "M3", unitCostTwd: 10000, qty: 3 },
        { product: "充電站", unitCostTwd: 2500, qty: 2 },
      ])
    ).toBe(35000);
  });

  it("沒排樣機的產品貢獻 0", () => {
    expect(bomMaterialBudget([{ product: "M3", unitCostTwd: 10000, qty: 0 }])).toBe(0);
  });

  it("什麼都沒有就是 0", () => {
    expect(bomMaterialBudget([])).toBe(0);
  });
});
