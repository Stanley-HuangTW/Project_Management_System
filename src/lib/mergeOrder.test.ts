import { describe, expect, it } from "vitest";
import { mergeOrder } from "./mergeOrder";

describe("mergeOrder", () => {
  it("uses the requested order when it covers every todo", () => {
    expect(mergeOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("keeps todos the screen did not know about at the end, in their current order", () => {
    expect(mergeOrder(["a", "b", "c", "d"], ["b", "a"])).toEqual(["b", "a", "c", "d"]);
  });

  it("ignores ids that no longer exist (deleted meanwhile)", () => {
    expect(mergeOrder(["a", "b"], ["x", "b", "a"])).toEqual(["b", "a"]);
  });

  it("counts a repeated id only once", () => {
    expect(mergeOrder(["a", "b", "c"], ["b", "b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("returns the current order when nothing valid is requested", () => {
    expect(mergeOrder(["a", "b"], [])).toEqual(["a", "b"]);
    expect(mergeOrder([], ["a"])).toEqual([]);
  });
});
