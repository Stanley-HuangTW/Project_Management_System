import { describe, expect, it } from "vitest";
import {
  buildMoveInverse,
  classifyDropZone,
  computeLvlDelta,
  countAdoptedBy,
  indentTarget,
  moveDownTarget,
  moveUpTarget,
  outdentTarget,
  parentAfterMove,
  previewDrop,
  resolveItemMove,
  type DropZone,
  type MoveItemLike,
} from "./dragReorder";
import { computeWbsCodes } from "./wbs";

describe("classifyDropZone", () => {
  const base = { rowTop: 100, rowHeight: 40, targetIndentPx: 32, indentUnitPx: 16, targetIsTopLevel: false };

  it("上半部/中間判定為 child", () => {
    expect(classifyDropZone({ ...base, pointerY: 110, pointerX: 32 })).toBe("child");
    expect(classifyDropZone({ ...base, pointerY: 125, pointerX: 32 })).toBe("child");
  });

  it("下緣、同縮排判定為 after", () => {
    expect(classifyDropZone({ ...base, pointerY: 135, pointerX: 32 })).toBe("after");
  });

  it("下緣、往左拖判定為 outdent", () => {
    expect(classifyDropZone({ ...base, pointerY: 135, pointerX: 10 })).toBe("outdent");
  });

  it("目標已經是最上層時,下緣往左拖退化成 after", () => {
    expect(classifyDropZone({ ...base, pointerY: 135, pointerX: 10, targetIsTopLevel: true })).toBe("after");
  });
});

describe("resolveItemMove", () => {
  // 1
  // ├─ 1.1
  // └─ 1.2
  //    └─ 1.2.1
  const items: MoveItemLike[] = [
    { id: "root", parentId: null, order: 0 },
    { id: "a", parentId: "root", order: 0 },
    { id: "b", parentId: "root", order: 1 },
    { id: "b1", parentId: "b", order: 0 },
  ];

  it("拒絕拖到自己身上", () => {
    const result = resolveItemMove(items, "a", "a", "after");
    expect(result).toEqual({ ok: false, reason: "self" });
  });

  it("拒絕拖到自己的子孫身上(含父子循環不會卡死)", () => {
    const cyclic: MoveItemLike[] = [
      { id: "x", parentId: "y", order: 0 },
      { id: "y", parentId: "x", order: 0 },
    ];
    const result = resolveItemMove(cyclic, "x", "y", "child");
    expect(result).toEqual({ ok: false, reason: "descendant" });
  });

  it("拒絕把已經是最上層的目標外移", () => {
    const result = resolveItemMove(items, "a", "root", "outdent");
    expect(result).toEqual({ ok: false, reason: "no-parent-to-outdent-to" });
  });

  it("child:附加在目標現有子項的最後面", () => {
    const result = resolveItemMove(items, "a", "b", "child");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // b1 的 parentId/order 沒有變化,不需要出現在 writes 裡。
    expect(result.writes).toEqual(
      expect.arrayContaining([{ id: "a", parentId: "b", order: 1 }])
    );
    // 舊父層(root)剩下的兄弟收斂成連續 0..n-1。
    expect(result.writes).toEqual(expect.arrayContaining([{ id: "b", parentId: "root", order: 0 }]));
  });

  it("after:跨父層移動,新舊兩邊都重新編號成連續值", () => {
    const result = resolveItemMove(items, "a", "b1", "after");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toEqual(
      expect.arrayContaining([
        { id: "a", parentId: "b", order: 1 },
        { id: "b", parentId: "root", order: 0 },
      ])
    );
  });

  it("outdent:變成目標父項的同層項目,緊接在目標的舊父項後面", () => {
    const result = resolveItemMove(items, "a", "b1", "outdent");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // b1 的父項是 b,b 的父項是 root —— a 應該變成 root 底下、緊接在 b 後面。
    expect(result.writes).toEqual(expect.arrayContaining([{ id: "a", parentId: "root", order: 1 }]));
  });

  it("同一父層內重新排序(由前往後拖):不會留下不連續的 order", () => {
    const siblings: MoveItemLike[] = [
      { id: "p", parentId: null, order: 0 },
      { id: "c1", parentId: "p", order: 0 },
      { id: "c2", parentId: "p", order: 1 },
      { id: "c3", parentId: "p", order: 2 },
    ];
    // 把 c1 拖到 c3 後面。
    const result = resolveItemMove(siblings, "c1", "c3", "after");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.writes.map((w) => [w.id, w]));
    expect(byId.get("c2")).toEqual({ id: "c2", parentId: "p", order: 0 });
    expect(byId.get("c3")).toEqual({ id: "c3", parentId: "p", order: 1 });
    expect(byId.get("c1")).toEqual({ id: "c1", parentId: "p", order: 2 });
  });

  it("同一父層內重新排序(由後往前拖):不會留下不連續的 order", () => {
    const siblings: MoveItemLike[] = [
      { id: "p", parentId: null, order: 0 },
      { id: "c1", parentId: "p", order: 0 },
      { id: "c2", parentId: "p", order: 1 },
      { id: "c3", parentId: "p", order: 2 },
    ];
    // 把 c3 拖到 c1 後面 —— 跟上一個測試方向相反,確認往回拖也不會算錯。
    // c1 沒有變化,正確地不會出現在 writes 裡(no-op 被濾掉)。
    const result = resolveItemMove(siblings, "c3", "c1", "after");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toEqual(
      expect.arrayContaining([
        { id: "c3", parentId: "p", order: 1 },
        { id: "c2", parentId: "p", order: 2 },
      ])
    );
    expect(result.writes.find((w) => w.id === "c1")).toBeUndefined();
  });

  it("拖到已經是最後一個子項的自己身上(緊接在自己前一個兄弟後面):不產生多餘寫入", () => {
    const siblings: MoveItemLike[] = [
      { id: "p", parentId: null, order: 0 },
      { id: "c1", parentId: "p", order: 0 },
      { id: "c2", parentId: "p", order: 1 },
    ];
    const result = resolveItemMove(siblings, "c2", "c1", "after");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.writes).toEqual([]);
  });
});

describe("previewDrop", () => {
  // 1 根
  // ├─ 1.1 甲
  // └─ 1.2 乙
  //    └─ 1.2.1 乙之子
  const items = [
    { id: "root", parentId: null, order: 0, name: "根" },
    { id: "a", parentId: "root", order: 0, name: "甲" },
    { id: "b", parentId: "root", order: 1, name: "乙" },
    { id: "b1", parentId: "b", order: 0, name: "乙之子" },
  ];

  it("child:算出放進去之後的新編號,並說明成為誰的子項", () => {
    // 甲拖進乙 —— 甲離開之後乙往前補成 1.1,甲排在乙現有子項後面是 1.1.2。
    const preview = previewDrop(items, "a", "b", "child");
    expect(preview?.newCode).toBe("1.1.2");
    expect(preview?.label).toBe("1.1.2 · 成為「1.1 乙」的子項");
  });

  it("after:同一層重新排序,編號跟著位置變", () => {
    const preview = previewDrop(items, "a", "b", "after");
    expect(preview?.newCode).toBe("1.2");
    expect(preview?.label).toBe("1.2 · 與「1.1 乙」同階");
  });

  it("outdent:外移一層,說明跟目標的父項同階", () => {
    const preview = previewDrop(items, "a", "b1", "outdent");
    expect(preview?.newCode).toBe("1.2");
    expect(preview?.label).toBe("1.2 · 外移一層,與「1.1 乙」同階");
  });

  it("位置沒變就直接說位置不變", () => {
    const preview = previewDrop(items, "b", "a", "after");
    expect(preview?.newCode).toBe("1.2");
    expect(preview?.label).toBe("位置不變(1.2)");
  });

  it("不能放的情況回傳 null", () => {
    expect(previewDrop(items, "a", "a", "child")).toBeNull();
    expect(previewDrop(items, "b", "b1", "child")).toBeNull();
    expect(previewDrop(items, "a", "root", "outdent")).toBeNull();
  });
});

describe("resolveItemMove 的 before 區域與無效區域", () => {
  const items: MoveItemLike[] = [
    { id: "p", parentId: null, order: 0 },
    { id: "c1", parentId: "p", order: 0 },
    { id: "c2", parentId: "p", order: 1 },
    { id: "c3", parentId: "p", order: 2 },
  ];

  it("before:放在目標前面", () => {
    const result = resolveItemMove(items, "c3", "c1", "before");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const orders = new Map(result.writes.map((w) => [w.id, w.order]));
    // c3 排到最前面,c1、c2 各往後一格。
    expect(orders.get("c3")).toBe(0);
    expect(orders.get("c1")).toBe(1);
    expect(orders.get("c2")).toBe(2);
  });

  it("before:放在目標前面但目標前面本來就是自己,位置不變", () => {
    const result = resolveItemMove(items, "c1", "c2", "before");
    expect(result).toEqual({ ok: true, writes: [] });
  });

  it("沒見過的區域字串被拒絕,不會被當成外移亂搬", () => {
    const result = resolveItemMove(items, "c1", "c3", "sideways" as unknown as DropZone);
    expect(result).toEqual({ ok: false, reason: "invalid-zone" });
  });
});

describe("buildMoveInverse:搬過去再搬回來,位置完全回到原樣", () => {
  // 1 根
  // ├─ 1.1 a
  // │   ├─ 1.1.1 a1
  // │   └─ 1.1.2 a2
  // ├─ 1.2 b
  // └─ 1.3 c
  //     └─ 1.3.1 c1   ← 獨生子
  const original: MoveItemLike[] = [
    { id: "root", parentId: null, order: 0 },
    { id: "a", parentId: "root", order: 0 },
    { id: "a1", parentId: "a", order: 0 },
    { id: "a2", parentId: "a", order: 1 },
    { id: "b", parentId: "root", order: 1 },
    { id: "c", parentId: "root", order: 2 },
    { id: "c1", parentId: "c", order: 0 },
  ];

  function apply(items: MoveItemLike[], writes: { id: string; parentId: string | null; order: number }[]) {
    const byId = new Map(writes.map((w) => [w.id, w]));
    return items.map((i) => {
      const w = byId.get(i.id);
      return w ? { ...i, parentId: w.parentId, order: w.order } : i;
    });
  }

  const key = (items: MoveItemLike[]) =>
    [...items].sort((x, y) => x.id.localeCompare(y.id)).map((i) => `${i.id}:${i.parentId}:${i.order}`);

  const cases: [string, string, string, DropZone][] = [
    ["第一個兄弟搬到最後面", "a1", "a2", "after"],
    ["中間搬到第一個前面", "b", "a", "after"],
    ["最後一個搬進別人底下變子項", "c", "a", "child"],
    ["第一個子項外移一層", "a1", "a2", "outdent"],
    ["獨生子搬到別的父項底下", "c1", "b", "child"],
    ["獨生子外移", "c1", "c", "after"],
    ["跨父層搬到另一個父項的子項後面", "a2", "c1", "after"],
  ];

  it.each(cases)("%s", (_name, draggedId, targetId, zone) => {
    const forward = resolveItemMove(original, draggedId, targetId, zone);
    expect(forward.ok).toBe(true);
    if (!forward.ok) return;
    const moved = apply(original, forward.writes);

    const inverse = buildMoveInverse(original, draggedId);
    expect(inverse).not.toBeNull();
    const back = resolveItemMove(moved, draggedId, inverse!.targetId, inverse!.zone);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(key(apply(moved, back.writes))).toEqual(key(original));
  });

  it("最上層唯一的項目沒地方可搬,也沒有反向動作", () => {
    expect(buildMoveInverse([{ id: "only", parentId: null, order: 0 }], "only")).toBeNull();
  });

  it("有下一個兄弟 → 放它前面;最後一個 → 放上一個後面;獨生子 → 回父項底下", () => {
    expect(buildMoveInverse(original, "a")).toEqual({ targetId: "b", zone: "before" });
    expect(buildMoveInverse(original, "c")).toEqual({ targetId: "b", zone: "after" });
    expect(buildMoveInverse(original, "c1")).toEqual({ targetId: "c", zone: "child" });
  });
});

describe("computeLvlDelta", () => {
  it("新父層有數字 Lvl 值:新 Lvl 是父層 Lvl+1", () => {
    // 原本 Lvl 3,新父層 Lvl 1 -> 新 Lvl 2,差值 -1。
    expect(computeLvlDelta(3, 1)).toBe(-1);
  });

  it("變成最上層:新 Lvl 是 1", () => {
    expect(computeLvlDelta(3, null)).toBe(-2);
  });

  it("差值為零時回傳 0", () => {
    expect(computeLvlDelta(2, 1)).toBe(0);
  });
});

describe("升階 / 降階", () => {
  // 1 root
  // ├─ 1.1 a
  // │  └─ 1.1.1 a1
  // ├─ 1.2 b
  // └─ 1.3 c
  // 2 other
  const tree: MoveItemLike[] = [
    { id: "root", parentId: null, order: 0 },
    { id: "a", parentId: "root", order: 0 },
    { id: "a1", parentId: "a", order: 0 },
    { id: "b", parentId: "root", order: 1 },
    { id: "c", parentId: "root", order: 2 },
    { id: "other", parentId: null, order: 1 },
  ];
  const apply = (items: MoveItemLike[], writes: { id: string; parentId: string | null; order: number }[]) => {
    const byId = new Map(writes.map((w) => [w.id, w]));
    return items.map((i) => (byId.has(i.id) ? { ...i, ...byId.get(i.id)! } : i));
  };
  const move = (items: MoveItemLike[], id: string, t: { targetId: string; zone: DropZone } | null) => {
    expect(t).not.toBeNull();
    const r = resolveItemMove(items, id, t!.targetId, t!.zone);
    expect(r.ok).toBe(true);
    return r.ok ? apply(items, r.writes) : items;
  };
  const pos = (items: MoveItemLike[], id: string) => {
    const i = items.find((x) => x.id === id)!;
    return { parentId: i.parentId, order: i.order };
  };

  it("上移 / 下移:跟同層的前一個 / 後一個對調,子樹跟著走,階層不變", () => {
    expect(moveUpTarget(tree, "b")).toEqual({ targetId: "a", zone: "before" });
    const up = move(tree, "b", moveUpTarget(tree, "b"));
    expect(pos(up, "b")).toEqual({ parentId: "root", order: 0 });
    expect(pos(up, "a")).toEqual({ parentId: "root", order: 1 });
    expect(pos(up, "a1")).toEqual({ parentId: "a", order: 0 });

    expect(moveDownTarget(tree, "a")).toEqual({ targetId: "b", zone: "after" });
    const down = move(tree, "a", moveDownTarget(tree, "a"));
    expect(pos(down, "b")).toEqual({ parentId: "root", order: 0 });
    expect(pos(down, "a")).toEqual({ parentId: "root", order: 1 });
    expect(pos(down, "c")).toEqual({ parentId: "root", order: 2 });
    expect(pos(down, "a1")).toEqual({ parentId: "a", order: 0 });
  });

  it("同層第一個不能上移、最後一個不能下移;獨生子兩個都不行", () => {
    expect(moveUpTarget(tree, "a")).toBeNull();
    expect(moveDownTarget(tree, "c")).toBeNull();
    expect(moveUpTarget(tree, "a1")).toBeNull();
    expect(moveDownTarget(tree, "a1")).toBeNull();
    expect(moveUpTarget(tree, "other")).toEqual({ targetId: "root", zone: "before" });
    expect(moveDownTarget(tree, "nope")).toBeNull();
  });

  it("降階:變成前一個同層項目的最後一個子項", () => {
    expect(indentTarget(tree, "b")).toEqual({ targetId: "a", zone: "child" });
    const after = move(tree, "b", indentTarget(tree, "b"));
    expect(pos(after, "b")).toEqual({ parentId: "a", order: 1 });
    // 原本的子項不動,舊父層的兄弟重新編號成連續的。
    expect(pos(after, "a1")).toEqual({ parentId: "a", order: 0 });
    expect(pos(after, "c")).toEqual({ parentId: "root", order: 1 });
  });

  it("第一個同層項目不能降階(前面沒有誰可以當父項),最上層第一個也一樣", () => {
    expect(indentTarget(tree, "a")).toBeNull();
    expect(indentTarget(tree, "root")).toBeNull();
    expect(indentTarget(tree, "a1")).toBeNull();
  });

  it("降階時整棵子樹跟著走", () => {
    const after = move(tree, "other", indentTarget(tree, "other"));
    expect(pos(after, "other")).toEqual({ parentId: "root", order: 3 });
    const withKid = [...tree, { id: "k", parentId: "other", order: 0 }];
    const moved = move(withKid, "other", indentTarget(withKid, "other"));
    expect(pos(moved, "k")).toEqual({ parentId: "other", order: 0 });
  });

  it("升階:變成父項的同層項目,緊接在父項後面;原本排在它後面的兄弟(c)變成它的子項", () => {
    expect(outdentTarget(tree, "b")).toEqual({ targetId: "root", zone: "afterAdopt" });
    const after = move(tree, "b", outdentTarget(tree, "b"));
    expect(pos(after, "b")).toEqual({ parentId: null, order: 1 });
    expect(pos(after, "other")).toEqual({ parentId: null, order: 2 });
    expect(pos(after, "c")).toEqual({ parentId: "b", order: 0 });
    // 在它前面的兄弟(a)不動。
    expect(pos(after, "a")).toEqual({ parentId: "root", order: 0 });
  });

  it("升階後再降階,位置關係(父項與兄弟順序)回到原樣——只要它是最後一個子項", () => {
    const after = move(tree, "c", outdentTarget(tree, "c"));
    const back = move(after, "c", indentTarget(after, "c"));
    expect(pos(back, "c")).toEqual(pos(tree, "c"));
  });

  it("最上層不能升階;找不到的項目兩邊都是 null", () => {
    expect(outdentTarget(tree, "root")).toBeNull();
    expect(outdentTarget(tree, "nope")).toBeNull();
    expect(indentTarget(tree, "nope")).toBeNull();
  });
});

describe("升階接管下面的同層項目", () => {
  // 1 root
  // ├─ 1.1 p
  // │  ├─ 1.1.1 x1
  // │  ├─ 1.1.2 x2
  // │  ├─ 1.1.3 x3     ← 升階這一個
  // │  ├─ 1.1.4 x4
  // │  │  └─ 1.1.4.1 z
  // │  └─ 1.1.5 x5
  // └─ 1.2 q
  const items: MoveItemLike[] = [
    { id: "root", parentId: null, order: 0 },
    { id: "p", parentId: "root", order: 0 },
    { id: "x1", parentId: "p", order: 0 },
    { id: "x2", parentId: "p", order: 1 },
    { id: "x3", parentId: "p", order: 2 },
    { id: "x4", parentId: "p", order: 3 },
    { id: "z", parentId: "x4", order: 0 },
    { id: "x5", parentId: "p", order: 4 },
    { id: "q", parentId: "root", order: 1 },
  ];
  const run = (list: MoveItemLike[], id: string, targetId: string, zone: DropZone, releaseCount?: number) => {
    const r = resolveItemMove(list, id, targetId, zone, { releaseCount });
    expect(r.ok).toBe(true);
    const byId = new Map((r.ok ? r.writes : []).map((w) => [w.id, w]));
    return list.map((i) => (byId.has(i.id) ? { ...i, ...byId.get(i.id)! } : i));
  };
  const codes = (list: MoveItemLike[]) => Object.fromEntries(computeWbsCodes(list));
  /** 整份清單從上到下的順序(深度優先)。 */
  const flat = (list: MoveItemLike[]) => {
    const out: string[] = [];
    const walk = (parentId: string | null) =>
      list
        .filter((i) => i.parentId === parentId)
        .sort((a, b) => a.order - b.order)
        .forEach((i) => {
          out.push(i.id);
          walk(i.id);
        });
    walk(null);
    return out;
  };
  const positions = (list: MoveItemLike[]) => Object.fromEntries(list.map((i) => [i.id, `${i.parentId}/${i.order}`]));

  it("1.1.3 升階:變成 1.2,原本的 1.1.4、1.1.5 變成它的 1.2.1、1.2.2(子樹跟著走),原本的 1.2 往後變 1.3", () => {
    const t = outdentTarget(items, "x3")!;
    const after = run(items, "x3", t.targetId, t.zone);
    const c = codes(after);
    expect(c.x1).toBe("1.1.1");
    expect(c.x2).toBe("1.1.2");
    expect(c.x3).toBe("1.2");
    expect(c.x4).toBe("1.2.1");
    expect(c.z).toBe("1.2.1.1");
    expect(c.x5).toBe("1.2.2");
    expect(c.q).toBe("1.3");
  });

  it("清單上的位置不動,只有階層變了(以前的做法會讓它掉到原本下面那幾個的後面)", () => {
    const t = outdentTarget(items, "x3")!;
    expect(flat(run(items, "x3", t.targetId, t.zone))).toEqual(flat(items));
  });

  it("它自己已經有子項:接管來的接在它原本的子項後面", () => {
    const withKid = [...items, { id: "y", parentId: "x3", order: 0 }];
    const t = outdentTarget(withKid, "x3")!;
    const c = codes(run(withKid, "x3", t.targetId, t.zone));
    expect(c.y).toBe("1.2.1");
    expect(c.x4).toBe("1.2.2");
    expect(c.x5).toBe("1.2.3");
  });

  it("排最後一個的升階:沒有人可以接管,跟以前一樣緊接在父項後面", () => {
    const t = outdentTarget(items, "x5")!;
    const after = run(items, "x5", t.targetId, t.zone);
    expect(codes(after).x5).toBe("1.2");
    expect(codes(after).q).toBe("1.3");
    expect(flat(after)).toEqual(flat(items));
    expect(countAdoptedBy(items, "x5")).toBe(0);
  });

  it("接管幾個:排在後面的同層項目", () => {
    expect(countAdoptedBy(items, "x3")).toBe(2);
    expect(countAdoptedBy(items, "x1")).toBe(4);
    expect(countAdoptedBy(items, "nope")).toBe(0);
  });

  it("降階:1.1.3 降階變成 1.1.2.1,下面的 1.1.4 變成 1.1.3(沒有變動)", () => {
    const t = indentTarget(items, "x3")!;
    const c = codes(run(items, "x3", t.targetId, t.zone));
    expect(c.x3).toBe("1.1.2.1");
    expect(c.x4).toBe("1.1.3");
    expect(c.x5).toBe("1.1.4");
  });

  it("還原升階(childRelease):父項、順序,連同被接管的兄弟,全部回到原樣", () => {
    const t = outdentTarget(items, "x3")!;
    const after = run(items, "x3", t.targetId, t.zone);
    const back = run(after, "x3", "p", "childRelease", countAdoptedBy(items, "x3"));
    expect(positions(back)).toEqual(positions(items));
    // 它自己原本就有子項的話,放回去的只有接管來的那幾個。
    const withKid = [...items, { id: "y", parentId: "x3", order: 0 }];
    const afterKid = run(withKid, "x3", "p", "afterAdopt");
    expect(positions(run(afterKid, "x3", "p", "childRelease", countAdoptedBy(withKid, "x3")))).toEqual(positions(withKid));
  });

  it("還原升階的 releaseCount 不合理(比子項還多、負數、不是整數)、目標不是同一層:拒絕", () => {
    const after = run(items, "x3", "p", "afterAdopt");
    for (const count of [99, -1, 1.5]) {
      expect(resolveItemMove(after, "x3", "p", "childRelease", { releaseCount: count })).toEqual({ ok: false, reason: "invalid-zone" });
    }
    expect(resolveItemMove(after, "x3", "x1", "childRelease", { releaseCount: 1 })).toEqual({ ok: false, reason: "invalid-zone" });
  });

  it("afterAdopt 的目標不是它的父項:拒絕(這個按鈕不會產生這種呼叫)", () => {
    expect(resolveItemMove(items, "x3", "root", "afterAdopt")).toEqual({ ok: false, reason: "invalid-zone" });
    expect(resolveItemMove(items, "x3", "x1", "afterAdopt")).toEqual({ ok: false, reason: "invalid-zone" });
  });

  it("拖曳往左拖的 outdent 不接管兄弟(那是使用者自己指定放哪)", () => {
    const after = run(items, "x3", "x4", "outdent");
    expect(codes(after).x4).toBe("1.1.3");
    expect(codes(after).x5).toBe("1.1.4");
    expect(codes(after).x3).toBe("1.2");
  });
});

describe("parentAfterMove", () => {
  it("搬到最上層時是 null,不能退回舊父項(那會讓 Lvl 與 Summary 連動被跳過)", () => {
    expect(parentAfterMove([{ id: "x", parentId: null, order: 1 }], "x", "p")).toBeNull();
  });

  it("換了父項就是新的父項;這次搬移沒有動到它就是原本的", () => {
    expect(parentAfterMove([{ id: "x", parentId: "q", order: 0 }], "x", "p")).toBe("q");
    expect(parentAfterMove([{ id: "other", parentId: "q", order: 0 }], "x", "p")).toBe("p");
    expect(parentAfterMove([], "x", null)).toBeNull();
  });

  it("用真的升階算出來的寫入:升到最上層後父項是 null", () => {
    const tree: MoveItemLike[] = [
      { id: "root", parentId: null, order: 0 },
      { id: "kid", parentId: "root", order: 0 },
    ];
    const move = outdentTarget(tree, "kid")!;
    const r = resolveItemMove(tree, "kid", move.targetId, move.zone);
    expect(r.ok).toBe(true);
    if (r.ok) expect(parentAfterMove(r.writes, "kid", "root")).toBeNull();
  });
});
