import type { RiskKind, RiskStatus, UserRole } from "@prisma/client";
import { RISK_KIND_LABELS, RISK_STATUS_LABELS } from "@/lib/riskRegister";

/**
 * 風險/議題的分工與結案流程(純邏輯,畫面與 server action 共用同一份判斷)。
 *
 *   指派的人(建立者)寫「對策與驗收標準」、指定負責人與審核人;
 *   負責人寫進度更新,做完按「申請結案」→ 待審核;
 *   所有審核人都同意才變成已結案,任何一位退回就回到處理中。
 */

/** 可以由人直接切換的狀態;「待審核」「已結案」只能走申請 → 審核。 */
export const WORKING_STATUSES: RiskStatus[] = ["OPEN", "MITIGATING"];

export function isWorkingStatus(status: RiskStatus): boolean {
  return WORKING_STATUSES.includes(status);
}

export type RiskPermissions = {
  /** 改標題、說明、對策與驗收標準、負責人、審核人…:建立者、審核人、管理者。 */
  canEditContent: boolean;
  /** 寫進度更新:負責人,以及可以編輯內容的人。 */
  canPostUpdate: boolean;
  /** 在「未處理 / 處理中」之間切換。 */
  canSetWorkingStatus: boolean;
  /** 申請結案:負責人(管理者可代)。 */
  canRequestClosure: boolean;
  /** 撤回申請結案,回到處理中。 */
  canWithdrawClosure: boolean;
  /** 同意或退回:輪到你、而且你這一輪還沒同意的審核人。 */
  canReview: boolean;
  /** 已結案的重新開啟。 */
  canReopen: boolean;
  /** 刪除:建立者與管理者。 */
  canDelete: boolean;
};

export type RiskActors = {
  createdById: string | null;
  ownerId: string | null;
  reviewers: { userId: string; approved: boolean }[];
};

export function riskPermissions(args: {
  userId: string;
  role: UserRole;
  status: RiskStatus;
  actors: RiskActors;
}): RiskPermissions {
  const { userId, role, status, actors } = args;
  const isAdmin = role === "ADMIN";
  const isCreator = actors.createdById === userId;
  const isOwner = actors.ownerId === userId;
  const mine = actors.reviewers.find((r) => r.userId === userId);

  const canEditContent = isAdmin || isCreator || !!mine;
  const working = isWorkingStatus(status);
  return {
    canEditContent,
    canPostUpdate: canEditContent || isOwner,
    canSetWorkingStatus: working && (canEditContent || isOwner),
    canRequestClosure: working && (isOwner || isAdmin),
    canWithdrawClosure: status === "PENDING_REVIEW" && (isOwner || canEditContent),
    canReview: status === "PENDING_REVIEW" && !!mine && !mine.approved,
    canReopen: status === "CLOSED" && canEditContent,
    canDelete: isAdmin || isCreator,
  };
}

/**
 * 從 MantisBT 同步來的議題:內容與狀態以 Mantis 為準(下一次同步會蓋回來),所以改內容、改狀態、
 * 走結案流程都不行,也不能刪(刪了下次同步又長回來)。寫進度更新是這邊自己的時間軸,照常可以。
 */
export function mantisReadOnly(base: RiskPermissions): RiskPermissions {
  return {
    ...base,
    canEditContent: false,
    canSetWorkingStatus: false,
    canRequestClosure: false,
    canWithdrawClosure: false,
    canReview: false,
    canReopen: false,
    canDelete: false,
  };
}

/** 有審核人、而且每一位這一輪都同意了。 */
export function allReviewersApproved(reviewers: { approved: boolean }[]): boolean {
  return reviewers.length > 0 && reviewers.every((r) => r.approved);
}

export type RiskSnapshot = {
  kind: RiskKind;
  status: RiskStatus;
  title: string;
  description: string;
  probability: number;
  impact: number;
  costImpact: number | null;
  probabilityPct: number | null;
  mitigation: string;
  ownerId: string | null;
  reviewerIds: string[];
  dueDate: string | null;
  itemId: string | null;
};

const NONE = "—";

/**
 * 兩份內容之間差在哪裡,一個欄位一句話,給「紀錄」用。說明、對策這類長文字只講「修改了」,
 * 不把全文塞進紀錄。
 */
export function describeRiskChanges(
  before: RiskSnapshot,
  after: RiskSnapshot,
  names: { user: (id: string) => string; item: (id: string) => string }
): string[] {
  const out: string[] = [];
  const num = (n: number | null, empty: string) => (n === null ? empty : String(n));
  const user = (id: string | null) => (id ? names.user(id) : "未指定");
  const item = (id: string | null) => (id ? names.item(id) : "未指定");
  const people = (ids: string[]) => (ids.length === 0 ? "無" : ids.map(names.user).join("、"));

  if (before.kind !== after.kind) out.push(`類型:${RISK_KIND_LABELS[before.kind]} → ${RISK_KIND_LABELS[after.kind]}`);
  if (before.status !== after.status) {
    out.push(`狀態:${RISK_STATUS_LABELS[before.status]} → ${RISK_STATUS_LABELS[after.status]}`);
  }
  if (before.title !== after.title) out.push(`標題:「${before.title}」→「${after.title}」`);
  if (before.description !== after.description) out.push("修改了說明");
  if (before.probability !== after.probability) out.push(`機率:${before.probability} → ${after.probability}`);
  if (before.impact !== after.impact) out.push(`衝擊:${before.impact} → ${after.impact}`);
  if (before.costImpact !== after.costImpact) {
    out.push(`金額:${num(before.costImpact, "未估")} → ${num(after.costImpact, "未估")}`);
  }
  if (before.probabilityPct !== after.probabilityPct) {
    out.push(`機率 %:${num(before.probabilityPct, "未填")} → ${num(after.probabilityPct, "未填")}`);
  }
  if (before.mitigation !== after.mitigation) out.push("修改了對策與驗收標準");
  if (before.ownerId !== after.ownerId) out.push(`負責人:${user(before.ownerId)} → ${user(after.ownerId)}`);
  const beforeReviewers = [...before.reviewerIds].sort().join(",");
  const afterReviewers = [...after.reviewerIds].sort().join(",");
  if (beforeReviewers !== afterReviewers) {
    out.push(`審核人:${people(before.reviewerIds)} → ${people(after.reviewerIds)}`);
  }
  if (before.dueDate !== after.dueDate) {
    out.push(`對策到期日:${before.dueDate ?? NONE} → ${after.dueDate ?? NONE}`);
  }
  if (before.itemId !== after.itemId) out.push(`相關工作項:${item(before.itemId)} → ${item(after.itemId)}`);
  return out;
}
