import { describe, expect, it } from "vitest";
import { FEEDBACK_MAX_LENGTH, feedbackCsv, normalizeFeedback } from "./feedback";
import type { FeedbackContext } from "./feedbackContext";

const ok = { message: "甘特圖的長條拖不動", path: "/boards/b1", pageLabel: "甘特圖", manualAnchor: "ch-9" };

describe("normalizeFeedback", () => {
  it("accepts a normal report and trims the message", () => {
    expect(normalizeFeedback({ ...ok, message: "  甘特圖的長條拖不動  \n" })).toEqual({ value: ok });
  });

  it("asks for something to be written", () => {
    for (const message of ["", "   ", "\n\n", undefined]) {
      expect(normalizeFeedback({ ...ok, message })).toEqual({ error: "請先寫下你的問題或想說的話" });
    }
  });

  it("refuses a message over the limit and says how long it is", () => {
    expect(normalizeFeedback({ ...ok, message: "a".repeat(FEEDBACK_MAX_LENGTH) })).toHaveProperty("value");
    const result = normalizeFeedback({ ...ok, message: "a".repeat(FEEDBACK_MAX_LENGTH + 1) });
    expect(result).toEqual({ error: `內容太長了(上限 ${FEEDBACK_MAX_LENGTH} 字,現在 ${FEEDBACK_MAX_LENGTH + 1} 字)` });
  });

  it("only keeps paths on this site", () => {
    expect(normalizeFeedback({ ...ok, path: "https://evil.example.com/x" })).toMatchObject({ value: { path: "/" } });
    expect(normalizeFeedback({ ...ok, path: "//evil.example.com/x" })).toMatchObject({ value: { path: "/" } });
    expect(normalizeFeedback({ ...ok, path: "" })).toMatchObject({ value: { path: "/" } });
    expect(normalizeFeedback({ ...ok, path: "/boards/b1?view=risks&risk=r1" })).toMatchObject({ value: { path: "/boards/b1?view=risks&risk=r1" } });
  });

  it("cuts long paths and labels short instead of storing them whole", () => {
    const result = normalizeFeedback({ ...ok, path: "/" + "x".repeat(2000), pageLabel: "長".repeat(500) });
    expect("value" in result && result.value.path.length).toBe(500);
    expect("value" in result && result.value.pageLabel.length).toBe(60);
  });

  it("only believes manual anchors written the way the manual writes them", () => {
    for (const manualAnchor of ["ch-9", "s-9-6", "s-21-1b", "s-11-3b"]) {
      expect(normalizeFeedback({ ...ok, manualAnchor })).toMatchObject({ value: { manualAnchor } });
    }
    for (const manualAnchor of ["", "<script>", "ch-9 onclick", "javascript:alert(1)", "x".repeat(100), "ch-"]) {
      expect(normalizeFeedback({ ...ok, manualAnchor })).toMatchObject({ value: { manualAnchor: "" } });
    }
  });

  it("names an unknown screen instead of leaving it blank", () => {
    expect(normalizeFeedback({ ...ok, pageLabel: "  " })).toMatchObject({ value: { pageLabel: "(未知畫面)" } });
  });

  it("keeps a picked element's context, and leaves the key out when there is none or it is junk", () => {
    const context = { element: { tag: "button", label: "新增項目", selector: "main > button" }, viewport: { width: 1400, height: 900, dpr: 1.5 } };
    const result = normalizeFeedback({ ...ok, context });
    expect("value" in result && result.value.context?.element?.label).toBe("新增項目");
    for (const junk of [undefined, null, "x", 5, [], {}, { element: { tag: "<script>" } }]) {
      const r = normalizeFeedback({ ...ok, context: junk });
      expect(r).toEqual({ value: ok });
      expect("value" in r && "context" in r.value).toBe(false);
    }
  });
});

describe("feedbackCsv", () => {
  const row = {
    createdAt: "2026-11-03 09:30",
    userName: "李小明",
    userEmail: "li@example.com",
    pageLabel: "甘特圖",
    path: "/boards/b1",
    manualAnchor: "ch-9",
    message: '長條拖不動,出現 "權限不足"\n第二行',
    status: "OPEN" as const,
    adminNote: null,
    resolvedAt: null,
    resolvedByName: null,
    context: null as FeedbackContext | null,
  };

  it("has a header and one line per report", () => {
    const lines = feedbackCsv([row, { ...row, userName: "王主管" }]).split("\r\n");
    expect(lines[0]).toBe('"送出時間","回報人","Email","畫面","網址","手冊章節","內容","狀態","處理說明","處理時間","處理人","選取的元素","selector"');
    // 表頭 + 兩列;內容裡的換行是 LF,不會被當成列的結尾(CRLF)。
    expect(lines).toHaveLength(3);
  });

  it("quotes every cell and doubles the quotes inside, keeping commas and line breaks", () => {
    const csv = feedbackCsv([row]);
    expect(csv).toContain('"長條拖不動,出現 ""權限不足""\n第二行"');
    expect(csv).toContain('"李小明","li@example.com","甘特圖","/boards/b1","ch-9"');
    expect(csv).toContain('"未處理"');
  });

  it("writes the resolution when there is one", () => {
    const csv = feedbackCsv([{ ...row, status: "RESOLVED", adminNote: "手冊第 9 章有寫", resolvedAt: "2026-11-03 10:00", resolvedByName: "Admin" }]);
    expect(csv).toContain('"已處理","手冊第 9 章有寫","2026-11-03 10:00","Admin"');
  });

  it("writes the picked element and its selector, empty when no element was picked", () => {
    const context: FeedbackContext = {
      element: { tag: "button", label: "新增項目", text: "新增項目", selector: "main > button.add", attrs: {}, classes: "", html: "", ancestors: [], rect: { x: 1, y: 2, width: 3, height: 4 } },
    };
    expect(feedbackCsv([{ ...row, context }])).toContain('"<button>「新增項目」","main > button.add"');
    expect(feedbackCsv([row]).split("\r\n")[1]).toMatch(/"",""$/);
  });

  it("is just the header when there is nothing", () => {
    expect(feedbackCsv([]).split("\r\n")).toHaveLength(1);
  });
});
