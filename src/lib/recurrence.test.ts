import { describe, expect, it } from "vitest";
import { MAX_OCCURRENCES, describeRecurrence, recurrenceDates, validateRecurrence, weekdayOf, type RecurrenceRule } from "./recurrence";

describe("weekdayOf", () => {
  it("1 = 週一 … 7 = 週日", () => {
    expect(weekdayOf("2026-10-05")).toBe(1);
    expect(weekdayOf("2026-10-11")).toBe(7);
    expect(weekdayOf("2026-10-07")).toBe(3);
  });
});

describe("每週重複", () => {
  it("每週一,到月底", () => {
    expect(recurrenceDates("2026-10-05", { type: "weekly", weekdays: [1] }, "2026-10-31")).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ]);
  });

  it("週一、週三,一週內兩筆;結束日當天符合也算", () => {
    expect(recurrenceDates("2026-10-05", { type: "weekly", weekdays: [3, 1] }, "2026-10-14")).toEqual([
      "2026-10-05",
      "2026-10-07",
      "2026-10-12",
      "2026-10-14",
    ]);
  });

  it("起始日不符合條件就不算,第一筆是之後第一個符合的日子", () => {
    // 2026-10-06 是週二,只選週一
    expect(recurrenceDates("2026-10-06", { type: "weekly", weekdays: [1] }, "2026-10-20")).toEqual(["2026-10-12", "2026-10-19"]);
  });

  it("每個工作日", () => {
    const dates = recurrenceDates("2026-10-05", { type: "weekly", weekdays: [1, 2, 3, 4, 5] }, "2026-10-11");
    expect(dates).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  });

  it("跨月跨年也對", () => {
    expect(recurrenceDates("2026-12-28", { type: "weekly", weekdays: [1] }, "2027-01-12")).toEqual(["2026-12-28", "2027-01-04", "2027-01-11"]);
  });
});

describe("每月重複", () => {
  it("每月同一號", () => {
    expect(recurrenceDates("2026-10-15", { type: "monthly" }, "2027-01-20")).toEqual(["2026-10-15", "2026-11-15", "2026-12-15", "2027-01-15"]);
  });

  it("沒有那一號的月份跳過(31 號)", () => {
    expect(recurrenceDates("2026-10-31", { type: "monthly" }, "2027-01-31")).toEqual(["2026-10-31", "2026-12-31", "2027-01-31"]);
  });
});

describe("validateRecurrence", () => {
  const weekly: RecurrenceRule = { type: "weekly", weekdays: [1] };

  it("正常的沒有錯誤", () => {
    expect(validateRecurrence("2026-10-05", weekly, "2026-12-31")).toBeNull();
  });

  it("結束日不能早於起始日", () => {
    expect(validateRecurrence("2026-10-05", weekly, "2026-10-01")).toMatch(/早於/);
  });

  it("日期格式不對", () => {
    expect(validateRecurrence("x", weekly, "2026-12-31")).toMatch(/日期/);
    expect(validateRecurrence("2026-10-05", weekly, "")).toMatch(/重複到哪一天/);
  });

  it("至少選一天、星期要在 1–7", () => {
    expect(validateRecurrence("2026-10-05", { type: "weekly", weekdays: [] }, "2026-12-31")).toMatch(/至少選一天/);
    expect(validateRecurrence("2026-10-05", { type: "weekly", weekdays: [8] }, "2026-12-31")).toMatch(/星期/);
  });

  it("範圍內沒有符合的日期", () => {
    // 週二到週三之間只選週一
    expect(validateRecurrence("2026-10-06", weekly, "2026-10-07")).toMatch(/沒有符合/);
  });

  it("範圍太長被擋", () => {
    expect(validateRecurrence("2026-10-05", weekly, "2028-10-05")).toMatch(/400 天/);
  });

  it(`超過 ${MAX_OCCURRENCES} 筆被擋`, () => {
    const everyDay: RecurrenceRule = { type: "weekly", weekdays: [1, 2, 3, 4, 5, 6, 7] };
    expect(validateRecurrence("2026-10-05", everyDay, "2027-04-05")).toMatch(/最多建立 120 筆/);
    expect(validateRecurrence("2026-10-05", everyDay, "2027-02-01")).toBeNull();
  });
});

describe("describeRecurrence", () => {
  it("每週", () => {
    expect(describeRecurrence({ type: "weekly", weekdays: [1, 3] }, "2026-12-31")).toBe("每週一、週三,到 2026-12-31");
    expect(describeRecurrence({ type: "weekly", weekdays: [1, 2, 3, 4, 5] }, "2026-12-31")).toBe("每週一至週五,到 2026-12-31");
  });

  it("每月", () => {
    expect(describeRecurrence({ type: "monthly" }, "2027-03-01")).toBe("每月同一天,到 2027-03-01");
  });
});
