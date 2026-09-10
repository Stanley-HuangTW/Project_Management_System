import { describe, expect, it } from "vitest";
import { analyzeDelays, type DelayInput } from "./delayAnalysis";

function task(
  id: string,
  plan: [string, string, number],
  actual: [string, string, number],
  preds: string[] = []
): DelayInput {
  return {
    id,
    name: id,
    wbsCode: id,
    baselineStart: new Date(plan[0]),
    baselineEnd: new Date(plan[1]),
    baselineDays: plan[2],
    currentStart: new Date(actual[0]),
    currentEnd: new Date(actual[1]),
    currentDays: actual[2],
    preds: preds.map((predId) => ({ predId, uses: "end" as const })),
  };
}

describe("analyzeDelays", () => {
  it("blames the task that slipped, not the ones it pushed", () => {
    // A started 10 days late; B and C simply followed it.
    const items = [
      task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-11", "2026-01-20", 10]),
      task("B", ["2026-01-11", "2026-01-20", 10], ["2026-01-21", "2026-01-30", 10], ["A"]),
      task("C", ["2026-01-21", "2026-01-30", 10], ["2026-01-31", "2026-02-09", 10], ["B"]),
    ];
    const { culprits, projectDelay } = analyzeDelays(items);
    expect(culprits.map((c) => c.id)).toEqual(["A"]);
    expect(culprits[0].ownDelay).toBe(10);
    expect(projectDelay).toBe(10);
  });

  it("counts how far the slip spread", () => {
    const items = [
      task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-06", "2026-01-15", 10]),
      task("B", ["2026-01-11", "2026-01-20", 10], ["2026-01-16", "2026-01-25", 10], ["A"]),
      task("C", ["2026-01-21", "2026-01-30", 10], ["2026-01-26", "2026-02-04", 10], ["B"]),
    ];
    expect(analyzeDelays(items).culprits[0].downstreamCount).toBe(2);
  });

  it("blames a task that was pushed AND then slipped further", () => {
    // A slipped 5; B was pushed 5 but started 8 late — 3 of that is its own.
    const items = [
      task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-06", "2026-01-15", 10]),
      task("B", ["2026-01-11", "2026-01-20", 10], ["2026-01-19", "2026-01-28", 10], ["A"]),
    ];
    const { culprits } = analyzeDelays(items);
    const b = culprits.find((c) => c.id === "B")!;
    expect(b.inheritedDelay).toBe(5);
    expect(b.ownDelay).toBe(3);
  });

  it("counts a task that started on time but ran long", () => {
    const items = [task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-01", "2026-01-15", 15])];
    const { culprits } = analyzeDelays(items);
    expect(culprits[0].ownDelay).toBe(5);
    expect(culprits[0].daysDelta).toBe(5);
    expect(culprits[0].startDelta).toBe(0);
  });

  it("says nothing about a project running to plan", () => {
    const items = [
      task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-01", "2026-01-10", 10]),
      task("B", ["2026-01-11", "2026-01-20", 10], ["2026-01-11", "2026-01-20", 10], ["A"]),
    ];
    const { culprits, projectDelay } = analyzeDelays(items);
    expect(culprits).toEqual([]);
    expect(projectDelay).toBe(0);
  });

  it("does not blame a task that finished early", () => {
    const items = [task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-01", "2026-01-08", 8])];
    expect(analyzeDelays(items).culprits).toEqual([]);
  });

  it("follows a predecessor's start when the relationship is SS", () => {
    // A finished 10 late but started on time; B waits on its START, so B was
    // pushed by nothing and its own 4-day slip is all its own.
    const items: DelayInput[] = [
      task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-01", "2026-01-20", 20]),
      {
        ...task("B", ["2026-01-01", "2026-01-10", 10], ["2026-01-05", "2026-01-14", 10]),
        preds: [{ predId: "A", uses: "start" }],
      },
    ];
    const b = analyzeDelays(items).culprits.find((c) => c.id === "B")!;
    expect(b.inheritedDelay).toBe(0);
    expect(b.ownDelay).toBe(4);
  });

  it("has nothing to compare without a baseline", () => {
    const items: DelayInput[] = [
      {
        ...task("A", ["2026-01-01", "2026-01-10", 10], ["2026-01-11", "2026-01-20", 10]),
        baselineStart: null,
        baselineEnd: null,
        baselineDays: null,
      },
    ];
    expect(analyzeDelays(items)).toEqual({ projectDelay: 0, culprits: [], noBaseline: true });
  });
});
