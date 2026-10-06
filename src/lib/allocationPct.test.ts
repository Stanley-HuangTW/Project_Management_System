import { describe, expect, it } from "vitest";
import { normalizeAllocationPct } from "./allocationPct";

describe("normalizeAllocationPct", () => {
  it("1% 就是 1%,不再被進位到 5 的倍數", () => {
    expect(normalizeAllocationPct(1)).toBe(1);
    expect(normalizeAllocationPct(2)).toBe(2);
    expect(normalizeAllocationPct(7)).toBe(7);
    expect(normalizeAllocationPct(33)).toBe(33);
  });

  it("小數四捨五入成整數", () => {
    expect(normalizeAllocationPct(12.4)).toBe(12);
    expect(normalizeAllocationPct(12.6)).toBe(13);
  });

  it("夾在 1–100 之間", () => {
    expect(normalizeAllocationPct(0)).toBe(1);
    expect(normalizeAllocationPct(-5)).toBe(1);
    expect(normalizeAllocationPct(100)).toBe(100);
    expect(normalizeAllocationPct(250)).toBe(100);
  });
});
