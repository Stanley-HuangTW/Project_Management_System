import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { levelLabel } from "@/lib/approvalLevels";
import { loadDelegations } from "@/lib/approvalLevelsServer";
import { canSignStep, stepSummary, type IssueApprovalDto } from "@/lib/issueApproval";

export type { IssueApprovalDto };

export const APPROVAL_INCLUDE = {
  case: { select: { caseNo: true, description: true } },
  requestedBy: { select: { name: true } },
  steps: { orderBy: { level: "asc" as const }, include: { approver: { select: { name: true } }, decidedBy: { select: { name: true } } } },
} satisfies Prisma.IssueApprovalInclude;

type ApprovalRow = Prisma.IssueApprovalGetPayload<{ include: typeof APPROVAL_INCLUDE }>;

export type Viewer = { userId: string; isSystemAdmin: boolean; isIssueManager: boolean };

export async function viewerOf(userId: string): Promise<Viewer> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, issueRole: true } });
  return { userId, isSystemAdmin: u?.role === "ADMIN", isIssueManager: u?.role === "ADMIN" || u?.issueRole === "MANAGER" };
}

export async function toApprovalDtos(rows: ApprovalRow[], viewer: Viewer): Promise<IssueApprovalDto[]> {
  const delegatedFor = (await loadDelegations()).get(viewer.userId) ?? [];
  return rows.map((a) => {
    const pending = a.status === "PENDING";
    const canSign =
      pending &&
      a.steps.some((s) => canSignStep({ ...viewer, requesterId: a.requestedById, step: { approverId: s.approverId, decision: s.decision }, delegatedFor }));
    return {
      id: a.id,
      kind: a.kind,
      status: a.status,
      caseId: a.caseId,
      caseNo: a.case.caseNo,
      summary: a.case.description.replace(/\s+/g, " ").trim().slice(0, 60),
      requesterName: a.requestedBy?.name ?? null,
      requestedById: a.requestedById,
      note: a.note,
      closeStatus: a.closeStatus === "TC" || a.closeStatus === "PC" ? a.closeStatus : null,
      createdAt: a.createdAt.toISOString(),
      decidedAt: a.decidedAt?.toISOString() ?? null,
      steps: a.steps.map((s) => ({ level: s.level, approverName: s.approver?.name ?? null, decision: s.decision, comment: s.comment, decidedByName: s.decidedBy?.name ?? null })),
      progress: stepSummary(a.steps.map((s) => ({ level: s.level, approverName: s.approver?.name ?? null, decision: s.decision })), levelLabel),
      canSign,
      canCancel: pending && (viewer.isIssueManager || a.requestedById === viewer.userId),
    };
  });
}

/** 這個人現在可以簽的、還在簽核中的簽核單(側邊欄的數字與「待我簽核」頁用)。 */
export async function pendingForUser(viewer: Viewer): Promise<IssueApprovalDto[]> {
  const rows = await prisma.issueApproval.findMany({
    where: { status: "PENDING", case: { deletedAt: null } },
    include: APPROVAL_INCLUDE,
    orderBy: { createdAt: "asc" },
    take: 500,
  });
  return (await toApprovalDtos(rows, viewer)).filter((d) => d.canSign);
}

export async function countPendingForUser(userId: string): Promise<number> {
  return (await pendingForUser(await viewerOf(userId))).length;
}

/** 案件頁用:這個案件的簽核單(新的在前,最多 10 張)。 */
export async function listCaseApprovals(caseId: string, viewer: Viewer): Promise<IssueApprovalDto[]> {
  const rows = await prisma.issueApproval.findMany({ where: { caseId }, include: APPROVAL_INCLUDE, orderBy: { createdAt: "desc" }, take: 10 });
  return toApprovalDtos(rows, viewer);
}
