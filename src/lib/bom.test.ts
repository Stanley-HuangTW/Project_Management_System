import { describe, it, expect } from "vitest";
import {
  summariseBom,
  flattenBom,
  bomMaterialBudget,
  reconstructBomTree,
  type BomLineInput,
  type IndentedBomLine,
} from "./bom";

function indented(over: Partial<IndentedBomLine> & { depth: number; name: string }): IndentedBomLine {
  return {
    vendor: "",
    partNumber: "",
    qty: 1,
    unitPrice: 0,
    currency: "TWD",
    fxRate: 1,
    note: "",
    deliveryDate: null,
    ...over,
  };
}

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
    deliveryDate: null,
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

describe("reconstructBomTree", () => {
  it("全部同一階層,大家都是最上層", () => {
    const { rows, warnings } = reconstructBomTree([
      indented({ depth: 0, name: "a" }),
      indented({ depth: 0, name: "b" }),
    ]);
    expect(warnings).toEqual([]);
    expect(rows.map((r) => r.parentIndex)).toEqual([null, null]);
  });

  it("往下一層,上層是緊接在前面那一筆", () => {
    const { rows } = reconstructBomTree([
      indented({ depth: 0, name: "mod" }),
      indented({ depth: 1, name: "part" }),
    ]);
    expect(rows[1].parentIndex).toBe(0);
  });

  it("同一層的兩筆,共用同一個上層", () => {
    const { rows } = reconstructBomTree([
      indented({ depth: 0, name: "mod" }),
      indented({ depth: 1, name: "p1" }),
      indented({ depth: 1, name: "p2" }),
    ]);
    expect(rows[1].parentIndex).toBe(0);
    expect(rows[2].parentIndex).toBe(0);
  });

  it("退回上一層再往下,上層對回正確的那一筆祖先", () => {
    const { rows } = reconstructBomTree([
      indented({ depth: 0, name: "modA" }), // 0
      indented({ depth: 1, name: "p1" }), // 1, parent 0
      indented({ depth: 0, name: "modB" }), // 2
      indented({ depth: 1, name: "p2" }), // 3, parent 2 (不是 0)
    ]);
    expect(rows[3].parentIndex).toBe(2);
  });

  it("三層:每一層都對到正確的直接上層", () => {
    const { rows } = reconstructBomTree([
      indented({ depth: 0, name: "top" }),
      indented({ depth: 1, name: "mid" }),
      indented({ depth: 2, name: "leaf" }),
    ]);
    expect(rows[1].parentIndex).toBe(0);
    expect(rows[2].parentIndex).toBe(1);
  });

  it("階層從 0 跳到 2,自動夾回上一列的下一層,而且講清楚是哪一筆", () => {
    const { rows, warnings } = reconstructBomTree([
      indented({ depth: 0, name: "top" }),
      indented({ depth: 2, name: "跳太多" }),
    ]);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].parentIndex).toBe(0);
    expect(warnings.join()).toContain("跳太多");
  });

  it("負的階層當成 0", () => {
    const { rows } = reconstructBomTree([indented({ depth: -1, name: "a" })]);
    expect(rows[0].depth).toBe(0);
    expect(rows[0].parentIndex).toBeNull();
  });

  it("空清單回傳空結果", () => {
    expect(reconstructBomTree([])).toEqual({ rows: [], warnings: [] });
  });

  it("還原出來的父子關係餵回 summariseBom,算得出一樣的單台價格", () => {
    const { rows } = reconstructBomTree([
      indented({ depth: 0, name: "mod", qty: 2 }),
      indented({ depth: 1, name: "leaf", qty: 3, unitPrice: 10 }),
    ]);
    const asInput: BomLineInput[] = rows.map((r, i) => ({
      id: String(i),
      parentId: r.parentIndex === null ? null : String(r.parentIndex),
      name: r.name,
      vendor: r.vendor,
      partNumber: r.partNumber,
      qty: r.qty,
      unitPrice: r.unitPrice,
      currency: r.currency,
      fxRate: r.fxRate,
      note: r.note,
      deliveryDate: r.deliveryDate,
      order: i,
    }));
    // leaf: 3*10=30 一組;mod 用兩組 = 60。
    expect(summariseBom(asInput).unitCostTwd).toBe(60);
  });
});
