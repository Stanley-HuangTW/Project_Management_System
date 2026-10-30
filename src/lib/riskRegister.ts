import type { RiskKind, RiskStatus } from "@prisma/client";

/**
 * 機率 × 衝擊, the register's whole ranking. Both are 1-5, so the score runs
 * 1-25 and the bands below are the usual 5×5 matrix read diagonally.
 */
export function riskScore(probability: number, impact: number): number {
  return clampLevel(probability) * clampLevel(impact);
}

/** Keeps a hand-edited row from scoring 0 or 400. */
export function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

export type RiskBand = { key: "low" | "medium" | "high" | "critical"; label: string; color: string };

const BANDS: RiskBand[] = [
  { key: "low", label: "低", color: "#00c875" },
  { key: "medium", label: "中", color: "#fdab3d" },
  { key: "high", label: "高", color: "#e2445c" },
  { key: "critical", label: "極高", color: "#7f1d1d" },
];

/** Which band a score falls in. The cut-offs are the standard 5×5 ones:
 *  anything scoring 15+ is a "both likely and painful" corner. */
export function riskBand(score: number): RiskBand {
  if (score >= 15) return BANDS[3];
  if (score >= 8) return BANDS[2];
  if (score >= 4) return BANDS[1];
  return BANDS[0];
}

export const RISK_KIND_LABELS: Record<RiskKind, string> = {
  RISK: "風險",
  ISSUE: "議題",
};

/** 在選單、行事曆上標示一筆風險/議題是什麼:從 Mantis 同步來的標 Mantis 編號,其他標風險或議題。 */
export function riskLinkTag(r: { kind: RiskKind; mantisId: number | null }): string {
  return r.mantisId !== null ? `Mantis #${r.mantisId}` : RISK_KIND_LABELS[r.kind];
}

/** 風險登記冊「類型」欄的字:從 Mantis 同步來的叫「問題」(跟「問題」分頁、對話 # 選單一致),其他是風險或議題。 */
export function riskKindLabel(r: { kind: RiskKind; mantisId: number | null }): string {
  return r.mantisId !== null ? "問題" : RISK_KIND_LABELS[r.kind];
}

export const RISK_STATUS_LABELS: Record<RiskStatus, string> = {
  OPEN: "未處理",
  MITIGATING: "處理中",
  PENDING_REVIEW: "待審核",
  CLOSED: "已結案",
};

export type SortableRisk = {
  status: RiskStatus;
  probability: number;
  impact: number;
  createdAt: string;
};

/**
 * Register order: what still needs attention, worst first.
 *
 * Closed entries sink to the bottom whatever they scored — a closed 25 is
 * history, and leaving it at the top pushes the live ones off the screen.
 */
export function sortRisks<T extends SortableRisk>(risks: T[]): T[] {
  return [...risks].sort((a, b) => {
    const closed = Number(a.status === "CLOSED") - Number(b.status === "CLOSED");
    if (closed !== 0) return closed;
    const score = riskScore(b.probability, b.impact) - riskScore(a.probability, a.impact);
    if (score !== 0) return score;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}
