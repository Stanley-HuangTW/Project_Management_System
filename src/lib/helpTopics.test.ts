import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allHelpAnchors, ELEMENT_TOPICS, helpTopicFor, helpTopicForElement, manualHref, MODAL_HELP } from "./helpTopics";
import { parseManual } from "./manual";

describe("helpTopicFor", () => {
  it("maps the main pages to their chapters", () => {
    expect(helpTopicFor("/dashboard", null, false)).toMatchObject({ label: "儀表板", anchor: "ch-16" });
    expect(helpTopicFor("/dashboard/project/abc", null, false)).toMatchObject({ label: "專案儀表板", anchor: "s-16-1" });
    expect(helpTopicFor("/reports/weekly", null, false).anchor).toBe("ch-19");
    expect(helpTopicFor("/timesheet", null, false).anchor).toBe("ch-17");
    expect(helpTopicFor("/approvals", null, false).anchor).toBe("ch-18");
    expect(helpTopicFor("/chat", null, false).anchor).toBe("s-1-7");
    expect(helpTopicFor("/updates", null, false).anchor).toBe("s-1-6");
    expect(helpTopicFor("/search", null, false).anchor).toBe("s-20-1");
  });

  it("a board is on its table view until the page says otherwise, and follows the tab it registers", () => {
    expect(helpTopicFor("/boards/b1", null, false).anchor).toBe("ch-4");
    expect(helpTopicFor("/boards/b1", "board:table", false).anchor).toBe("ch-4");
    expect(helpTopicFor("/boards/b1", "board:gantt", false)).toMatchObject({ label: "甘特圖", anchor: "ch-9" });
    expect(helpTopicFor("/boards/b1", "board:kanban", false).anchor).toBe("ch-8");
    expect(helpTopicFor("/boards/b1", "board:risks", false).anchor).toBe("ch-11");
    expect(helpTopicFor("/boards/b1", "board:issues", false).anchor).toBe("s-11-5");
    expect(helpTopicFor("/boards/b1", "board:budget", false).anchor).toBe("ch-14");
    expect(helpTopicFor("/boards/b1", "board:gates", false).anchor).toBe("ch-12");
    expect(helpTopicFor("/boards/b1", "board:changes", false).anchor).toBe("ch-13");
    expect(helpTopicFor("/boards/b1", "board:report", false).anchor).toBe("ch-10");
  });

  it("an unknown board tab falls back to the table chapter instead of nothing", () => {
    expect(helpTopicFor("/boards/b1", "board:something-new", false).anchor).toBe("ch-4");
  });

  it("the windows that block the page underneath carry their own help topic", () => {
    expect(MODAL_HELP.itemCard).toEqual({ label: "項目卡片", anchor: "ch-5" });
    expect(MODAL_HELP.assignment).toEqual({ label: "點長條:人員分配視窗", anchor: "s-9-6" });
  });

  it("a hint that is not a board tab is ignored", () => {
    expect(helpTopicFor("/boards/b1", "item-card", false).anchor).toBe("ch-4");
    expect(helpTopicFor("/dashboard", "board:gantt", false).anchor).toBe("ch-16");
  });

  it("admin chapters are only linked for admins; everyone else lands on the manual's front page", () => {
    expect(helpTopicFor("/settings", null, true)).toMatchObject({ label: "系統設定", anchor: "s-21-3" });
    expect(helpTopicFor("/settings", null, false)).toEqual({ label: "系統設定", anchor: "" });
    expect(helpTopicFor("/org-chart", null, false).anchor).toBe("");
    expect(helpTopicFor("/org-chart", null, true).anchor).toBe("s-21-1b");
    expect(helpTopicFor("/audit", null, true).anchor).toBe("s-21-2");
    expect(helpTopicFor("/feedback", null, true).anchor).toBe("s-21-2b");
  });

  it("a longer prefix beats a shorter one, and a prefix only matches whole path segments", () => {
    expect(helpTopicFor("/dashboard/project/x", null, false).label).toBe("專案儀表板");
    expect(helpTopicFor("/boardsomething", null, false).label).toBe("快速開始");
  });

  it("ignores the query string and a trailing slash", () => {
    expect(helpTopicFor("/reports/weekly?x=1", null, false).anchor).toBe("ch-19");
    expect(helpTopicFor("/timesheet/", null, false).anchor).toBe("ch-17");
  });

  it("unknown pages open the quick-start chapter", () => {
    expect(helpTopicFor("/something-new", null, false)).toMatchObject({ label: "快速開始", anchor: "ch-1" });
    expect(helpTopicFor("/", null, false).anchor).toBe("ch-1");
  });

  it("the manual page itself opens the manual front page", () => {
    expect(helpTopicFor("/manual", null, false).anchor).toBe("");
  });
});

describe("helpTopicForElement", () => {
  /** 假裝選到的元素(或它的上層)帶著這些 data 標記。 */
  const has = (...marks: string[]) => (selector: string) => selector.split(",").some((part) => marks.includes(part.trim()));

  it("finds the chapter for the spot that was picked", () => {
    expect(helpTopicForElement(has("[data-gantt-bar]"), false)).toMatchObject({ anchor: "s-9-3" });
    expect(helpTopicForElement(has("[data-todo-deadline-row]"), false)).toMatchObject({ label: "儀表板:待辦事項期限", anchor: "ch-16" });
    expect(helpTopicForElement(has("[data-risk-todo]"), false)).toMatchObject({ anchor: "s-11-3b" });
    expect(helpTopicForElement(has("[data-member-row]"), false)).toMatchObject({ anchor: "ch-2" });
  });

  it("the more specific spot wins when several match (a bar inside a gantt row)", () => {
    expect(helpTopicForElement(has("[data-gantt-row]", "[data-gantt-bar]"), false)?.anchor).toBe("s-9-3");
  });

  it("is null when nothing known was picked, so the caller falls back to the whole screen", () => {
    expect(helpTopicForElement(has(), false)).toBeNull();
  });

  it("admin-only spots send everyone else to the manual front page", () => {
    expect(helpTopicForElement(has("[data-feedback-row]"), true)).toMatchObject({ anchor: "s-21-2b" });
    expect(helpTopicForElement(has("[data-feedback-row]"), false)).toEqual({ label: "使用者回報", anchor: "" });
  });

  it("every entry is a valid selector list with a topic", () => {
    for (const [selector, topic] of ELEMENT_TOPICS) {
      expect(selector.split(",").every((part) => /^\[data-[a-z0-9-]+\]$/.test(part.trim()))).toBe(true);
      expect(topic.label.length).toBeGreaterThan(0);
    }
  });
});

describe("manualHref", () => {
  it("jumps to the anchor, or to the front page when there is none", () => {
    expect(manualHref("ch-9")).toBe("/manual#ch-9");
    expect(manualHref("s-9-6")).toBe("/manual#s-9-6");
    expect(manualHref("")).toBe("/manual");
  });
});

describe("every anchor the help button can open exists in the real manual", () => {
  const manual = parseManual(readFileSync(path.join(process.cwd(), "docs", "使用手冊.md"), "utf8"));
  const ids = new Set(manual.chapters.flatMap((c) => [c.id, ...c.sections.map((s) => s.id)]));

  it("has every chapter and section the table points at", () => {
    const missing = allHelpAnchors().filter((a) => !ids.has(a));
    expect(missing).toEqual([]);
  });

  it("the admin-only sections are inside the admin-only chapter (so members are sent to the front page instead)", () => {
    const adminChapter = manual.chapters.find((c) => c.id === "ch-21");
    expect(adminChapter?.adminOnly).toBe(true);
    for (const anchor of ["s-21-1", "s-21-1b", "s-21-2", "s-21-2b", "s-21-3"]) {
      expect(adminChapter?.sections.map((s) => s.id)).toContain(anchor);
    }
  });
});
