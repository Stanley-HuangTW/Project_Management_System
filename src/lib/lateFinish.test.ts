import { describe, expect, it } from "vitest";
import { lateFinishOf } from "./lateFinish";

describe("lateFinishOf", () => {
  it("預定 5/20、5/30 才完成:晚 10 天", () => {
    expect(lateFinishOf("2026-05-20", "2026-05-30T03:00:00.000Z")).toEqual({ plannedEnd: "2026-05-20", actualDate: "2026-05-30", daysLate: 10 });
  });

  it("日期用台灣時間算:UTC 5/20 17:00 已經是台灣 5/21", () => {
    expect(lateFinishOf("2026-05-20", "2026-05-20T17:00:00.000Z")).toEqual({ plannedEnd: "2026-05-20", actualDate: "2026-05-21", daysLate: 1 });
  });

  it("當天完成或提早完成不算晚", () => {
    expect(lateFinishOf("2026-05-20", "2026-05-20T05:00:00.000Z")).toBeNull();
    expect(lateFinishOf("2026-05-20", "2026-05-18T05:00:00.000Z")).toBeNull();
  });

  it("缺資料或格式不對回 null", () => {
    expect(lateFinishOf(null, "2026-05-30T03:00:00.000Z")).toBeNull();
    expect(lateFinishOf("2026-05-20", null)).toBeNull();
    expect(lateFinishOf("not a date", "2026-05-30T03:00:00.000Z")).toBeNull();
  });

  it("結束日帶時間也可以(只取日期)", () => {
    expect(lateFinishOf("2026-05-20T00:00:00.000Z", "2026-05-22T01:00:00.000Z")?.daysLate).toBe(2);
  });
});
