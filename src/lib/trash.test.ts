import { describe, expect, it } from "vitest";
import { collectSubtreeIds, parsePredSnapshot } from "./trash";

const items = [
  { id: "a", parentId: null },
  { id: "a1", parentId: "a" },
  { id: "a1x", parentId: "a1" },
  { id: "a2", parentId: "a" },
  { id: "b", parentId: null },
  { id: "b1", parentId: "b" },
];

describe("collectSubtreeIds", () => {
  it("returns the root alone when it has no children", () => {
    expect(collectSubtreeIds(items, "a1x")).toEqual(["a1x"]);
  });

  it("collects children and grandchildren", () => {
    expect(collectSubtreeIds(items, "a").sort()).toEqual(["a", "a1", "a1x", "a2"]);
  });

  it("leaves other branches alone", () => {
    expect(collectSubtreeIds(items, "b").sort()).toEqual(["b", "b1"]);
  });

  it("does not hang on a parent cycle", () => {
    const looped = [
      { id: "x", parentId: "y" },
      { id: "y", parentId: "x" },
    ];
    expect(collectSubtreeIds(looped, "x").sort()).toEqual(["x", "y"]);
  });
});

describe("parsePredSnapshot", () => {
  it("keeps well-formed entries, including cleared cells", () => {
    expect(parsePredSnapshot([{ itemId: "a", columnId: "c", value: "b" }, { itemId: "d", columnId: "c", value: null }])).toEqual([
      { itemId: "a", columnId: "c", value: "b" },
      { itemId: "d", columnId: "c", value: null },
    ]);
  });

  it("drops anything that is not a snapshot entry", () => {
    expect(parsePredSnapshot([{ itemId: "a" }, "x", null, { itemId: 1, columnId: "c", value: "b" }])).toEqual([]);
  });

  it("treats a missing snapshot as nothing to restore", () => {
    expect(parsePredSnapshot(null)).toEqual([]);
    expect(parsePredSnapshot(undefined)).toEqual([]);
  });
});
