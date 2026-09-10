import { describe, expect, it } from "vitest";
import { buildTemplateContent, parseTemplateContent } from "./projectTemplate";

const columns = [
  { id: "type", name: "Type", type: "STATUS" },
  { id: "dur", name: "duration", type: "NUMBER" },
  { id: "owner", name: "負責人", type: "PERSON" },
];

function item(id: string, name: string, parentId: string | null, order: number, cells: Record<string, string | number> = {}) {
  return {
    id,
    name,
    parentId,
    order,
    cellValues: Object.entries(cells).map(([columnId, value]) => ({ columnId, value })),
  };
}

describe("buildTemplateContent", () => {
  const items = [
    item("child2", "產出報告", "phase", 1, { dur: 3, owner: "u1" }),
    item("phase", "POC Phase", null, 0, { type: "summary" }),
    item("child1", "規格確認", "phase", 0, { dur: 5 }),
  ];

  it("puts parents before children and keeps sibling order", () => {
    const content = buildTemplateContent(items, columns, new Map(), new Set());
    expect(content.items.map((i) => i.name)).toEqual(["POC Phase", "規格確認", "產出報告"]);
    expect(content.items.map((i) => i.parentIndex)).toEqual([null, 0, 0]);
  });

  it("records cells by column name and drops the excluded ones", () => {
    const content = buildTemplateContent(items, columns, new Map(), new Set(["owner"]));
    expect(content.items[1].cells).toEqual([{ columnName: "duration", columnType: "NUMBER", value: 5 }]);
    expect(content.items[2].cells).toEqual([{ columnName: "duration", columnType: "NUMBER", value: 3 }]);
  });

  it("turns dependencies into positions within the template", () => {
    const preds = new Map([["child2", ["child1"]]]);
    const content = buildTemplateContent(items, columns, preds, new Set());
    expect(content.items[2].predIndexes).toEqual([1]);
  });

  it("drops a dependency on something outside the captured group", () => {
    const preds = new Map([["child2", ["child1", "somewhere-else"]]]);
    const content = buildTemplateContent(items, columns, preds, new Set());
    expect(content.items[2].predIndexes).toEqual([1]);
  });

  it("keeps an item whose parent was not captured, at the top level", () => {
    const orphan = [item("x", "孤兒", "missing-parent", 0)];
    const content = buildTemplateContent(orphan, columns, new Map(), new Set());
    expect(content.items).toEqual([{ name: "孤兒", parentIndex: null, cells: [], predIndexes: [] }]);
  });
});

describe("parseTemplateContent", () => {
  it("round-trips what buildTemplateContent produced", () => {
    const content = buildTemplateContent(
      [item("a", "A", null, 0, { dur: 2 }), item("b", "B", "a", 0)],
      columns,
      new Map([["b", ["a"]]]),
      new Set()
    );
    expect(parseTemplateContent(content)).toEqual(content);
  });

  it("drops rows and references that do not make sense", () => {
    const parsed = parseTemplateContent({
      items: [
        { name: "ok", parentIndex: 99, cells: [{ columnName: "x" }], predIndexes: [5, 0] },
        { parentIndex: 0 },
      ],
    });
    expect(parsed.items).toEqual([{ name: "ok", parentIndex: null, cells: [], predIndexes: [0] }]);
  });

  it("treats junk as an empty template", () => {
    expect(parseTemplateContent(null)).toEqual({ items: [] });
    expect(parseTemplateContent({ items: "no" })).toEqual({ items: [] });
  });
});
