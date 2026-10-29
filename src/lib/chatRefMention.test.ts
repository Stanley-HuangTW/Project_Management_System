import { describe, expect, it } from "vitest";
import type { RefKind } from "./chatLinks";
import { REF_MENU_LIMIT, activeRefQuery, buildRefMenu, defaultExpandedItems, inlineRefUrls, navigableRefs, splitRefs, type RefMenuRow } from "./chatRefMention";

describe("activeRefQuery", () => {
  it("finds what is typed after a # at the start", () => {
    expect(activeRefQuery("#電機", 3)).toEqual({ query: "電機", at: 0 });
  });

  it("finds a # after a space and ignores the text after the caret", () => {
    expect(activeRefQuery("請看 #外殼 打樣", 6)).toEqual({ query: "外殼", at: 3 });
  });

  it("is an empty query right after the #", () => {
    expect(activeRefQuery("看一下 #", 5)).toEqual({ query: "", at: 4 });
  });

  it("is not a reference when the # is glued to a word (url anchor, C#)", () => {
    expect(activeRefQuery("https://x.y/page#top", 20)).toBeNull();
    expect(activeRefQuery("用 C#寫", 5)).toBeNull();
  });

  it("gives up after a new line or a long run", () => {
    expect(activeRefQuery("#電機\n下一行", 7)).toBeNull();
    expect(activeRefQuery("#" + "字".repeat(31), 32)).toBeNull();
  });

  it("is null when there is no #", () => {
    expect(activeRefQuery("沒有井字", 4)).toBeNull();
  });

  it("uses the closest # to the caret", () => {
    expect(activeRefQuery("#舊的 看 #新的", 9)).toEqual({ query: "新的", at: 6 });
  });
});

const refs = {
  items: [
    { id: "a", name: "一、項目籌備", wbsCode: "1", groupName: "分組一", parentId: null, depth: 0 },
    { id: "a1", name: "產品定義", wbsCode: "1.1", groupName: "分組一", parentId: "a", depth: 1 },
    { id: "a1x", name: "市場調查", wbsCode: "1.1.1", groupName: "分組一", parentId: "a1", depth: 2 },
    { id: "b", name: "二、項目執行", wbsCode: "2", groupName: "分組一", parentId: null, depth: 0 },
    { id: "b1", name: "電機選型", wbsCode: "2.1", groupName: "分組一", parentId: "b", depth: 1 },
  ],
  risks: [
    { id: "r1", title: "供應商交期延遲", kind: "RISK" as const, mantisId: null },
    { id: "r2", title: "試產良率偏低", kind: "ISSUE" as const, mantisId: null },
    { id: "r3", title: "電池蓋鎖不緊", kind: "ISSUE" as const, mantisId: 4521 },
  ],
};

const state = (expanded: string[] = [], collapsed: RefKind[] = []) => ({ expanded: new Set(expanded), collapsedKinds: new Set<RefKind>(collapsed) });
const shape = (rows: RefMenuRow[]) => rows.map((r) => (r.type === "section" ? `§${r.kind}` : r.type === "more" ? `+${r.count}` : r.id));
const refRow = (rows: RefMenuRow[], id: string) => rows.find((r): r is Extract<RefMenuRow, { type: "ref" }> => r.type === "ref" && r.id === id)!;

describe("buildRefMenu — nothing typed yet", () => {
  it("lists four sections: work items nested by what is expanded, then risks, issues and Mantis problems", () => {
    expect(shape(buildRefMenu(refs, "", state(["a", "b"])))).toEqual(["§item", "a", "a1", "b", "b1", "§risk", "r1", "§issue", "r2", "§mantis", "r3"]);
  });

  it("shows the deeper levels once their parent is expanded", () => {
    expect(shape(buildRefMenu(refs, "", state(["a", "a1", "b"])))).toContain("a1x");
    expect(shape(buildRefMenu(refs, "", state(["a", "b"])))).not.toContain("a1x");
  });

  it("shows only the top level when nothing is expanded", () => {
    expect(shape(buildRefMenu(refs, "", state()))).toEqual(["§item", "a", "b", "§risk", "r1", "§issue", "r2", "§mantis", "r3"]);
  });

  it("collapsing a parent hides every level under it", () => {
    expect(shape(buildRefMenu(refs, "", state(["a1", "b"])))).toEqual(["§item", "a", "b", "b1", "§risk", "r1", "§issue", "r2", "§mantis", "r3"]);
  });

  it("tells the menu how deep a row is, whether it has children and whether it is open", () => {
    const rows = buildRefMenu(refs, "", state(["a"]));
    expect(refRow(rows, "a1")).toMatchObject({ depth: 1, hasChildren: true, expanded: false, muted: false });
    expect(refRow(rows, "a")).toMatchObject({ depth: 0, hasChildren: true, expanded: true });
    expect(refRow(rows, "b")).toMatchObject({ hasChildren: true, expanded: false });
    expect(refRow(rows, "r1")).toMatchObject({ depth: 0, hasChildren: false });
  });

  it("can fold a whole section away (the heading stays, with the count)", () => {
    const rows = buildRefMenu(refs, "", state(["a", "b"], ["item", "issue"]));
    expect(shape(rows)).toEqual(["§item", "§risk", "r1", "§issue", "§mantis", "r3"]);
    expect(rows[0]).toMatchObject({ type: "section", kind: "item", count: 5, collapsed: true });
  });

  it("skips a section that has nothing in it", () => {
    expect(shape(buildRefMenu({ ...refs, risks: [refs.risks[0]] }, "", state(["a", "b"])))).toEqual(["§item", "a", "a1", "b", "b1", "§risk", "r1"]);
  });

  it("splits Mantis problems from hand-written issues, and labels them with the number", () => {
    const rows = buildRefMenu(refs, "", state());
    expect(refRow(rows, "r3")).toMatchObject({ kind: "mantis", hint: "Mantis #4521" });
    expect(refRow(rows, "r2")).toMatchObject({ kind: "issue", hint: "" });
  });

  it("shows the WBS code, plus the group when the board has more than one", () => {
    expect(refRow(buildRefMenu(refs, "", state(["b"])), "b1").hint).toBe("2.1");
    const twoGroups = { ...refs, items: refs.items.map((i) => (i.id === "b1" ? { ...i, groupName: "分組二" } : i)) };
    expect(refRow(buildRefMenu(twoGroups, "", state(["b"])), "b1").hint).toBe("2.1 · 分組二");
  });
});

describe("buildRefMenu — searching", () => {
  it("keeps the matches and, in a lighter shade, the parents above them", () => {
    const rows = buildRefMenu(refs, "市場", state());
    expect(shape(rows)).toEqual(["§item", "a", "a1", "a1x"]);
    expect(rows.filter((r) => r.type === "ref").map((r) => r.type === "ref" && r.muted)).toEqual([true, true, false]);
    expect(rows[0]).toMatchObject({ type: "section", kind: "item", count: 1 });
  });

  it("ignores what is collapsed or folded away", () => {
    expect(shape(buildRefMenu(refs, "市場", state([], ["item"])))).toEqual(["§item", "a", "a1", "a1x"]);
  });

  it("finds a work item by its WBS code", () => {
    expect(shape(buildRefMenu(refs, "2.1", state()))).toEqual(["§item", "b", "b1"]);
  });

  it("finds issues and risks by title, and Mantis problems by title or number", () => {
    expect(shape(buildRefMenu(refs, "試產", state()))).toEqual(["§issue", "r2"]);
    expect(shape(buildRefMenu(refs, "供應商", state()))).toEqual(["§risk", "r1"]);
    expect(shape(buildRefMenu(refs, "4521", state()))).toEqual(["§mantis", "r3"]);
    expect(shape(buildRefMenu(refs, "電池", state()))).toEqual(["§mantis", "r3"]);
  });

  it("is case-insensitive", () => {
    const en = { ...refs, risks: [{ id: "r9", title: "Battery Cover", kind: "RISK" as const, mantisId: null }] };
    expect(shape(buildRefMenu(en, "battery", state()))).toEqual(["§risk", "r9"]);
  });

  it("closes once the name is complete and a space follows (the picked text is \"#name \")", () => {
    expect(buildRefMenu(refs, "電機選型 ", state())).toEqual([]);
  });

  it("still finds a name that has a space in it", () => {
    const spaced = { items: [{ id: "s1", name: "夾具 設計", wbsCode: "1", groupName: "g", parentId: null, depth: 0 }], risks: [] };
    expect(shape(buildRefMenu(spaced, "夾具 ", state()))).toEqual(["§item", "s1"]);
  });

  it("lists nothing for a query that is only spaces, or that matches nothing", () => {
    expect(buildRefMenu(refs, " ", state())).toEqual([]);
    expect(buildRefMenu(refs, "完全沒有", state())).toEqual([]);
  });
});

describe("buildRefMenu — a big board", () => {
  it("stops at the limit and says how many more there are", () => {
    const items = Array.from({ length: 400 }, (_, i) => ({ id: `x${i}`, name: `項目${i}`, wbsCode: String(i + 1), groupName: "g", parentId: null, depth: 0 }));
    const rows = buildRefMenu({ items, risks: [] }, "", state());
    expect(rows).toHaveLength(REF_MENU_LIMIT + 1);
    expect(rows[rows.length - 1]).toEqual({ type: "more", count: 400 - (REF_MENU_LIMIT - 1) });
  });
});

describe("navigableRefs", () => {
  it("is what the arrow keys walk through: no headings, no greyed-out parents", () => {
    expect(navigableRefs(buildRefMenu(refs, "市場", state())).map((r) => r.id)).toEqual(["a1x"]);
    expect(navigableRefs(buildRefMenu(refs, "", state(["a", "b"]))).map((r) => r.id)).toEqual(["a", "a1", "b", "b1", "r1", "r2", "r3"]);
  });
});

describe("defaultExpandedItems", () => {
  it("opens the top level so the first two levels show, and keeps deeper ones closed", () => {
    expect([...defaultExpandedItems(refs.items)].sort()).toEqual(["a", "b"]);
  });

  it("does not bother with top-level items that have no children", () => {
    expect([...defaultExpandedItems([{ id: "solo", depth: 0, parentId: null }])]).toEqual([]);
  });
});

const links = [
  { url: "/boards/b1?highlight=i3", label: "工作項:電機選型" },
  { url: "/boards/b1?view=risks", label: "議題:試產良率偏低" },
  { url: "https://example.com/spec", label: "設計文件" },
];

describe("splitRefs", () => {
  it("turns #name into a ref when the message carries that link", () => {
    expect(splitRefs("請看 #電機選型 的進度", links)).toEqual([
      { kind: "text", text: "請看 " },
      { kind: "ref", text: "#電機選型", url: "/boards/b1?highlight=i3" },
      { kind: "text", text: " 的進度" },
    ]);
  });

  it("handles several refs and a ref at the very start", () => {
    const segments = splitRefs("#電機選型 與 #試產良率偏低", links);
    expect(segments.filter((s) => s.kind === "ref").map((s) => s.kind === "ref" && s.url)).toEqual(["/boards/b1?highlight=i3", "/boards/b1?view=risks"]);
  });

  it("leaves #text alone when no link of that name was attached", () => {
    expect(splitRefs("#不存在的名稱", links)).toEqual([{ kind: "text", text: "#不存在的名稱" }]);
  });

  it("does not take a # glued to a word", () => {
    expect(splitRefs("版本#電機選型", links)).toEqual([{ kind: "text", text: "版本#電機選型" }]);
  });

  it("prefers the longer name", () => {
    const both = [
      { url: "/boards/b1?highlight=a", label: "工作項:電機" },
      { url: "/boards/b1?highlight=b", label: "工作項:電機選型 v2" },
    ];
    const [seg] = splitRefs("#電機選型 v2", both);
    expect(seg).toEqual({ kind: "ref", text: "#電機選型 v2", url: "/boards/b1?highlight=b" });
  });

  it("only links to this system's own items (not any attachment with a colon in its label)", () => {
    expect(splitRefs("#spec", [{ url: "https://example.com", label: "文件:spec" }])).toEqual([{ kind: "text", text: "#spec" }]);
  });

  it("returns the plain text when there are no links, and nothing for an empty body", () => {
    expect(splitRefs("你好", [])).toEqual([{ kind: "text", text: "你好" }]);
    expect(splitRefs("", links)).toEqual([]);
  });
});

describe("inlineRefUrls", () => {
  it("lists the links that were drawn inline, so they are not repeated as cards", () => {
    expect([...inlineRefUrls("請看 #電機選型", links)]).toEqual(["/boards/b1?highlight=i3"]);
  });

  it("is empty when the text does not use any of them", () => {
    expect(inlineRefUrls("沒有引用", links).size).toBe(0);
  });
});
