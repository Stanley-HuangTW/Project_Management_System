import { describe, it, expect, vi } from "vitest";
import {
  summariseBom,
  flattenBom,
  bomMaterialBudget,
  reconstructBomTree,
  sourcesOfProducts,
  unionProducts,
  validateProductName,
  validateProductRename,
  type BomLineInput,
  type BomNode,
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

describe("產品名稱", () => {
  it("validateProductName:空白、太長、有換行或 Tab 都不行", () => {
    expect(validateProductName("M3")).toBeNull();
    expect(validateProductName("P100_EVT1 充電站")).toBeNull();
    expect(validateProductName("")).toContain("不可為空");
    expect(validateProductName("字".repeat(61))).toContain("太長");
    expect(validateProductName("a\nb")).toContain("換行");
    expect(validateProductName("a\tb")).toContain("Tab");
  });

  it("validateProductRename:新名稱要合格、不能跟現有的產品重名,原本的產品要存在", () => {
    const products = ["AMR", "M3", "充電站"];
    expect(validateProductRename(products, "M3", "M3-Pro")).toBeNull();
    expect(validateProductRename(products, "M3", "")).toContain("不可為空");
    expect(validateProductRename(products, "M3", "字".repeat(61))).toContain("太長");
    expect(validateProductRename(products, "M3", "a\nb")).toContain("換行");
    expect(validateProductRename(products, "M3", "M3")).toContain("跟原本一樣");
    expect(validateProductRename(products, "M3", "充電站")).toContain("已經有「充電站」");
    expect(validateProductRename(products, "沒有這個", "X")).toContain("找不到");
  });

  it("unionProducts:三份名字聯集、去重、排序", () => {
    expect(unionProducts(["M3", "充電站"], ["M3", "AMR"], [])).toEqual(["AMR", "M3", "充電站"]);
    expect(unionProducts([], [], [])).toEqual([]);
  });

  it("sourcesOfProducts:每個名字出現在哪幾處,名字對不上時各自標自己的來源", () => {
    expect(sourcesOfProducts(["M3"], ["M3", "P100_EVT1"], ["M3", "EVT1"])).toEqual({
      M3: ["own", "proto", "bom"],
      P100_EVT1: ["proto"],
      EVT1: ["bom"],
    });
    expect(sourcesOfProducts([], [], [])).toEqual({});
  });
});

/**
 * 舊版 summariseBom(遞迴、每一列從頭走到根、每放一列複製整個陣列)原樣留在這裡當參照:
 * 新版改成不遞迴、時間線性,結果必須跟舊版逐欄一樣。只能用小的樹比——舊版的寫法就是它慢、會爆堆疊的原因。
 */
function referenceSummarise(lines: BomLineInput[]) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const rooted = new Set<string>();
  const orphanIds: string[] = [];
  for (const line of lines) {
    const seen = new Set<string>([line.id]);
    let cursor: string | null = line.parentId;
    let ok = true;
    while (cursor !== null) {
      if (seen.has(cursor) || !byId.has(cursor)) {
        ok = false;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)!.parentId;
    }
    if (ok) rooted.add(line.id);
    else orphanIds.push(line.id);
  }
  const childrenOf = new Map<string | null, BomLineInput[]>();
  for (const line of lines) {
    if (!rooted.has(line.id)) continue;
    childrenOf.set(line.parentId, [...(childrenOf.get(line.parentId) ?? []), line]);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);
  let lineCount = 0;
  const currencies = new Set<string>();
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const build = (line: BomLineInput, depth: number): BomNode => {
    lineCount++;
    const kids = (childrenOf.get(line.id) ?? []).map((c) => build(c, depth + 1));
    const isAssembly = kids.length > 0;
    const unitCostTwd = isAssembly ? round4(kids.reduce((t, k) => t + k.extendedTwd, 0)) : round4(line.unitPrice * line.fxRate);
    if (!isAssembly && line.currency !== "TWD") currencies.add(line.currency);
    return { ...line, depth, children: kids, isAssembly, unitCostTwd, extendedTwd: round4(unitCostTwd * line.qty) };
  };
  const nodes = (childrenOf.get(null) ?? []).map((l) => build(l, 0));
  return {
    nodes,
    unitCostTwd: Math.round(nodes.reduce((t, n) => t + n.extendedTwd, 0) * 100) / 100,
    lineCount,
    foreignCurrencies: [...currencies].sort(),
    orphanIds,
  };
}

describe("summariseBom 很大、很深的 BOM(穩定性)", () => {
  // 這些測試是在防「變成平方時間」(退化時要幾十秒);整套平行跑、機器忙的時候單獨跑 1 秒的會拖到十幾秒,逾時放寬。
  vi.setConfig({ testTimeout: 60_000 });
  // 固定種子的亂數,測試可重現。
  let seed = 20261109;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];

  it("跟舊版逐欄一樣:隨機樹(含環、自己當上層、上層不存在、同序、外幣)", () => {
    for (let round = 0; round < 400; round++) {
      const n = 1 + Math.floor(rand() * 40);
      const ids = Array.from({ length: n }, (_, i) => `L${i}`);
      const lines: BomLineInput[] = ids.map((id) => ({
        id,
        parentId: rand() < 0.3 ? null : rand() < 0.08 ? "不存在" : pick(ids), // 可能指到自己、指到後面的列、繞成環
        name: id,
        vendor: "",
        partNumber: "",
        qty: pick([1, 2, 0.5, 14]),
        unitPrice: pick([0, 95, 380, 1200.5]),
        currency: pick(["TWD", "USD"]),
        fxRate: pick([1, 32, 31.5]),
        note: "",
        deliveryDate: null,
        order: Math.floor(rand() * 5), // 故意常常同序,穩定排序也要一樣
      }));
      expect(summariseBom(lines)).toEqual(referenceSummarise(lines));
    }
  });

  it("10 萬個兄弟列:幾百毫秒內算完(舊版要將近一分鐘)", () => {
    const lines: BomLineInput[] = Array.from({ length: 100_000 }, (_, i) => line({ id: `W${i}`, parentId: i === 0 ? null : "W0", unitPrice: 1, order: i }));
    const t0 = performance.now();
    const out = summariseBom(lines);
    const ms = performance.now() - t0;
    expect(out.lineCount).toBe(100_000);
    expect(out.orphanIds).toEqual([]);
    expect(out.unitCostTwd).toBe(99_999);
    expect(ms).toBeLessThan(20_000);
  });

  it("5 萬層深的鏈:不會爆呼叫堆疊、也不是平方時間;攤平一樣不會爆", () => {
    const depth = 50_000;
    const lines: BomLineInput[] = Array.from({ length: depth }, (_, i) => line({ id: `D${i}`, parentId: i === 0 ? null : `D${i - 1}`, unitPrice: i === depth - 1 ? 10 : 0, order: 0 }));
    const t0 = performance.now();
    const out = summariseBom(lines);
    const flat = flattenBom(out.nodes);
    const ms = performance.now() - t0;
    expect(out.lineCount).toBe(depth);
    expect(flat).toHaveLength(depth);
    expect(flat[depth - 1].depth).toBe(depth - 1);
    expect(out.unitCostTwd).toBe(10);
    expect(ms).toBeLessThan(20_000);
  });

  it("10 萬列全是孤兒(上層不存在)或繞成環:也是線性時間,全部列成孤兒", () => {
    const orphans: BomLineInput[] = Array.from({ length: 100_000 }, (_, i) => line({ id: `O${i}`, parentId: "不存在" }));
    const ring: BomLineInput[] = Array.from({ length: 100_000 }, (_, i) => line({ id: `R${i}`, parentId: `R${(i + 1) % 100_000}` }));
    const t0 = performance.now();
    expect(summariseBom(orphans).orphanIds).toHaveLength(100_000);
    expect(summariseBom(ring).orphanIds).toHaveLength(100_000);
    expect(performance.now() - t0).toBeLessThan(20_000);
  });
});
