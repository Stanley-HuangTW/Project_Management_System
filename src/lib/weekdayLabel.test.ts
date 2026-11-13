import { describe, expect, it } from "vitest";
import { localeDateTimeWithWeekday, localeDateWithWeekday, shortWithWeekday, weekdayOf, withWeekday } from "./weekdayLabel";

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

describe("weekdayOf / shortWithWeekday", () => {
  it("只給星期幾;不是日期給空字串", () => {
    expect(weekdayOf("2026-11-13")).toBe("週五");
    expect(weekdayOf("2026-02-30")).toBe("");
    expect(weekdayOf("")).toBe("");
  });
  it("短格式日期接星期幾,壞日期原樣", () => {
    expect(shortWithWeekday("11/13", "2026-11-13")).toBe("11/13(週五)");
    expect(shortWithWeekday("—", "bad")).toBe("—");
  });
});

describe("localeDateWithWeekday / localeDateTimeWithWeekday", () => {
  it("用執行環境的時區,星期跟日期對得起來", () => {
    const d = new Date(2026, 10, 13, 8, 46, 0);
    expect(localeDateWithWeekday(d)).toBe(`${d.toLocaleDateString("zh-TW")}(週五)`);
    expect(localeDateTimeWithWeekday(d.toISOString())).toBe(`${d.toLocaleDateString("zh-TW")}(週五) ${d.toLocaleTimeString("zh-TW")}`);
  });
  it("不是時間給空字串", () => {
    expect(localeDateWithWeekday("nope")).toBe("");
  });
});
