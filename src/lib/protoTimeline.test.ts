import { describe, expect, it } from "vitest";
import type { WeekColumn } from "@/lib/workload";
import { buildTimelineColumns, columnIndexForDate, columnPeaks, groupColumns, pixelForDate } from "./protoTimeline";

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// 2026-10-26(週一)起三週:10/26、11/2、11/9(跨 10、11 月)
const weeks: WeekColumn[] = [
  { start: d("2026-10-26"), label: "10/26", monthLabel: "2026/10", isMonthStart: true },
  { start: d("2026-11-02"), label: "11/2", monthLabel: "2026/11", isMonthStart: true },
  { start: d("2026-11-09"), label: "11/9", monthLabel: "2026/11", isMonthStart: false },
];

describe("buildTimelineColumns", () => {
  it("週:就是原本的週欄位,每欄 7 天", () => {
    const cols = buildTimelineColumns(weeks, "week");
    expect(cols).toHaveLength(3);
    expect(cols[0].label).toBe("10/26");
    expect(cols[0].end.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(cols.map((c) => c.isGroupStart)).toEqual([true, true, false]);
  });

  it("日:從第一週的週一到最後一週的週日,一天一欄,每月 1 號是分組開頭", () => {
    const cols = buildTimelineColumns(weeks, "day");
    expect(cols).toHaveLength(21);
    expect(cols[0].start.toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(cols[20].end.toISOString().slice(0, 10)).toBe("2026-11-15");
    expect(cols[0].label).toBe("26");
    expect(cols[0].title).toBe("2026-10-26(週一)");
    const starts = cols.map((c, i) => (c.isGroupStart ? i : -1)).filter((i) => i >= 0);
    expect(starts).toEqual([0, 6]); // 10/26 與 11/1
    expect(groupColumns(cols)).toEqual([
      { label: "2026/10", count: 6 },
      { label: "2026/11", count: 15 },
    ]);
  });

  it("月:每個月一欄,頭尾的月份只算期間內的那幾天,跨年時分組開頭在 1 月", () => {
    const cols = buildTimelineColumns(weeks, "month");
    expect(cols.map((c) => c.label)).toEqual(["10月", "11月"]);
    expect(cols[0].start.toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(cols[0].end.toISOString().slice(0, 10)).toBe("2026-10-31");
    expect(cols[1].end.toISOString().slice(0, 10)).toBe("2026-11-15");

    const longer = buildTimelineColumns(
      [
        { start: d("2026-12-21"), label: "12/21", monthLabel: "2026/12", isMonthStart: true },
        { start: d("2027-01-04"), label: "1/4", monthLabel: "2027/1", isMonthStart: true },
      ],
      "month"
    );
    expect(longer.map((c) => [c.label, c.group, c.isGroupStart])).toEqual([
      ["12月", "2026", true],
      ["1月", "2027", true],
    ]);
  });

  it("沒有週欄位就沒有欄", () => {
    expect(buildTimelineColumns([], "day")).toEqual([]);
    expect(buildTimelineColumns([], "month")).toEqual([]);
  });
});

describe("columnIndexForDate / pixelForDate", () => {
  const cols = buildTimelineColumns(weeks, "week");

  it("日期對到它所在的欄,頭尾之外夾到第一 / 最後一欄", () => {
    expect(columnIndexForDate(d("2026-10-26"), cols)).toBe(0);
    expect(columnIndexForDate(d("2026-11-01"), cols)).toBe(0);
    expect(columnIndexForDate(d("2026-11-02"), cols)).toBe(1);
    expect(columnIndexForDate(d("2026-01-01"), cols)).toBe(0);
    expect(columnIndexForDate(d("2027-01-01"), cols)).toBe(2);
  });

  it("位置 = 欄起點 + 欄內的比例;期間外是 null", () => {
    expect(pixelForDate(d("2026-10-26"), cols, 26)).toBe(0);
    expect(pixelForDate(d("2026-11-02"), cols, 26)).toBe(26);
    expect(pixelForDate(d("2026-10-29"), cols, 70)).toBeCloseTo((3 / 7) * 70, 5);
    expect(pixelForDate(d("2026-10-25"), cols, 26)).toBeNull();
    expect(pixelForDate(d("2026-11-16"), cols, 26)).toBeNull();
  });

  it("月刻度:月初到月底的位置佔滿一欄", () => {
    const months = buildTimelineColumns(weeks, "month");
    expect(pixelForDate(d("2026-11-01"), months, 72)).toBe(72);
    expect(pixelForDate(d("2026-11-08"), months, 72)).toBeCloseTo(72 + (7 / 15) * 72, 5);
  });
});

describe("columnPeaks", () => {
  const daily = { "2026-10-27": 100, "2026-10-28": 140, "2026-11-03": 60 };

  it("週:每週取最滿的一天", () => {
    expect(columnPeaks(daily, buildTimelineColumns(weeks, "week"))).toEqual([140, 60, 0]);
  });

  it("月:每月取最滿的一天;日:就是當天", () => {
    expect(columnPeaks(daily, buildTimelineColumns(weeks, "month"))).toEqual([140, 60]);
    const days = columnPeaks(daily, buildTimelineColumns(weeks, "day"));
    expect(days[1]).toBe(100); // 10/27
    expect(days[2]).toBe(140); // 10/28
    expect(days[0]).toBe(0);
  });

  it("沒有資料的樣機全部是 0", () => {
    expect(columnPeaks(undefined, buildTimelineColumns(weeks, "week"))).toEqual([0, 0, 0]);
  });
});
