import { describe, expect, it } from "vitest";
import { classifyDropZone, computeLvlDelta, previewDrop, resolveItemMove, type MoveItemLike } from "./dragReorder";

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
