import { describe, expect, it } from "vitest";
import { computeProgressCurve, toPercent, type CurveTask } from "./progressCurve";

function task(baselineEnd: string | null, scheduledEnd: string | null, isDone = false): CurveTask {
  return { baselineEnd, scheduledEnd, isDone };
}

describe("computeProgressCurve", () => {
  it("counts each task from the week it finishes onwards", () => {
    const curve = computeProgressCurve(
      [task("2026-01-05", "2026-01-05", true), task("2026-01-19", "2026-01-19")],
      "2026-02-01"
    );
    expect(curve.total).toBe(2);
    expect(curve.points[0]).toEqual({ iso: "2026-01-05", planned: 1, scheduled: 1, actual: 1 });
    // The curve runs to today, which is later than either finish here.
    expect(curve.points.at(-1)).toEqual({ iso: "2026-02-01", planned: 2, scheduled: 2, actual: 1 });
  });

  it("shows the slip as a gap between 計畫 and 目前排程", () => {
    const curve = computeProgressCurve([task("2026-01-05", "2026-02-02")], "2026-01-05");
    const atPlan = curve.points.find((p) => p.iso === "2026-01-05")!;
    expect(atPlan.planned).toBe(1);
    expect(atPlan.scheduled).toBe(0);
    expect(curve.points.at(-1)!.scheduled).toBe(1);
  });

  it("stops the 實際 line at today", () => {
    const curve = computeProgressCurve(
      [task("2026-01-05", "2026-01-05", true), task("2026-03-02", "2026-03-02", true)],
      "2026-01-10"
    );
    expect(curve.points[0].actual).toBe(1);
    expect(curve.points.at(-1)!.actual).toBeNull();
  });

  it("counts only finished tasks as 實際", () => {
    const curve = computeProgressCurve(
      [task("2026-01-05", "2026-01-05", false), task("2026-01-05", "2026-01-05", true)],
      "2026-02-01"
    );
    expect(curve.points[0]).toMatchObject({ scheduled: 2, actual: 1 });
  });

  it("reaches today even when every date is in the past", () => {
    const curve = computeProgressCurve([task("2026-01-05", "2026-01-05", true)], "2026-03-02");
    expect(curve.points.at(-1)!.iso).toBe("2026-03-02");
  });

  it("says so when nothing carries a baseline", () => {
    const curve = computeProgressCurve([task(null, "2026-01-05")], "2026-01-05");
    expect(curve.hasBaseline).toBe(false);
    expect(curve.points[0].planned).toBe(0);
  });

  it("has nothing to draw without tasks or dates", () => {
    expect(computeProgressCurve([], "2026-01-05").points).toEqual([]);
    expect(computeProgressCurve([task(null, null)], "2026-01-05").points).toEqual([]);
  });
});

describe("toPercent", () => {
  it("scales counts so any board size reads the same", () => {
    expect(toPercent(1, 3)).toBe(33.3);
    expect(toPercent(3, 3)).toBe(100);
    expect(toPercent(0, 0)).toBe(0);
  });
});
