import { describe, expect, it } from "vitest";
import { riskScore, riskBand, clampLevel, sortRisks, riskLinkTag, riskKindLabel } from "./riskRegister";

describe("riskScore", () => {
  it("is 機率 × 衝擊", () => {
    expect(riskScore(4, 5)).toBe(20);
    expect(riskScore(1, 1)).toBe(1);
  });

  it("clamps anything outside 1-5 instead of scoring it", () => {
    expect(riskScore(9, 9)).toBe(25);
    expect(riskScore(0, 3)).toBe(3);
    expect(clampLevel(Number.NaN)).toBe(1);
  });
});

describe("riskBand", () => {
  it("puts the likely-and-painful corner in 極高", () => {
    expect(riskBand(riskScore(5, 5)).key).toBe("critical");
    expect(riskBand(riskScore(3, 5)).key).toBe("critical");
  });

  it("bands the middle and the harmless corner", () => {
    expect(riskBand(riskScore(3, 3)).key).toBe("high");
    expect(riskBand(riskScore(2, 2)).key).toBe("medium");
    expect(riskBand(riskScore(1, 3)).key).toBe("low");
  });
});

describe("sortRisks", () => {
  const risk = (title: string, probability: number, impact: number, status: "OPEN" | "CLOSED", createdAt = "2026-01-01") =>
    ({ title, probability, impact, status, createdAt }) as const;

  it("puts the worst live entry first", () => {
    const sorted = sortRisks([risk("小", 1, 2, "OPEN"), risk("大", 5, 5, "OPEN"), risk("中", 3, 3, "OPEN")]);
    expect(sorted.map((r) => r.title)).toEqual(["大", "中", "小"]);
  });

  it("sinks closed entries however bad they were", () => {
    const sorted = sortRisks([risk("已結案的大事", 5, 5, "CLOSED"), risk("還沒處理的小事", 1, 1, "OPEN")]);
    expect(sorted.map((r) => r.title)).toEqual(["還沒處理的小事", "已結案的大事"]);
  });

  it("breaks a tie by age, oldest first", () => {
    const sorted = sortRisks([
      risk("新的", 3, 3, "OPEN", "2026-05-01"),
      risk("舊的", 3, 3, "OPEN", "2026-01-01"),
    ]);
    expect(sorted.map((r) => r.title)).toEqual(["舊的", "新的"]);
  });
});

describe("riskLinkTag", () => {
  it("labels a Mantis-synced entry by its Mantis number, whatever its kind", () => {
    expect(riskLinkTag({ kind: "ISSUE", mantisId: 123 })).toBe("Mantis #123");
    expect(riskLinkTag({ kind: "RISK", mantisId: 7 })).toBe("Mantis #7");
  });

  it("labels the hand-written ones as 風險 or 議題", () => {
    expect(riskLinkTag({ kind: "RISK", mantisId: null })).toBe("風險");
    expect(riskLinkTag({ kind: "ISSUE", mantisId: null })).toBe("議題");
  });
});

describe("riskKindLabel", () => {
  it("calls a Mantis-synced entry 問題, whatever its stored kind", () => {
    expect(riskKindLabel({ kind: "ISSUE", mantisId: 123 })).toBe("問題");
    expect(riskKindLabel({ kind: "RISK", mantisId: 7 })).toBe("問題");
  });

  it("keeps 風險 and 議題 for the hand-written ones", () => {
    expect(riskKindLabel({ kind: "RISK", mantisId: null })).toBe("風險");
    expect(riskKindLabel({ kind: "ISSUE", mantisId: null })).toBe("議題");
  });
});
