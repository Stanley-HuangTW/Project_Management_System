import { describe, expect, it } from "vitest";
import { dayDiff, describeDateChange } from "./dateChange";

describe("dayDiff", () => {
  it("後 − 前的日曆天,跨月、跨年都對", () => {
    expect(dayDiff("2026-11-10", "2026-11-17")).toBe(7);
    expect(dayDiff("2026-12-30", "2027-01-02")).toBe(3);
    expect(dayDiff("2026-11-17", "2026-11-10")).toBe(-7);
  });
  it("不是日期就 null", () => {
    expect(dayDiff("abc", "2026-11-10")).toBeNull();
  });
});

describe("describeDateChange", () => {
  it("兩邊都沒有日期:不用提示", () => {
    expect(describeDateChange(null, null)).toBeNull();
    expect(describeDateChange("", undefined)).toBeNull();
  });
  it("沒動:只寫上次設定的日期(帶星期)", () => {
    expect(describeDateChange("2026-11-10", "2026-11-10")).toEqual({ savedLabel: "2026-11-10(週二)", adjusted: null });
  });
  it("往後調:延後幾天", () => {
    expect(describeDateChange("2026-11-10", "2026-11-17")).toEqual({
      savedLabel: "2026-11-10(週二)",
      adjusted: { label: "2026-11-17(週二)", delta: "延後 7 天" },
    });
  });
  it("往前調:提前幾天", () => {
    expect(describeDateChange("2026-11-10", "2026-11-08")?.adjusted?.delta).toBe("提前 2 天");
  });
  it("清掉:已清除;原本沒設:上次未設定,沒有天數", () => {
    expect(describeDateChange("2026-11-10", null)?.adjusted).toEqual({ label: "已清除", delta: "" });
    expect(describeDateChange(null, "2026-11-10")).toEqual({
      savedLabel: "未設定",
      adjusted: { label: "2026-11-10(週二)", delta: "" },
    });
  });
});
