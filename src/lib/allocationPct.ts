/** 人員分配的投入百分比:四捨五入成整數,夾在 1–100 之間(最小單位 1%)。 */
export function normalizeAllocationPct(pct: number): number {
  return Math.max(1, Math.min(100, Math.round(pct)));
}
