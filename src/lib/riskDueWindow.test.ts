import { describe, expect, it } from "vitest";
import { describeDueAgainstItem } from "./riskDueWindow";

describe("describeDueAgainstItem:對策到期日有沒有落在工作項的時間內", () => {
  const start = "2026-11-12";
  const end = "2026-11-20";

  it("在期間內(含頭尾兩天):ok", () => {
    for (const due of ["2026-11-12", "2026-11-16", "2026-11-20"]) {
      const note = describeDueAgainstItem(due, start, end);
      expect(note.tone).toBe("ok");
      expect(note.text).toContain("落在這個工作項的時間內");
    }
  });

  it("比結束日晚:warn,說晚幾天,日期帶星期", () => {
    const note = describeDueAgainstItem("2026-11-25", start, end);
    expect(note.tone).toBe("warn");
    expect(note.text).toBe("對策到期日 2026-11-25(週三) 比工作項結束日 2026-11-20(週五) 晚 5 天,超出這個工作項的時間。");
  });

  it("比開始日早:warn,說早幾天", () => {
    const note = describeDueAgainstItem("2026-11-10", start, end);
    expect(note.tone).toBe("warn");
    expect(note.text).toContain("早 2 天");
    expect(note.text).toContain("開始之前");
  });

  it("只有結束日 / 只有開始日:能比的那一邊照比", () => {
    expect(describeDueAgainstItem("2026-11-25", null, end).tone).toBe("warn");
    expect(describeDueAgainstItem("2026-11-01", null, end).tone).toBe("ok"); // 沒有開始日,不能說「早於開始」
    expect(describeDueAgainstItem("2026-11-05", start, null).tone).toBe("warn");
    expect(describeDueAgainstItem("2026-12-31", start, null).tone).toBe("ok");
  });

  it("沒設到期日、或工作項沒有日期:info,不下判斷", () => {
    expect(describeDueAgainstItem(null, start, end)).toMatchObject({ tone: "info" });
    expect(describeDueAgainstItem("", start, end)).toMatchObject({ tone: "info" });
    expect(describeDueAgainstItem("2026-11-16", null, null)).toMatchObject({ tone: "info" });
    expect(describeDueAgainstItem("2026-11-16", "不是日期", "")).toMatchObject({ tone: "info" });
  });

  it("跨月、跨年:天數照日曆算", () => {
    expect(describeDueAgainstItem("2027-01-03", "2026-12-20", "2026-12-31").text).toContain("晚 3 天");
    expect(describeDueAgainstItem("2026-12-31", "2026-12-20", "2027-01-05").tone).toBe("ok");
  });
});
