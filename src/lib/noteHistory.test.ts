import { describe, expect, it } from "vitest";
import { buildNoteHistory, suggestNotes } from "./noteHistory";

describe("buildNoteHistory", () => {
  it("同一個對象的同一句備註收成一筆,記次數與最近日期", () => {
    const history = buildNoteHistory([
      { scope: "cat:meeting", text: "AMR Platform Regular Meeting", date: "2026-10-01" },
      { scope: "cat:meeting", text: "AMR Platform Regular Meeting ", date: "2026-10-06" },
      { scope: "cat:meeting", text: "AMR Platform Regular Meeting", date: "2026-09-29" },
    ]);
    expect(history).toEqual([{ scope: "cat:meeting", text: "AMR Platform Regular Meeting", count: 3, last: "2026-10-06" }]);
  });

  it("空白備註不記;不同對象分開記", () => {
    const history = buildNoteHistory([
      { scope: "item:a", text: "  ", date: "2026-10-01" },
      { scope: "item:a", text: "設計檢討", date: "2026-10-01" },
      { scope: "item:b", text: "設計檢討", date: "2026-10-02" },
    ]);
    expect(history).toHaveLength(2);
  });
});

describe("suggestNotes", () => {
  const history = buildNoteHistory([
    { scope: "cat:meeting", text: "AMR Platform Regular Meeting", date: "2026-10-01" },
    { scope: "cat:meeting", text: "AMR Platform Regular Meeting", date: "2026-10-06" },
    { scope: "cat:meeting", text: "NUDD 會議", date: "2026-10-05" },
    { scope: "cat:training", text: "Zephyr RTOS 內訓", date: "2026-09-20" },
    { scope: "item:mcu", text: "MCU 原理圖檢討", date: "2026-10-03" },
    { scope: "item:mcu", text: "AMR Platform Regular Meeting", date: "2026-09-01" },
  ]);

  it("這次登記的對象用過的排前面,就算別處用得更多", () => {
    const list = suggestNotes(history, { scope: "cat:training", query: "" });
    expect(list[0]).toBe("Zephyr RTOS 內訓");
    expect(list).toContain("AMR Platform Regular Meeting");
  });

  it("沒有輸入時,同一對象依用過的次數排", () => {
    const list = suggestNotes(history, { scope: "cat:meeting", query: "" });
    expect(list.slice(0, 2)).toEqual(["AMR Platform Regular Meeting", "NUDD 會議"]);
  });

  it("同一句備註在不同對象只列一次", () => {
    const list = suggestNotes(history, { scope: null, query: "regular" });
    expect(list).toEqual(["AMR Platform Regular Meeting"]);
  });

  it("輸入關鍵字會過濾(不分大小寫、多個關鍵字都要符合),已經一模一樣的不再建議", () => {
    expect(suggestNotes(history, { scope: null, query: "amr meeting" })).toEqual(["AMR Platform Regular Meeting"]);
    expect(suggestNotes(history, { scope: null, query: "amr platform regular meeting" })).toEqual([]);
    expect(suggestNotes(history, { scope: null, query: "zzz" })).toEqual([]);
  });

  it("最多列出 limit 筆", () => {
    expect(suggestNotes(history, { scope: null, query: "", limit: 2 })).toHaveLength(2);
  });
});
