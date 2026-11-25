/**
 * ISSUE TRACKER 案件簽核的規則:結案、Issue 轉 Repair、安排外勤。純函式,不碰資料庫。
 *
 * 簽核人沿用專案管理系統的多階簽核:依「負責人」的主管鏈(組織架構圖)往上,各階同時送審,
 * 都簽了才算核准,任一階退回就是退回。負責人沒有主管時由 ISSUE TRACKER 管理者簽。
 * 申請人自己就是某一階主管時,那一階視為已簽(自己不簽自己的申請,但也不會卡死)。
 */
import { managerChain, clampLevels, type ChainNode } from "@/lib/approvalLevels";
import { canConvertToRepair, type FlowKind, type IssueStage } from "@/lib/issueFlow";

export type IssueApprovalKind = "CLOSE" | "TO_REPAIR" | "FIELD_TRIP";
export type IssueApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELED";
export type IssueApprovalDecision = "APPROVED" | "REJECTED";

export const ISSUE_APPROVAL_KINDS: IssueApprovalKind[] = ["CLOSE", "TO_REPAIR", "FIELD_TRIP"];
export const ISSUE_APPROVAL_LABELS: Record<IssueApprovalKind, string> = {
  CLOSE: "結案簽核",
  TO_REPAIR: "轉維修簽核",
  FIELD_TRIP: "外勤簽核",
};
export const ISSUE_APPROVAL_STATUS_LABELS: Record<IssueApprovalStatus, string> = {
  PENDING: "簽核中",
  APPROVED: "已核准",
  REJECTED: "已退回",
  CANCELED: "已撤回",
};

/** 給畫面的簽核單。 */
export type IssueApprovalDto = {
  id: string;
  kind: IssueApprovalKind;
  status: IssueApprovalStatus;
  caseId: string;
  caseNo: string;
  summary: string;
  requesterName: string | null;
  requestedById: string | null;
  note: string;
  closeStatus: "TC" | "PC" | null;
  createdAt: string;
  decidedAt: string | null;
  steps: { level: number; approverName: string | null; decision: "APPROVED" | "REJECTED" | null; comment: string; decidedByName: string | null }[];
  /** 進度說明(各階誰簽了、誰還沒簽)。 */
  progress: string;
  /** 看的這個人現在可以簽(核准 / 退回)。 */
  canSign: boolean;
  /** 申請人與管理者可以撤回進行中的簽核。 */
  canCancel: boolean;
};

export type ApprovalStepPlan = {
  level: number;
  /** 簽核人;null = 找不到主管,由 ISSUE TRACKER 管理者簽。 */
  approverId: string | null;
  /** 申請人本人就是這一階主管:建立時直接視為已簽。 */
  auto: boolean;
};

/**
 * 這張簽核單要哪些人簽。ownerId = 案件負責人(沒有負責人就用申請人);levels = 系統設定的階數。
 * 主管鏈比設定的階數短就簽到最高那一階;完全沒有主管 → 一階、由管理者簽。
 */
export function planApprovalSteps(args: { ownerId: string | null; requesterId: string; graph: ChainNode[]; levels: number }): ApprovalStepPlan[] {
  const owner = args.ownerId ?? args.requesterId;
  const chain = managerChain(args.graph, owner, clampLevels(args.levels));
  if (chain.length === 0) return [{ level: 1, approverId: null, auto: false }];
  return chain.map((approverId, i) => ({ level: i + 1, approverId, auto: approverId === args.requesterId }));
}

export type SignableStep = { approverId: string | null; decision: IssueApprovalDecision | null };

/**
 * 這個人能不能簽這一階:
 * 簽核人本人、他代簽的主管(副主管)、系統管理員可以;簽核人是 null(找不到主管)時 ISSUE TRACKER 管理者可以。
 * 申請人不能簽自己的申請——系統管理員例外(不然只有一位管理者的公司會卡死)。已經簽過的不能再簽。
 */
export function canSignStep(args: {
  userId: string;
  isSystemAdmin: boolean;
  isIssueManager: boolean;
  requesterId: string | null;
  step: SignableStep;
  /** 這個人可以代為簽核的主管(副主管)。 */
  delegatedFor?: readonly string[];
}): boolean {
  const { step } = args;
  if (step.decision !== null) return false;
  if (args.requesterId === args.userId && !args.isSystemAdmin) return false;
  if (args.isSystemAdmin) return true;
  if (step.approverId === null) return args.isIssueManager;
  return step.approverId === args.userId || (args.delegatedFor?.includes(step.approverId) ?? false);
}

export type ApprovalOutcome = "PENDING" | "APPROVED" | "REJECTED";

/** 各階的決定合起來:任何一階退回 = 退回;全部核准 = 核准;其餘還在簽核中。 */
export function approvalOutcome(steps: { decision: IssueApprovalDecision | null }[]): ApprovalOutcome {
  if (steps.some((s) => s.decision === "REJECTED")) return "REJECTED";
  if (steps.length > 0 && steps.every((s) => s.decision === "APPROVED")) return "APPROVED";
  return "PENDING";
}

/** 這個人簽哪一階:能簽的未簽階裡取最近的那階。 */
export function stepToSign<T extends SignableStep & { level: number }>(
  steps: T[],
  who: { userId: string; isSystemAdmin: boolean; isIssueManager: boolean; requesterId: string | null; delegatedFor?: readonly string[] }
): T | null {
  return [...steps].sort((a, b) => a.level - b.level).find((s) => canSignStep({ ...who, step: s })) ?? null;
}

/**
 * 現在這個案件能不能送這一種簽核(階段與類型的條件);可以回 null,不行回說明。
 * 結案:問題案件在「待 Sales 判斷」或「FAE 評估」(FAE 協助完就結案),維修案件在「維修完成」;
 * 轉維修:同 Issue 轉 Repair 的條件;外勤:還沒結案的案件都可以。
 */
export function approvalPrecondition(kind: IssueApprovalKind, caseKind: FlowKind, stage: IssueStage): string | null {
  if (stage === "CLOSED") return "案件已經結案";
  if (stage === "CLOSING") return "這個案件正在結案簽核中";
  switch (kind) {
    case "CLOSE":
      if (caseKind === "REPAIR") return stage === "REPAIRED" ? null : "維修案件要先到「維修完成」才能申請結案簽核";
      return stage === "SALES_DECISION" || stage === "FAE_REVIEW" ? null : "問題案件要在「FAE 評估」或「待 Sales 判斷」才能申請結案簽核";
    case "TO_REPAIR":
      return canConvertToRepair(caseKind, stage) ? null : "只有「待 Sales 判斷」或「FAE 評估」階段的問題案件可以申請轉成維修";
    case "FIELD_TRIP":
      return null;
  }
}

/** 簽核單給畫面看的進度說明,例如「直屬主管 王大明 已簽;二階主管 陳經理 尚待」。 */
export function stepSummary(steps: { level: number; approverName: string | null; decision: IssueApprovalDecision | null }[], levelLabel: (n: number) => string): string {
  return [...steps]
    .sort((a, b) => a.level - b.level)
    .map((s) => `${s.approverName ? `${levelLabel(s.level)} ${s.approverName}` : "管理者"}${s.decision === "APPROVED" ? " 已簽" : s.decision === "REJECTED" ? " 退回" : " 尚待"}`)
    .join(";");
}
