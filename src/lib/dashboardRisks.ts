import type { RiskKind, RiskStatus } from "@prisma/client";
import { riskBand, riskScore, sortRisks } from "./riskRegister";

/**
 * 儀表板「未結案的風險與問題」:風險登記冊(風險 / 問題分頁、Mantis 同步來的問題)裡還沒結案的那些,
 * 讓使用者一眼看到目前還有哪些事沒做完。純邏輯,不碰 Prisma。
 */

export type OpenRiskInput = {
  id: string;
  boardId: string;
  kind: RiskKind;
  status: RiskStatus;
  title: string;
  probability: number;
  impact: number;
  ownerId: string | null;
  ownerName: string | null;
  /** "YYYY-MM-DD",對策的到期日。 */
  dueDate: string | null;
  mantisId: number | null;
  mantisUrl: string | null;
  createdAt: string;
  /** 申請結案之後,還沒同意的審核人(沒有在審核中就是空的)。 */
  pendingReviewerIds: string[];
};

export type OpenRiskRow = OpenRiskInput & {
  boardName: string;
  score: number;
  bandKey: "low" | "medium" | "high" | "critical";
  bandLabel: string;
  /** 到期日已經過了、還沒結案。 */
  overdue: boolean;
};

/** 還沒結案的(未處理、處理中、待審核),最嚴重的在最前面(同分的先建立的在前)。 */
export function toOpenRiskRows(entries: OpenRiskInput[], boardNameOf: Map<string, string>, today: string): OpenRiskRow[] {
  return sortRisks(entries.filter((e) => e.status !== "CLOSED")).map((e) => {
    const score = riskScore(e.probability, e.impact);
    const band = riskBand(score);
    return {
      ...e,
      boardName: boardNameOf.get(e.boardId) ?? "",
      score,
      bandKey: band.key,
      bandLabel: band.label,
      overdue: !!e.dueDate && e.dueDate < today,
    };
  });
}

/** 跟這幾個人有關:他們是負責人,或是正在等他們同意結案的審核人。 */
export function relatedToUsers(row: Pick<OpenRiskInput, "ownerId" | "pendingReviewerIds">, userIds: ReadonlySet<string>): boolean {
  return (row.ownerId !== null && userIds.has(row.ownerId)) || row.pendingReviewerIds.some((id) => userIds.has(id));
}

export type OpenRiskSummary = { total: number; critical: number; high: number; overdue: number; risks: number; issues: number };

export function summariseOpenRisks(rows: OpenRiskRow[]): OpenRiskSummary {
  return {
    total: rows.length,
    critical: rows.filter((r) => r.bandKey === "critical").length,
    high: rows.filter((r) => r.bandKey === "high").length,
    overdue: rows.filter((r) => r.overdue).length,
    risks: rows.filter((r) => r.kind === "RISK").length,
    issues: rows.filter((r) => r.kind === "ISSUE").length,
  };
}
