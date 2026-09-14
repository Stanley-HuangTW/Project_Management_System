import { describe, expect, it } from "vitest";
import { riskEmv, resolveProbability, summarizeEmv, type EmvRisk } from "./riskEmv";

const risk = (over: Partial<EmvRisk> = {}): EmvRisk => ({
  status: "OPEN",
  probability: 3,
  probabilityPct: null,
  costImpact: null,
  ...over,
});

describe("resolveProbability", () => {
  it("maps the 1-5 band to the published percentages", () => {
    expect(resolveProbability(risk({ probability: 1 }))).toBe(0.1);
    expect(resolveProbability(risk({ probability: 3 }))).toBe(0.5);
    expect(resolveProbability(risk({ probability: 5 }))).toBe(0.9);
  });

  it("prefers an explicit percentage — 15% is better information than 中", () => {
    expect(resolveProbability(risk({ probability: 3, probabilityPct: 15 }))).toBe(0.15);
  });

  it("clamps a hand-typed percentage into range", () => {
    expect(resolveProbability(risk({ probabilityPct: 150 }))).toBe(1);
    expect(resolveProbability(risk({ probabilityPct: -20 }))).toBe(0);
  });
});

describe("riskEmv", () => {
  it("multiplies the probability by the money", () => {
    // 中等機率(50%) × 200 萬
    expect(riskEmv(risk({ probability: 3, costImpact: 2_000_000 }))).toBe(1_000_000);
  });

  it("says nothing when nobody has priced it", () => {
    expect(riskEmv(risk({ probability: 5 }))).toBeNull();
  });
});

describe("summarizeEmv", () => {
  it("adds up what the live risks are worth", () => {
    const summary = summarizeEmv([
      risk({ probability: 5, costImpact: 1_000_000 }), // 90% → 900,000
      risk({ probability: 1, costImpact: 1_000_000 }), // 10% → 100,000
    ]);

    expect(summary.total).toBe(1_000_000);
    // 全部都發生的話。
    expect(summary.worstCase).toBe(2_000_000);
    expect(summary.priced).toBe(2);
  });

  it("leaves closed risks out — they are no longer things that might happen", () => {
    const summary = summarizeEmv([
      risk({ status: "CLOSED", probability: 5, costImpact: 5_000_000 }),
      risk({ status: "MITIGATING", probability: 3, costImpact: 1_000_000 }),
    ]);

    expect(summary.total).toBe(500_000);
    expect(summary.closed).toBe(1);
  });

  it("counts 處理中 as live — being worked on is not the same as gone", () => {
    const summary = summarizeEmv([risk({ status: "MITIGATING", probability: 5, costImpact: 100_000 })]);
    expect(summary.total).toBe(90_000);
  });

  it("reports how many live risks carry no price", () => {
    // The caveat on the total: half the register is missing from it.
    const summary = summarizeEmv([
      risk({ probability: 3, costImpact: 1_000_000 }),
      risk({ probability: 5 }),
      risk({ probability: 4 }),
    ]);

    expect(summary.total).toBe(500_000);
    expect(summary.priced).toBe(1);
    expect(summary.unpriced).toBe(2);
  });

  it("is zero, not broken, on an empty register", () => {
    const summary = summarizeEmv([]);
    expect(summary.total).toBe(0);
    expect(summary.unpriced).toBe(0);
  });
});
