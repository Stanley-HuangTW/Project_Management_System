import { describe, expect, it } from "vitest";
import { planBomMove, selectionRoots, shiftBomLevels } from "./bomBulk";
import type { BomMove, FlatBomLine } from "./bomLevel";

/** 用「名稱 + 階層(0 起算)」一列一列描述一張表,自己排出上層與同層順序(從 1 起算)。 */
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
const apply = (lines: FlatBomLine[], moves: BomMove[]): Record<string, [string | null, number]> => {
  const out: Record<string, [string | null, number]> = Object.fromEntries(lines.map((l) => [l.id, [l.parentId, l.order]]));
  for (const m of moves) out[m.id] = [m.parentId, m.order];
  return out;
};
const names = (lines: FlatBomLine[]) => new Map(lines.map((l) => [l.id, l.id]));
const sel = (...ids: string[]) => new Set(ids);

describe("selectionRoots", () => {
  const lines = table([["A", 0], ["A1", 1], ["A11", 2], ["B", 0], ["B1", 1], ["C", 0]]);

  it("祖先也被勾的不另外算,子孫一起算進去", () => {
    const out = selectionRoots(lines, sel("A", "A11", "B1"));
    expect(out.rootIds).toEqual(["A", "B1"]);
    expect([...out.subtreeIds].sort()).toEqual(["A", "A1", "A11", "B1"]);
  });

  it("只勾子項目:它自己就是根,不帶上層", () => {
    const out = selectionRoots(lines, sel("A1"));
    expect(out.rootIds).toEqual(["A1"]);
    expect([...out.subtreeIds].sort()).toEqual(["A1", "A11"]);
  });

  it("根的順序照畫面", () => {
    expect(selectionRoots(lines, sel("C", "A", "B")).rootIds).toEqual(["A", "B", "C"]);
  });

  it("沒勾:空的", () => {
    expect(selectionRoots(lines, sel())).toEqual({ rootIds: [], subtreeIds: new Set() });
  });
});

describe("shiftBomLevels:降階", () => {
  it("連續勾的幾列一起降階:都掛到前一列底下,保持彼此的順序", () => {
    const lines = table([["A", 0], ["B", 0], ["C", 0], ["D", 0]]);
    const out = shiftBomLevels(lines, names(lines), sel("B", "C"), 1);
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.B).toEqual(["A", 1]);
    expect(after.C).toEqual(["A", 2]);
    expect(after.D).toEqual([null, 2]);
  });

  it("不連續的兩列各自降階,各帶底下的子項目", () => {
    const lines = table([["A", 0], ["B", 0], ["B1", 1], ["C", 0], ["D", 0], ["D1", 1]]);
    const out = shiftBomLevels(lines, names(lines), sel("B", "D"), 1);
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.B).toEqual(["A", 1]);
    expect(after.B1).toEqual(["B", 1]);
    expect(after.D).toEqual(["C", 1]);
    expect(after.D1).toEqual(["D", 1]);
  });

  it("第一列不能降階:全部不動,說明是哪一列", () => {
    const lines = table([["A", 0], ["B", 0]]);
    const out = shiftBomLevels(lines, names(lines), sel("A", "B"), 1);
    expect(out).toEqual({ error: expect.stringContaining("「A」降階") });
  });

  it("前面沒有同層的列:太深,說明原因", () => {
    const lines = table([["A", 0], ["A1", 1], ["B", 0]]);
    // A1 降階 → 第 3 層,前一列是 A(第 1 層):最多第 2 層 ✗
    const out = shiftBomLevels(lines, names(lines), sel("A1"), 1);
    expect(out).toEqual({ error: expect.stringContaining("「A1」降階") });
  });
});

describe("shiftBomLevels:升階", () => {
  it("勾的幾個子項目一起升階,各帶子項目;後面沒勾的同層列被接管", () => {
    const lines = table([["A", 0], ["A1", 1], ["A2", 1], ["A21", 2], ["A3", 1], ["B", 0]]);
    const out = shiftBomLevels(lines, names(lines), sel("A2"), -1);
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.A2).toEqual([null, 2]);
    expect(after.A21).toEqual(["A2", 1]);
    expect(after.A3).toEqual(["A2", 2]);
  });

  it("已經是 1:不能再升階,整批都不動", () => {
    const lines = table([["A", 0], ["A1", 1]]);
    const out = shiftBomLevels(lines, names(lines), sel("A", "A1"), -1);
    // A 是根(A1 跟著它),A 在 BOM LEVEL 1 不能升
    expect(out).toEqual({ error: expect.stringContaining("「A」已經是 BOM LEVEL 1") });
  });

  it("沒勾任何列:說明", () => {
    const lines = table([["A", 0]]);
    expect(shiftBomLevels(lines, names(lines), sel(), 1)).toEqual({ error: "沒有選到任何列" });
  });
});

describe("planBomMove:同一份 BOM 內", () => {
  const lines = table([["A", 0], ["A1", 1], ["A2", 1], ["B", 0], ["B1", 1], ["C", 0]]);

  it("放到另一個上層底下的最後面", () => {
    const out = planBomMove(lines, ["A2"], { parentId: "B", position: "last" });
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.A2).toEqual(["B", 2]);
    expect(after.B1).toEqual(["B", 1]);
    expect(after.A1).toEqual(["A", 1]);
  });

  it("放到最前面:原本的列順序往後挪", () => {
    const out = planBomMove(lines, ["C"], { parentId: null, position: "first" });
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.C).toEqual([null, 1]);
    expect(after.A).toEqual([null, 2]);
    expect(after.B).toEqual([null, 3]);
  });

  it("接在某一列後面;搬走之後原本那一層的順序遞補,沒有空號", () => {
    const out = planBomMove(lines, ["A1"], { parentId: "B", position: { after: "B1" } });
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.A1).toEqual(["B", 2]);
    expect(after.A2).toEqual(["A", 1]);
  });

  it("勾了好幾列:照畫面順序放進去,各帶子項目(子項目的上層不用動),原本那一層的順序遞補", () => {
    const out = planBomMove(lines, ["A", "B"], { parentId: "C", position: "last" });
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.A).toEqual(["C", 1]);
    expect(after.B).toEqual(["C", 2]);
    expect(after.A1).toEqual(["A", 1]);
    // A1、A2、B1 的上層與順序都沒變,不用寫回;C 的同層順序因為 A、B 搬走而從 3 遞補成 1。
    expect(out.moves.map((m) => m.id).sort()).toEqual(["A", "B", "C"]);
    expect(after.C).toEqual([null, 1]);
  });

  it("同一層內往後挪:接在後面一列的後面", () => {
    const out = planBomMove(lines, ["A"], { parentId: null, position: { after: "B" } });
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(lines, out.moves);
    expect(after.B).toEqual([null, 1]);
    expect(after.A).toEqual([null, 2]);
    expect(after.C).toEqual([null, 3]);
  });

  it("目標是被搬的列自己或它底下的列:不行", () => {
    expect(planBomMove(lines, ["A"], { parentId: "A", position: "last" })).toEqual({ error: expect.stringContaining("目標不能是被搬動的列") });
    expect(planBomMove(lines, ["A"], { parentId: "A1", position: "last" })).toEqual({ error: expect.stringContaining("目標不能是被搬動的列") });
  });

  it("找不到目標上層、找不到「接在後面」的那一列(或它是被搬的):說明", () => {
    expect(planBomMove(lines, ["A"], { parentId: "zzz", position: "last" })).toEqual({ error: "找不到目標的上層" });
    expect(planBomMove(lines, ["A1"], { parentId: "A", position: { after: "A1" } })).toEqual({ error: expect.stringContaining("找不到要接在後面") });
    expect(planBomMove(lines, ["C"], { parentId: "B", position: { after: "A1" } })).toEqual({ error: expect.stringContaining("找不到要接在後面") });
  });
});

describe("planBomMove:搬進(或複製進)另一份 BOM", () => {
  const target = table([["X", 0], ["X1", 1], ["Y", 0]]);

  it("外來的列(不在目標清單裡)放到最上層最後面,目標原有的列不動", () => {
    const out = planBomMove(target, ["n1", "n2"], { parentId: null, position: "last" });
    expect(out).toEqual({ moves: [{ id: "n1", parentId: null, order: 3 }, { id: "n2", parentId: null, order: 4 }] });
  });

  it("接在某一列後面:後面的列順序往後挪", () => {
    const out = planBomMove(target, ["n1"], { parentId: null, position: { after: "X" } });
    if (!("moves" in out)) throw new Error(out.error);
    const after = apply(target, out.moves);
    expect(after.n1).toEqual([null, 2]);
    expect(after.Y).toEqual([null, 3]);
    expect(after.X).toEqual([null, 1]);
  });

  it("放進目標的某一列底下", () => {
    const out = planBomMove(target, ["n1"], { parentId: "Y", position: "first" });
    expect(out).toEqual({ moves: [{ id: "n1", parentId: "Y", order: 1 }] });
  });

  it("目標是空的 BOM:放最上層", () => {
    expect(planBomMove([], ["n1"], { parentId: null, position: "last" })).toEqual({ moves: [{ id: "n1", parentId: null, order: 1 }] });
  });
});
