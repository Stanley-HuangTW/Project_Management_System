import { describe, expect, it } from "vitest";
import { resolveBaselineVariance, describeBaselineDelta } from "./baseline";

const planned = { baselineStart: "2026-08-03", baselineEnd: "2026-08-07", baselineDays: 5 };
const range = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

describe("resolveBaselineVariance", () => {
  it("reports a slip in calendar days, so a weekend does not hide it", () => {
    // Finish moved Friday -> Monday: three calendar days, one working day.
    const variance = resolveBaselineVariance(planned, range("2026-08-03", "2026-08-10"));
    expect(variance?.endDelta).toBe(3);
    expect(variance?.status).toBe("late");
  });

  it("reports finishing early as ahead", () => {
    const variance = resolveBaselineVariance(planned, range("2026-08-03", "2026-08-05"));
    expect(variance?.endDelta).toBe(-2);
    expect(variance?.status).toBe("ahead");
  });

  it("is on time when the finish has not moved, even if the start did", () => {
    const variance = resolveBaselineVariance(planned, range("2026-08-05", "2026-08-07"));
    expect(variance?.startDelta).toBe(2);
    expect(variance?.endDelta).toBe(0);
    expect(variance?.status).toBe("onTime");
  });

  it("is null for an item created after the baseline was taken", () => {
    expect(
      resolveBaselineVariance(
        { baselineStart: null, baselineEnd: null, baselineDays: null },
        range("2026-08-03", "2026-08-07")
      )
    ).toBeNull();
  });

  it("is null when the item has no current dates to compare", () => {
    expect(resolveBaselineVariance(planned, null)).toBeNull();
  });
});

describe("describeBaselineDelta", () => {
  it("words the three outcomes the same way everywhere", () => {
    expect(describeBaselineDelta(3)).toBe("延遲 3 天");
    expect(describeBaselineDelta(-2)).toBe("提前 2 天");
    expect(describeBaselineDelta(0)).toBe("準時");
  });
});
