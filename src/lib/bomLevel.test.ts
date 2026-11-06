import { describe, expect, it } from "vitest";
import { maxBomLevel, setBomLevel, type BomMove, type FlatBomLine } from "./bomLevel";

/** 用「名稱 + 階層(0 起算)」一列一列描述一張表,自己排出上層與同層順序(從 1 起算),跟資料庫裡的樣子一樣。 */
function table(spec: [string, number][]): FlatBomLine[] {
  const stack: string[] = [];
  const counter = new Map<string | null, number>();
  return spec.map(([id, depth]) => {
    const parentId = depth > 0 ? stack[depth - 1] : null;
    stack[depth] = id;
    stack.length = depth + 1;
    const order = (counter.get(parentId) ?? 0) + 1;
    counter.set(parentId, order);
    return { id, parentId, depth, order };
  });
}

/** 套用 moves 之後,每一列的 [上層, 順序]。 */
function apply(lines: FlatBomLine[], moves: BomMove[]): Record<string, [string | null, number]> {
  const out: Record<string, [string | null, number]> = Object.fromEntries(lines.map((l) => [l.id, [l.parentId, l.order]]));
  for (const m of moves) out[m.id] = [m.parentId, m.order];
  return out;
}

const run = (lines: FlatBomLine[], id: string, level: number) => {
  const out = setBomLevel(lines, id, level);
  if ("error" in out) throw new Error(out.error);
  return apply(lines, out.moves);
};

describe("setBomLevel:降階(往下一層)", () => {
  it("降階 = 變成前一列的子項目,排在它現有子項目的最後", () => {
    const lines = table([["A", 0], ["A1", 1], ["B", 0]]);
    const after = run(lines, "B", 2);
    expect(after.B).toEqual(["A", 2]);
    expect(after.A).toEqual([null, 1]);
    expect(after.A1).toEqual(["A", 1]);
  });

  it("底下的子項目整串跟著降一階,內部的上下關係不變", () => {
    const lines = table([["A", 0], ["B", 0], ["B1", 1], ["B2", 1], ["B21", 2]]);
    const after = run(lines, "B", 2);
    expect(after.B).toEqual(["A", 1]);
    expect(after.B1).toEqual(["B", 1]);
    expect(after.B2).toEqual(["B", 2]);
    expect(after.B21).toEqual(["B2", 1]);
  });

  it("上層與順序都沒變的列不會出現在要寫回的清單裡(B1 跟著 B 走、上層沒變;C 的同層順序往前遞補)", () => {
    const lines = table([["A", 0], ["B", 0], ["B1", 1], ["C", 0]]);
    const out = setBomLevel(lines, "B", 2);
    expect("moves" in out && out.moves).toEqual([
      { id: "B", parentId: "A", order: 1 },
      { id: "C", parentId: null, order: 2 },
    ]);
  });

  it("不能比前一列深超過一層:說明這一列最多是第幾層", () => {
    const lines = table([["A", 0], ["B", 0]]);
    const out = setBomLevel(lines, "B", 3);
    expect(out).toEqual({ error: expect.stringContaining("最多是 2") });
  });

  it("第一列只能是 1", () => {
    const lines = table([["A", 0], ["B", 0]]);
    expect(setBomLevel(lines, "A", 2)).toEqual({ error: "第一列只能是 BOM LEVEL 1" });
  });
});

describe("setBomLevel:升階(往外一層)", () => {
  it("最後一個子項目升階:變成上層的下一個同層列,不影響別人", () => {
    const lines = table([["A", 0], ["A1", 1], ["A2", 1], ["B", 0]]);
    const after = run(lines, "A2", 1);
    expect(after.A2).toEqual([null, 2]);
    expect(after.B).toEqual([null, 3]);
    expect(after.A1).toEqual(["A", 1]);
  });

  it("中間的子項目升階:後面原本同層的列變成它的子項目(跟看板表格升階一樣)", () => {
    const lines = table([["A", 0], ["A1", 1], ["A2", 1], ["A3", 1], ["B", 0]]);
    const after = run(lines, "A2", 1);
    expect(after.A2).toEqual([null, 2]);
    expect(after.A3).toEqual(["A2", 1]);
    expect(after.A1).toEqual(["A", 1]);
    expect(after.B).toEqual([null, 3]);
  });

  it("一次升兩階:後面超過一層的列夾回前一列的下一層,不會冒出沒有上層的子項目", () => {
    const lines = table([["A", 0], ["B", 1], ["C", 2], ["D", 2]]);
    const after = run(lines, "C", 1);
    expect(after.C).toEqual([null, 2]);
    expect(after.D).toEqual(["C", 1]);
  });

  it("升階帶著自己的子項目一起", () => {
    const lines = table([["A", 0], ["A1", 1], ["A11", 2], ["B", 0]]);
    const after = run(lines, "A1", 1);
    expect(after.A1).toEqual([null, 2]);
    expect(after.A11).toEqual(["A1", 1]);
  });
});

describe("setBomLevel:其他", () => {
  it("階層沒變:沒有要改的", () => {
    const lines = table([["A", 0], ["A1", 1]]);
    expect(setBomLevel(lines, "A1", 2)).toEqual({ moves: [] });
  });

  it("不是 1 以上的整數、找不到的列:說明原因", () => {
    const lines = table([["A", 0]]);
    expect(setBomLevel(lines, "A", 0)).toEqual({ error: expect.stringContaining("1 以上的整數") });
    expect(setBomLevel(lines, "A", 1.5)).toEqual({ error: expect.stringContaining("1 以上的整數") });
    expect(setBomLevel(lines, "A", Number.NaN)).toEqual({ error: expect.stringContaining("1 以上的整數") });
    expect(setBomLevel(lines, "zzz", 1)).toEqual({ error: "找不到這一列" });
  });

  it("先降階再升階,回到原樣", () => {
    const lines = table([["A", 0], ["B", 0], ["B1", 1], ["C", 0]]);
    const down = setBomLevel(lines, "B", 2);
    if (!("moves" in down)) throw new Error("unexpected");
    const afterDown = apply(lines, down.moves);
    const moved: FlatBomLine[] = lines.map((l) => ({ ...l, parentId: afterDown[l.id][0], order: afterDown[l.id][1], depth: l.id === "B" ? 1 : l.id === "B1" ? 2 : l.depth }));
    const back = run(moved, "B", 1);
    expect(back).toEqual(Object.fromEntries(lines.map((l) => [l.id, [l.parentId, l.order]])));
  });

  it("順序亂七八糟的舊資料(沒有從 1 起算、有空號):第一次調整時一併整理成 1、2、3…", () => {
    const lines: FlatBomLine[] = [
      { id: "A", parentId: null, depth: 0, order: 5 },
      { id: "B", parentId: null, depth: 0, order: 9 },
    ];
    const after = run(lines, "B", 2);
    expect(after.A).toEqual([null, 1]);
    expect(after.B).toEqual(["A", 1]);
  });
});

describe("maxBomLevel", () => {
  it("第一列最多 1,其餘最多比前一列深一層", () => {
    const lines = table([["A", 0], ["A1", 1], ["A11", 2], ["B", 0]]);
    expect(maxBomLevel(lines, "A")).toBe(1);
    expect(maxBomLevel(lines, "A1")).toBe(2);
    expect(maxBomLevel(lines, "A11")).toBe(3);
    expect(maxBomLevel(lines, "B")).toBe(4);
  });
});
