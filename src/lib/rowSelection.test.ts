import { describe, expect, it } from "vitest";
import { toggleRowSelection } from "@/lib/rowSelection";

// 1 ─ 1.1 ─ 1.1.1
//   └ 1.2
// 2
const node = (id: string, parentId: string | null, order: number) => ({ id, parentId, order, groupId: "g" });
const items = [node("1", null, 0), node("1.1", "1", 0), node("1.1.1", "1.1", 0), node("1.2", "1", 1), node("2", null, 1)];
const sorted = (s: Set<string>) => [...s].sort();

describe("toggleRowSelection", () => {
  it("展開著的父項只勾它自己", () => {
    expect(sorted(toggleRowSelection(items, new Set(), "1", true, false))).toEqual(["1"]);
  });

  it("收成一行的父項:所有子項(含更深的)一起勾", () => {
    expect(sorted(toggleRowSelection(items, new Set(), "1", true, true))).toEqual(["1", "1.1", "1.1.1", "1.2"]);
  });

  it("收成一行的父項取消勾選:整個子樹一起取消,別的勾選不動", () => {
    const selected = new Set(["1", "1.1", "1.1.1", "1.2", "2"]);
    expect(sorted(toggleRowSelection(items, selected, "1", false, true))).toEqual(["2"]);
  });

  it("展開著的父項取消勾選只取消它自己,子項勾著的不動", () => {
    const selected = new Set(["1", "1.1"]);
    expect(sorted(toggleRowSelection(items, selected, "1", false, false))).toEqual(["1.1"]);
  });

  it("收合的只有自己的葉子項(沒有子項)就是只勾自己", () => {
    expect(sorted(toggleRowSelection(items, new Set(), "2", true, true))).toEqual(["2"]);
  });

  it("不改動傳進來的集合", () => {
    const selected = new Set(["2"]);
    toggleRowSelection(items, selected, "1", true, true);
    expect(sorted(selected)).toEqual(["2"]);
  });
});
