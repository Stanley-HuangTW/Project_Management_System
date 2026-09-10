import { describe, expect, it } from "vitest";
import { summarizePredEdges, formatEdgeSuffix, describeEdgeOverrides } from "./predEdgeSummary";

const options = [
  { id: "a1", code: "1.1", name: "底盤機構設計" },
  { id: "a2", code: "1.2", name: "MCU 佈線" },
];

describe("summarizePredEdges", () => {
  it("labels each edge the way people refer to it", () => {
    expect(summarizePredEdges("a1", options)).toEqual([
      { itemId: "a1", label: "1.1 底盤機構設計", relationship: null, lag: null },
    ]);
  });

  it("reads each edge's own relationship and lag", () => {
    expect(summarizePredEdges("a1:SS-2,a2:FS+3", options)).toEqual([
      { itemId: "a1", label: "1.1 底盤機構設計", relationship: "SS", lag: -2 },
      { itemId: "a2", label: "1.2 MCU 佈線", relationship: "FS", lag: 3 },
    ]);
  });

  it("still resolves a legacy WBS code", () => {
    expect(summarizePredEdges("1.2", options)[0].itemId).toBe("a2");
  });

  it("drops a reference to something not on screen", () => {
    expect(summarizePredEdges("a1,gone", options).map((e) => e.itemId)).toEqual(["a1"]);
  });

  it("has nothing to say about an empty cell", () => {
    expect(summarizePredEdges("", options)).toEqual([]);
    expect(summarizePredEdges(null, options)).toEqual([]);
  });
});

describe("formatEdgeSuffix", () => {
  it("writes what the edge overrides, and nothing when it overrides nothing", () => {
    expect(formatEdgeSuffix({ relationship: "SS", lag: -2 })).toBe("SS-2");
    expect(formatEdgeSuffix({ relationship: "FS", lag: null })).toBe("FS");
    expect(formatEdgeSuffix({ relationship: null, lag: 3 })).toBe("+3");
    expect(formatEdgeSuffix({ relationship: null, lag: null })).toBe("");
  });
});

describe("describeEdgeOverrides", () => {
  const edges = summarizePredEdges("a1:SS-2,a2", options);

  it("names only the edges that disagree with the column", () => {
    const note = describeEdgeOverrides(edges, "lag")!;
    expect(note).toContain("1.1 底盤機構設計:-2 天");
    expect(note).not.toContain("1.2");
  });

  it("says nothing when every edge is content with the column", () => {
    expect(describeEdgeOverrides(summarizePredEdges("a1,a2", options), "lag")).toBeNull();
    expect(describeEdgeOverrides(summarizePredEdges("a1,a2", options), "relationship")).toBeNull();
  });
});
