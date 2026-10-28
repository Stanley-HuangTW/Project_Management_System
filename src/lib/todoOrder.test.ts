import { describe, expect, it } from "vitest";
import { mergeTodoOrder } from "./todoOrder";

describe("mergeTodoOrder", () => {
  it("uses the requested order when it covers every todo", () => {
    expect(mergeTodoOrder(["a", "b", "c"], ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("keeps todos the screen did not know about at the end, in their current order", () => {
    expect(mergeTodoOrder(["a", "b", "c", "d"], ["b", "a"])).toEqual(["b", "a", "c", "d"]);
  });

  it("ignores ids that no longer exist (deleted meanwhile)", () => {
    expect(mergeTodoOrder(["a", "b"], ["x", "b", "a"])).toEqual(["b", "a"]);
  });

  it("counts a repeated id only once", () => {
    expect(mergeTodoOrder(["a", "b", "c"], ["b", "b", "a", "c"])).toEqual(["b", "a", "c"]);
  });

  it("returns the current order when nothing valid is requested", () => {
    expect(mergeTodoOrder(["a", "b"], [])).toEqual(["a", "b"]);
    expect(mergeTodoOrder([], ["a"])).toEqual([]);
  });
});
