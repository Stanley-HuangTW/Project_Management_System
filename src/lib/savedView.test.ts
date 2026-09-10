import { describe, expect, it } from "vitest";
import { parseViewConfig, isEmptyViewConfig, EMPTY_VIEW_CONFIG } from "./savedView";
import { TODAY_FILTER_VALUE } from "./filter";

describe("parseViewConfig", () => {
  it("reads back a view with every filter kind", () => {
    const config = {
      filters: [
        { columnId: "a", value: { kind: "status", selected: ["s1", "s2"] } },
        { columnId: "b", value: { kind: "person", selected: ["u1"] } },
        { columnId: "c", value: { kind: "number", min: 1, max: null } },
        { columnId: "d", value: { kind: "date", from: null, to: TODAY_FILTER_VALUE } },
        { columnId: "e", value: { kind: "text", query: "板" } },
      ],
      groupFilterId: "g1",
      searchQuery: "MCU",
    };
    expect(parseViewConfig(config)).toEqual(config);
  });

  it("drops a filter whose value is not one of the known kinds", () => {
    const parsed = parseViewConfig({
      filters: [
        { columnId: "a", value: { kind: "colour", selected: ["red"] } },
        { columnId: "b", value: { kind: "text", query: "x" } },
      ],
    });
    expect(parsed.filters).toEqual([{ columnId: "b", value: { kind: "text", query: "x" } }]);
  });

  it("drops a filter with no column instead of throwing", () => {
    expect(parseViewConfig({ filters: [{ value: { kind: "text", query: "x" } }] }).filters).toEqual([]);
  });

  it("treats junk as an empty view", () => {
    expect(parseViewConfig(null)).toEqual(EMPTY_VIEW_CONFIG);
    expect(parseViewConfig("nope")).toEqual(EMPTY_VIEW_CONFIG);
    expect(parseViewConfig({ filters: "nope", groupFilterId: 7 })).toEqual(EMPTY_VIEW_CONFIG);
  });
});

describe("isEmptyViewConfig", () => {
  it("is empty when nothing is filtered", () => {
    expect(isEmptyViewConfig(EMPTY_VIEW_CONFIG)).toBe(true);
    expect(isEmptyViewConfig({ filters: [], groupFilterId: "", searchQuery: "   " })).toBe(true);
  });

  it("is not empty once a group or a search is set", () => {
    expect(isEmptyViewConfig({ filters: [], groupFilterId: "g1", searchQuery: "" })).toBe(false);
    expect(isEmptyViewConfig({ filters: [], groupFilterId: "", searchQuery: "MCU" })).toBe(false);
  });
});
