import { describe, expect, it } from "vitest";
import { debugPrompt, elementSummary, normalizeContext, type FeedbackContext } from "./feedbackContext";

const element = {
  tag: "button",
  label: "新增項目",
  text: "+ 新增項目",
  selector: 'section[data-todo-deadlines] > ul > li:nth-of-type(2) > button',
  attrs: { "data-item-name-button": "i1", "aria-label": "新增項目" },
  classes: "flex w-full items-center",
  html: '<button data-item-name-button="i1">\n  + 新增項目\n</button>',
  ancestors: ["li[data-todo-deadline-row]", "ul.divide-y", "section[data-todo-deadlines]"],
  rect: { x: 120.4, y: 300.6, width: 480, height: 36 },
};

describe("normalizeContext", () => {
  it("keeps a well-formed context and rounds the numbers", () => {
    const ctx = normalizeContext({ element, viewport: { width: 1400, height: 900, dpr: 1.5 }, userAgent: "Mozilla/5.0 Chrome/130", hint: "board:gantt" });
    expect(ctx?.element?.tag).toBe("button");
    expect(ctx?.element?.rect).toEqual({ x: 120, y: 301, width: 480, height: 36 });
    expect(ctx?.element?.html).toContain("\n"); // HTML 片段的換行保留
    expect(ctx?.viewport).toEqual({ width: 1400, height: 900, dpr: 1.5 });
    expect(ctx?.hint).toBe("board:gantt");
  });

  it("returns null when there is nothing usable", () => {
    for (const junk of [undefined, null, "x", 5, true, [], {}, { element: "x" }, { element: { tag: "<script>" } }, { element: { tag: "" } }]) {
      expect(normalizeContext(junk)).toBeNull();
    }
  });

  it("cuts every string to its limit and collapses whitespace in the one-line fields", () => {
    const ctx = normalizeContext({
      element: {
        ...element,
        label: "長".repeat(500),
        text: "a\n\n   b",
        selector: "x".repeat(2000),
        classes: "c".repeat(2000),
        html: "h".repeat(9000),
        ancestors: Array.from({ length: 50 }, () => "y".repeat(500)),
      },
      userAgent: "u".repeat(900),
    });
    expect(ctx?.element?.label).toHaveLength(60);
    expect(ctx?.element?.text).toBe("a b");
    expect(ctx?.element?.selector).toHaveLength(300);
    expect(ctx?.element?.classes).toHaveLength(300);
    expect(ctx?.element?.html).toHaveLength(1500);
    expect(ctx?.element?.ancestors).toHaveLength(8);
    expect(ctx?.element?.ancestors[0]).toHaveLength(120);
    expect(ctx?.userAgent).toHaveLength(200);
  });

  it("only keeps attributes with sane names and string values, capped in number", () => {
    const attrs: Record<string, unknown> = { "data-ok": "1", "bad name": "x", "<img>": "x", num: 5, "data-long": "v".repeat(500) };
    for (let i = 0; i < 30; i++) attrs[`data-k${i}`] = "v";
    const kept = normalizeContext({ element: { ...element, attrs } })?.element?.attrs ?? {};
    expect(kept["data-ok"]).toBe("1");
    expect(kept["bad name"]).toBeUndefined();
    expect(kept["<img>"]).toBeUndefined();
    expect(kept.num).toBeUndefined();
    expect(kept["data-long"]).toHaveLength(80);
    expect(Object.keys(kept).length).toBeLessThanOrEqual(14);
  });

  it("does not trust numbers: non-finite and huge values are neutralised", () => {
    const ctx = normalizeContext({
      element: { ...element, rect: { x: Infinity, y: NaN, width: 1e12, height: "9" } },
      viewport: { width: -50, height: "x", dpr: 999 },
    });
    expect(ctx?.element?.rect).toEqual({ x: 0, y: 0, width: 100000, height: 0 });
    expect(ctx?.viewport).toEqual({ width: 0, height: 0, dpr: 8 });
  });

  it("drops unknown fields instead of storing them", () => {
    const ctx = normalizeContext({ element, evil: "<script>", viewport: { width: 1, height: 1, dpr: 1, extra: 1 } }) as Record<string, unknown>;
    expect(ctx.evil).toBeUndefined();
    expect(Object.keys(ctx.viewport as object).sort()).toEqual(["dpr", "height", "width"]);
  });
});

describe("elementSummary", () => {
  it("names the element by tag and label", () => {
    expect(elementSummary({ element })).toBe("<button>「新增項目」");
    expect(elementSummary({ element: { ...element, label: "" } })).toBe("<button>");
  });
  it("is null when no element was picked", () => {
    expect(elementSummary(null)).toBeNull();
    expect(elementSummary({ viewport: { width: 1, height: 1, dpr: 1 } })).toBeNull();
  });
});

describe("debugPrompt", () => {
  const base = {
    id: "fb1",
    userName: "李小明",
    userEmail: "li@example.com",
    createdAt: "2026-11-03 14:20",
    pageLabel: "甘特圖",
    path: "/boards/b1?view=gantt",
    manualAnchor: "ch-9",
    message: "這個按鈕按了沒反應",
  };
  const context: FeedbackContext = { element, viewport: { width: 1400, height: 900, dpr: 1.5 }, userAgent: "Chrome/130", hint: "board:gantt" };

  it("tells Claude Code who, where, what they said and which element they picked", () => {
    const text = debugPrompt({ ...base, context });
    for (const part of [
      "## 使用者回報 fb1",
      "李小明(li@example.com)",
      "2026-11-03 14:20(台北時間)",
      "畫面:甘特圖",
      "`/boards/b1?view=gantt`",
      "手冊章節:ch-9",
      "看板分頁:board:gantt",
      "1400×900",
      "這個按鈕按了沒反應",
      "標籤:`<button>`",
      "畫面上的文字:「+ 新增項目」",
      "`section[data-todo-deadlines] > ul > li:nth-of-type(2) > button`",
      '`data-item-name-button="i1"`',
      "```html",
      "怎麼找原始碼",
    ]) {
      expect(text).toContain(part);
    }
    expect(text).toContain("`li[data-todo-deadline-row]` ← `ul.divide-y` ← `section[data-todo-deadlines]`");
  });

  it("still makes a usable prompt without a picked element", () => {
    const text = debugPrompt({ ...base, manualAnchor: "", context: null });
    expect(text).toContain("這個按鈕按了沒反應");
    expect(text).toContain("沒有選取元素");
    expect(text).not.toContain("手冊章節");
    expect(text).not.toContain("```html");
  });

  it("does not let a backtick in the data break the inline code", () => {
    const text = debugPrompt({ ...base, context: { element: { ...element, selector: "a`b" } } });
    expect(text).toContain("`a'b`");
  });
});
