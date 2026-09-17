import { describe, it, expect } from "vitest";
import { daysBetween, endFromDays } from "@/lib/rangeDuration";

// 2026-03-09 是週一,3/14-15 是週末。3/11 當國定假日來測。
const HOLIDAYS = new Set(["2026-03-11"]);

describe("算天數", () => {
  it("日曆天含頭尾", () => {
    expect(daysBetween("2026-03-09", "2026-03-09", "calendar")).toBe(1);
    expect(daysBetween("2026-03-09", "2026-03-15", "calendar")).toBe(7);
  });

  it("工作天跳過週末", () => {
    // 3/9(一)~3/15(日):一到五共 5 天。
    expect(daysBetween("2026-03-09", "2026-03-15", "business")).toBe(5);
  });

  it("工作天也跳過國定假日", () => {
    expect(daysBetween("2026-03-09", "2026-03-15", "business", HOLIDAYS)).toBe(4);
  });

  it("結束日早於開始日回 null,不是負數", () => {
    // 回 0 或負數的話,畫面上會顯示一個看起來合理的錯誤天數。
    expect(daysBetween("2026-03-15", "2026-03-09", "calendar")).toBe(null);
  });

  it("日期不合法回 null", () => {
    expect(daysBetween("", "2026-03-09", "calendar")).toBe(null);
    expect(daysBetween("2026-03-09", "not-a-date", "calendar")).toBe(null);
  });
});

describe("從天數推結束日", () => {
  it("日曆天:開始日算第一天", () => {
    expect(endFromDays("2026-03-09", 1, "calendar")).toBe("2026-03-09");
    expect(endFromDays("2026-03-09", 7, "calendar")).toBe("2026-03-15");
  });

  it("工作天:跳過週末", () => {
    // 第 5 個工作天是週五 3/13。
    expect(endFromDays("2026-03-09", 5, "business")).toBe("2026-03-13");
    // 第 6 個要跨過週末,落在下週一 3/16。
    expect(endFromDays("2026-03-09", 6, "business")).toBe("2026-03-16");
  });

  it("工作天:跳過國定假日", () => {
    expect(endFromDays("2026-03-09", 5, "business", HOLIDAYS)).toBe("2026-03-16");
  });

  it("天數小於 1 回 null", () => {
    expect(endFromDays("2026-03-09", 0, "calendar")).toBe(null);
    expect(endFromDays("2026-03-09", -3, "calendar")).toBe(null);
  });

  it("沒有開始日回 null", () => {
    expect(endFromDays("", 5, "calendar")).toBe(null);
  });

  it("推出去再算回來要一致", () => {
    for (const mode of ["calendar", "business"] as const) {
      for (const days of [1, 3, 5, 10, 22]) {
        const end = endFromDays("2026-03-09", days, mode, HOLIDAYS)!;
        expect(daysBetween("2026-03-09", end, mode, HOLIDAYS)).toBe(days);
      }
    }
  });
});
