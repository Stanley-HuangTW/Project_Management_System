import { describe, expect, it } from "vitest";
import { activeRefQuery, inlineRefUrls, splitRefs, suggestRefs } from "./chatRefMention";

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
    { id: "i1", name: "外殼打樣評審", wbsCode: "1", groupName: "分組一" },
    { id: "i2", name: "夾具設計", wbsCode: "1.1", groupName: "分組一" },
    { id: "i3", name: "電機選型", wbsCode: "2", groupName: "分組一" },
    { id: "i4", name: "第二版外殼", wbsCode: "3", groupName: "分組二" },
  ],
  risks: [
    { id: "r1", title: "供應商交期延遲", kind: "RISK" as const, mantisId: null },
    { id: "r2", title: "試產良率偏低", kind: "ISSUE" as const, mantisId: null },
    { id: "r3", title: "Mantis 回報:電池蓋鎖不緊", kind: "ISSUE" as const, mantisId: 4521 },
  ],
};

describe("suggestRefs", () => {
  it("lists the first few items when nothing is typed yet", () => {
    expect(suggestRefs(refs, "", 3).map((s) => s.id)).toEqual(["i1", "i2", "i3"]);
  });

  it("matches the name, case-insensitively, across work items, risks and issues", () => {
    expect(suggestRefs(refs, "外殼").map((s) => [s.kind, s.id])).toEqual([
      ["item", "i1"],
      ["item", "i4"],
    ]);
  });

  it("puts names that start with the text before names that merely contain it", () => {
    expect(suggestRefs(refs, "外殼").map((s) => s.id)).toEqual(["i1", "i4"]);
    const shuffled = { ...refs, items: [refs.items[3], refs.items[0], refs.items[1], refs.items[2]] };
    expect(suggestRefs(shuffled, "外殼").map((s) => s.id)).toEqual(["i1", "i4"]);
  });

  it("matches the WBS code", () => {
    expect(suggestRefs(refs, "1.1").map((s) => s.id)).toEqual(["i2"]);
  });

  it("labels risks and issues, including the ones synced from Mantis", () => {
    const hits = suggestRefs(refs, "試產");
    expect(hits).toEqual([{ kind: "issue", id: "r2", name: "試產良率偏低", hint: "" }]);
    expect(suggestRefs(refs, "供應商")[0].kind).toBe("risk");
    expect(suggestRefs(refs, "4521")[0]).toMatchObject({ kind: "issue", id: "r3", hint: "Mantis #4521" });
  });

  it("shows where a work item sits (WBS code and group)", () => {
    expect(suggestRefs(refs, "夾具")[0].hint).toBe("1.1 · 分組一");
  });

  it("closes once the name is complete and a space follows (the picked text is \"#name \")", () => {
    expect(suggestRefs(refs, "電機選型 ")).toEqual([]);
  });

  it("still finds a name that has a space in it", () => {
    const spaced = { items: [{ id: "s1", name: "夾具 設計", wbsCode: "1", groupName: "g" }], risks: [] };
    expect(suggestRefs(spaced, "夾具 ").map((s) => s.id)).toEqual(["s1"]);
  });

  it("lists nothing for a query that is only spaces", () => {
    expect(suggestRefs(refs, " ")).toEqual([]);
  });

  it("caps the list", () => {
    const many = { items: Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, name: `項目${i}`, wbsCode: String(i), groupName: "g" })), risks: [] };
    expect(suggestRefs(many, "項目")).toHaveLength(8);
  });

  it("returns nothing when nothing matches", () => {
    expect(suggestRefs(refs, "完全沒有")).toEqual([]);
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
