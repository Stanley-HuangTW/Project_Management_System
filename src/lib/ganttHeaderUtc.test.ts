import { describe, expect, it } from "vitest";
import { buildHeaderSegmentsUtc, isoWeekNumberUtc, mondayOfWeekUtc } from "./ganttHeaderUtc";

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** 從 start 起連續 n 天。 */
const run = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(d(start).getTime() + i * 86_400_000));

describe("isoWeekNumberUtc / mondayOfWeekUtc", () => {
  it("ISO 週數:跨年那幾天、週日算上一週", () => {
    expect(isoWeekNumberUtc(d("2026-11-16"))).toBe(47);
    expect(isoWeekNumberUtc(d("2026-11-22"))).toBe(47); // 週日還是第 47 週
    expect(isoWeekNumberUtc(d("2026-11-23"))).toBe(48);
    expect(isoWeekNumberUtc(d("2026-01-01"))).toBe(1);
    expect(isoWeekNumberUtc(d("2027-01-01"))).toBe(53); // 2027-01-01 是週五,屬於 2026 的第 53 週
  });

  it("週一就是自己、週日退 6 天", () => {
    expect(mondayOfWeekUtc(d("2026-11-16"))).toBe("2026-11-16");
    expect(mondayOfWeekUtc(d("2026-11-22"))).toBe("2026-11-16");
    expect(mondayOfWeekUtc(d("2026-11-19"))).toBe("2026-11-16");
  });
});

describe("buildHeaderSegmentsUtc", () => {
  // 11-14(週六)~ 11-30:頭是半週、尾是不滿月
  const days = run("2026-11-14", 17);

  it("日:一天一格,標籤是 月/日", () => {
    const segs = buildHeaderSegmentsUtc(days, "day");
    expect(segs).toHaveLength(17);
    expect(segs[0]).toEqual({ key: "2026-11-14", label: "11/14", days: 1 });
  });

  it("週:一週一格(週一起算),第一格只有頭那 2 天,標籤與第幾週寫在格子裡", () => {
    const segs = buildHeaderSegmentsUtc(days, "week");
    expect(segs.map((s) => [s.key, s.days])).toEqual([
      ["2026-11-14", 2], // 週六、週日
      ["2026-11-16", 7],
      ["2026-11-23", 7],
      ["2026-11-30", 1],
    ]);
    expect(segs[1].label).toBe("11/16");
    expect(segs[1].sublabel).toBe("第47週");
    expect(segs.reduce((n, s) => n + s.days, 0)).toBe(17);
  });

  it("月:一個月一格,標籤是 年/月,天數照期間內實際有幾天", () => {
    const segs = buildHeaderSegmentsUtc(run("2026-11-25", 12), "month");
    expect(segs.map((s) => [s.label, s.days])).toEqual([
      ["2026/11", 6],
      ["2026/12", 6],
    ]);
    expect(segs[0].sublabel).toBeUndefined();
  });

  it("跨年:年份跟著標籤走", () => {
    const segs = buildHeaderSegmentsUtc(run("2026-12-30", 5), "month");
    expect(segs.map((s) => s.label)).toEqual(["2026/12", "2027/1"]);
  });

  it("沒有日期就沒有格子", () => {
    expect(buildHeaderSegmentsUtc([], "week")).toEqual([]);
    expect(buildHeaderSegmentsUtc([], "month")).toEqual([]);
  });
});
