import { describe, expect, it } from "vitest";
import { computeVisibleItemIds, TODAY_FILTER_VALUE } from "./filter";
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
