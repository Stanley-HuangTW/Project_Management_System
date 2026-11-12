import { describe, expect, it } from "vitest";
import { withWeekday } from "./weekdayLabel";

describe("withWeekday", () => {
  it("日期後面接星期幾(使用者回報的那個對話框:Start 2026-11-12 是週四、Finish 2026-11-20 是週五)", () => {
    expect(withWeekday("2026-11-12")).toBe("2026-11-12(週四)");
    expect(withWeekday("2026-11-20")).toBe("2026-11-20(週五)");
  });

  it("一週七天都對,週日是週日、週六是週六", () => {
    expect(["2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"].map(withWeekday)).toEqual([
      "2026-11-08(週日)",
      "2026-11-09(週一)",
      "2026-11-10(週二)",
      "2026-11-11(週三)",
      "2026-11-12(週四)",
      "2026-11-13(週五)",
      "2026-11-14(週六)",
    ]);
  });

  it("閏日、年底年初、很早很晚的年份", () => {
    expect(withWeekday("2028-02-29")).toBe("2028-02-29(週二)");
    expect(withWeekday("2026-12-31")).toBe("2026-12-31(週四)");
    expect(withWeekday("2027-01-01")).toBe("2027-01-01(週五)");
    expect(withWeekday("1999-12-31")).toBe("1999-12-31(週五)");
  });

  it("不是日期、不存在的日期、帶時間的:原樣還給你", () => {
    for (const s of ["未設定", "", "2026-02-30", "2026-13-01", "2026-11-12T00:00:00Z", "2026/11/12", "null"]) expect(withWeekday(s)).toBe(s);
  });

  it("跟 Date 算出來的星期一致:連續三年每一天都對", () => {
    const names = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
    for (let t = Date.UTC(2025, 0, 1); t < Date.UTC(2028, 0, 1); t += 86_400_000) {
      const d = new Date(t);
      const iso = d.toISOString().slice(0, 10);
      expect(withWeekday(iso)).toBe(`${iso}(${names[d.getUTCDay()]})`);
    }
  });
});
