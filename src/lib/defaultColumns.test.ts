import { describe, expect, it } from "vitest";
import { parseDefaultColumns, BUILT_IN_DEFAULT_COLUMNS } from "./defaultColumns";

describe("parseDefaultColumns", () => {
  it("keeps a saved list, in order", () => {
    const saved = [
      { name: "Lvl", type: "NUMBER", options: {} },
      { name: "負責人", type: "PERSON", options: {} },
      { name: "Status", type: "STATUS", options: { statuses: [{ id: "s1", label: "Planned" }] } },
    ];
    const parsed = parseDefaultColumns(saved);

    expect(parsed.map((c) => c.name)).toEqual(["Lvl", "負責人", "Status"]);
    expect(parsed[2].options).toEqual({ statuses: [{ id: "s1", label: "Planned" }] });
  });

  it("falls back to the built-in list rather than creating a board with no columns", () => {
    // Anything a hand-edited row or an older version could leave behind.
    for (const bad of [null, undefined, {}, [], "Lvl,Type", [null], [{ name: "" }]]) {
      expect(parseDefaultColumns(bad)).toEqual(BUILT_IN_DEFAULT_COLUMNS);
    }
  });

  it("drops entries it cannot use instead of taking the whole list down", () => {
    const parsed = parseDefaultColumns([
      { name: "Lvl", type: "NUMBER", options: {} },
      { name: "壞掉的", type: "NOT_A_TYPE", options: {} },
      { name: "   ", type: "TEXT", options: {} },
      { name: "Start", type: "DATE", options: {} },
    ]);
    expect(parsed.map((c) => c.name)).toEqual(["Lvl", "Start"]);
  });

  it("refuses a duplicate name — createBoard wires its settings up by name", () => {
    const parsed = parseDefaultColumns([
      { name: "Start", type: "DATE", options: {} },
      { name: "start", type: "TEXT", options: {} },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("DATE");
  });

  it("normalises a missing or non-object options to {}", () => {
    const parsed = parseDefaultColumns([{ name: "Comment", type: "TEXT" }]);
    expect(parsed[0].options).toEqual({});
  });
});
