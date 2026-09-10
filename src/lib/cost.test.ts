import { describe, expect, it } from "vitest";
import { labourCost, computeEvm, formatIndex, addCost, makeCost, ZERO_COST } from "./cost";

describe("labourCost", () => {
  it("turns an allocation into money", () => {
    // 10 working days at 50% of an 8-hour day = 40 hours at 600/hour.
    expect(labourCost(10, 50, 600, 8)).toBe(24000);
  });

  it("is zero when any part of it is missing", () => {
    expect(labourCost(10, 50, 0, 8)).toBe(0);
    expect(labourCost(0, 50, 600, 8)).toBe(0);
    expect(labourCost(10, 0, 600, 8)).toBe(0);
  });
});

describe("addCost", () => {
  it("keeps 人力 and 直接費用 apart while summing both", () => {
    const sum = addCost(makeCost(1000, 500), makeCost(200, 300));
    expect(sum).toEqual({ labour: 1200, direct: 800, total: 2000 });
  });

  it("adding nothing changes nothing", () => {
    expect(addCost(makeCost(50, 60), ZERO_COST)).toEqual({ labour: 50, direct: 60, total: 110 });
  });
});

describe("computeEvm", () => {
  it("reports a project that is over cost and behind schedule", () => {
    // Half the budget's worth of work done, but 60% of the money spent and
    // the plan expected 70% done by now.
    const r = computeEvm({ bac: 1000, pv: 700, ev: 500, ac: 600 });
    expect(r.costVariance).toBe(-100);
    expect(r.scheduleVariance).toBe(-200);
    expect(r.cpi).toBeCloseTo(0.833, 3);
    expect(r.spi).toBeCloseTo(0.714, 3);
    expect(r.eac).toBeCloseTo(1200, 6);
  });

  it("reports a project running under cost and ahead", () => {
    const r = computeEvm({ bac: 1000, pv: 400, ev: 500, ac: 450 });
    expect(r.costVariance).toBe(50);
    expect(r.scheduleVariance).toBe(100);
    expect(r.cpi!).toBeGreaterThan(1);
    expect(r.spi!).toBeGreaterThan(1);
  });

  it("refuses to invent an index before anything has happened", () => {
    const r = computeEvm({ bac: 1000, pv: 0, ev: 0, ac: 0 });
    expect(r.cpi).toBeNull();
    expect(r.spi).toBeNull();
    expect(r.eac).toBeNull();
    expect(formatIndex(r.cpi)).toBe("—");
  });
});

describe("formatIndex", () => {
  it("shows two decimals", () => {
    expect(formatIndex(0.8333)).toBe("0.83");
    expect(formatIndex(1)).toBe("1.00");
  });
});
