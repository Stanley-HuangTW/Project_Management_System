import { describe, expect, it } from "vitest";
import { computeVisibleItemIds, itemMatchesSearch, TODAY_FILTER_VALUE } from "./filter";
import type { ItemData } from "@/types/board";

const FINISH = "finishCol";

function item(id: string, finish: string): ItemData {
  return {
    id,
    name: id,
    parentId: null,
    order: 0,
    groupId: "g1",
    boardId: "b1",
    createdAt: new Date(),
    createdById: null,
    cellValues: [{ id: `${id}-f`, itemId: id, columnId: FINISH, value: finish }],
    _count: { comments: 0 },
    assignments: [],
  } as unknown as ItemData;
}

function isoOffsetDays(days: number): string {
  const d = new Date(new Date().toISOString().slice(0, 10));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("date filters bound to 今天", () => {
  const items = [item("overdue", isoOffsetDays(-3)), item("today", isoOffsetDays(0)), item("later", isoOffsetDays(5))];

  it("「~今天」keeps everything due today or earlier — the overdue list", () => {
    const visible = computeVisibleItemIds(items, [
      { columnId: FINISH, value: { kind: "date", from: null, to: TODAY_FILTER_VALUE } },
    ]);
    expect([...visible!].sort()).toEqual(["overdue", "today"]);
  });

  it("「今天~」keeps what is still ahead", () => {
    const visible = computeVisibleItemIds(items, [
      { columnId: FINISH, value: { kind: "date", from: TODAY_FILTER_VALUE, to: null } },
    ]);
    expect([...visible!].sort()).toEqual(["later", "today"]);
  });

  it("still honours a fixed date on the other end", () => {
    const visible = computeVisibleItemIds(items, [
      { columnId: FINISH, value: { kind: "date", from: isoOffsetDays(-1), to: TODAY_FILTER_VALUE } },
    ]);
    expect([...visible!]).toEqual(["today"]);
  });
});

describe("搜尋:項目名稱或項目編號(WBS)", () => {
  // 1 Phase / 1.1 A / 1.2 B / 1.2.1 C / 2 Other;另一個分組也有自己的 1
  const node = (id: string, name: string, parentId: string | null, order: number, groupId = "g1") =>
    ({ ...item(id, "2026-01-01"), name, parentId, order, groupId }) as ItemData;
  const items = [
    node("p", "Phase", null, 0),
    node("a", "Alpha", "p", 0),
    node("b", "Beta", "p", 1),
    node("c", "Gamma", "b", 0),
    node("o", "Other", null, 1),
    node("x", "Xray", null, 0, "g2"),
  ];

  it("打編號找得到那一項,它的上層一起留著", () => {
    expect([...computeVisibleItemIds(items, [], "1.2.1")!].sort()).toEqual(["b", "c", "p"]);
  });
  it("上層的編號會連它底下的都找出來", () => {
    expect([...computeVisibleItemIds(items, [], "1.2")!].sort()).toEqual(["b", "c", "p"]);
    expect([...computeVisibleItemIds(items, [], "1.")!].sort()).toEqual(["a", "b", "c", "p", "x"]);
  });
  it("名稱照舊找得到", () => {
    expect([...computeVisibleItemIds(items, [], "gam")!].sort()).toEqual(["b", "c", "p"]);
  });
  it("編號各分組各自算(g2 的 Xray 也是 1)", () => {
    expect([...computeVisibleItemIds(items, [], "1")!].sort()).toEqual(["a", "b", "c", "p", "x"]);
  });
  it("itemMatchesSearch:1.9 不會撈進 1.90", () => {
    expect(itemMatchesSearch("x", "1.9.3", "1.9")).toBe(true);
    expect(itemMatchesSearch("x", "1.90", "1.9")).toBe(false);
    expect(itemMatchesSearch("x", "1.9", "")).toBe(true);
    expect(itemMatchesSearch("名稱 2.1", "5", "2.1")).toBe(true);
  });
});
