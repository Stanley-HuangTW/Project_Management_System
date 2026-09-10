import { describe, expect, it } from "vitest";
import { computeBoardCost, plannedFraction, type CostItemInput } from "./boardCost";

function task(overrides: Partial<CostItemInput> = {}): CostItemInput {
  return {
    id: "t",
    name: "t",
    plannedLabour: 0,
    plannedDirect: 0,
    actualLabour: 0,
    actualDirect: 0,
    fractionDone: 0,
    plannedStart: new Date("2026-01-01"),
    plannedEnd: new Date("2026-01-11"),
    ...overrides,
  };
}

describe("plannedFraction", () => {
  it("is nothing before the task was due to start", () => {
    expect(plannedFraction(task(), new Date("2025-12-01"))).toBe(0);
  });

  it("is all of it once the planned finish has passed", () => {
    expect(plannedFraction(task(), new Date("2026-02-01"))).toBe(1);
  });

  it("runs straight-line across the span", () => {
    expect(plannedFraction(task(), new Date("2026-01-06"))).toBeCloseTo(0.5, 6);
  });

  it("is nothing for a task the plan never dated", () => {
    expect(plannedFraction(task({ plannedStart: null, plannedEnd: null }), new Date("2026-01-06"))).toBe(0);
  });
});

describe("computeBoardCost", () => {
  it("keeps 人力 and 直接費用 apart in both the plan and the actual", () => {
    const summary = computeBoardCost(
      [
        task({ plannedLabour: 24000, plannedDirect: 100000, actualLabour: 30000, actualDirect: 90000 }),
        task({ plannedLabour: 6000, plannedDirect: 0, actualLabour: 0, actualDirect: 0 }),
      ],
      new Date("2026-01-01")
    );
    expect(summary.planned).toEqual({ labour: 30000, direct: 100000, total: 130000 });
    expect(summary.actual).toEqual({ labour: 30000, direct: 90000, total: 120000 });
  });

  it("earns value in proportion to what is actually done", () => {
    const summary = computeBoardCost(
      [task({ plannedLabour: 1000, fractionDone: 0.25 }), task({ plannedLabour: 1000, fractionDone: 1 })],
      new Date("2026-01-01")
    );
    expect(summary.evm.ev).toBe(1250);
  });

  it("calls out a task that cost more than the work on it was worth", () => {
    const summary = computeBoardCost(
      [task({ plannedDirect: 1000, fractionDone: 0.5, actualDirect: 900 })],
      new Date("2026-01-01")
    );
    expect(summary.rows[0].earned).toBe(500);
    expect(summary.rows[0].overrun).toBe(400);
  });

  it("reads PV off the plan's own dates, so mid-span is half the budget", () => {
    const summary = computeBoardCost([task({ plannedDirect: 1000 })], new Date("2026-01-06"));
    expect(summary.evm.pv).toBeCloseTo(500, 6);
    // Nothing done, so behind schedule by exactly the value that should have
    // been earned by now.
    expect(summary.evm.scheduleVariance).toBeCloseTo(-500, 6);
  });

  it("has nothing to say about a board with no tasks", () => {
    const summary = computeBoardCost([], new Date("2026-01-01"));
    expect(summary.evm.bac).toBe(0);
    expect(summary.evm.cpi).toBeNull();
    expect(summary.evm.spi).toBeNull();
  });
});
