import type { RiskStatus } from "@prisma/client";
import { clampLevel } from "@/lib/riskRegister";

/**
 * EMV — 期望貨幣價值:機率 × 發生時的金額。
 *
 * The register already ranks risks 1-25. That says which to talk about first;
 * it cannot say how much money to set aside, because a rank is not a currency.
 * EMV is the number that answers 應變準備金該編多少 — until now that figure was
 * a guess with no arithmetic behind it.
 */

/**
 * 1-5 的機率級距換算成百分比。
 *
 * Spelled out as a table rather than a formula because these are a judgement
 * the organisation is making, not a mathematical fact — and an assumption that
 * drives a reserve should be readable, arguable, and in one place.
 */
export const PROBABILITY_BY_LEVEL: Record<number, number> = {
  1: 10,
  2: 30,
  3: 50,
  4: 70,
  5: 90,
};

export const PROBABILITY_LABELS: Record<number, string> = {
  1: "很低",
  2: "低",
  3: "中",
  4: "高",
  5: "很高",
};

export type EmvRisk = {
  status: RiskStatus;
  probability: number;
  /** An explicit percentage overrides the band — see resolveProbability. */
  probabilityPct: number | null;
  costImpact: number | null;
};

/**
 * The probability to multiply by, as a fraction.
 *
 * An explicit percentage wins where somebody has one: "we think it's about
 * 15%" is better information than "medium", and forcing it into a five-step
 * band would throw that away.
 */
export function resolveProbability(risk: Pick<EmvRisk, "probability" | "probabilityPct">): number {
  if (risk.probabilityPct !== null && Number.isFinite(risk.probabilityPct)) {
    return Math.min(100, Math.max(0, risk.probabilityPct)) / 100;
  }
  return PROBABILITY_BY_LEVEL[clampLevel(risk.probability)] / 100;
}

/** 機率 × 金額. Null when nobody has said what it would cost. */
export function riskEmv(risk: EmvRisk): number | null {
  if (risk.costImpact === null || !Number.isFinite(risk.costImpact)) return null;
  return Math.round(resolveProbability(risk) * risk.costImpact);
}

export type EmvSummary = {
  /** EMV of everything still live — 未處理 and 處理中. */
  total: number;
  /** The worst case: every live risk happens, at full cost. */
  worstCase: number;
  /** How many live risks carry a cost figure, and how many do not. The second
   *  number is the honest caveat on the first: a total that silently omits
   *  half the register reads far too comfortable. */
  priced: number;
  unpriced: number;
  /** 已結案的不列入 — they are no longer things that might happen. */
  closed: number;
};

export function summarizeEmv(risks: EmvRisk[]): EmvSummary {
  const live = risks.filter((r) => r.status !== "CLOSED");
  const priced = live.filter((r) => r.costImpact !== null && Number.isFinite(r.costImpact));

  return {
    total: priced.reduce((sum, r) => sum + (riskEmv(r) ?? 0), 0),
    worstCase: priced.reduce((sum, r) => sum + (r.costImpact ?? 0), 0),
    priced: priced.length,
    unpriced: live.length - priced.length,
    closed: risks.length - live.length,
  };
}
