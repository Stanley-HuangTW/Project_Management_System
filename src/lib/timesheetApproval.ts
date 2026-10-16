import { prisma } from "@/lib/prisma";
import { levelLabel, managerChain } from "@/lib/approvalLevels";
import { getApprovalLevelSettings, loadDelegations, loadSupervisorGraph } from "@/lib/approvalLevelsServer";
import {
  APPROVER_REASON_LABELS,
  resolveTimeApprovers,
  type ApproverReason,
  type ResolvedApprover,
} from "@/lib/timesheetApprovers";

/** 一筆待核准的工時:key 是呼叫端自己的識別,groupIds 是它所屬的分組(工作項一個;對應專案的會議是整塊看板)。 */
export type ApprovalSubject = { key: string; userId: string; groupIds: string[] };

/** level:以主管身分核准時,是送審者的第幾階主管(1 = 直屬主管);deputy:是副主管代那位主管簽。 */
export type ApproverInfo = {
  userId: string;
  name: string;
  reason: ApproverReason;
  reasonLabel: string;
  level?: number;
  deputy?: boolean;
};

const ROLE_ROWS = ["TEAM_LEADER", "PMD", "SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"] as const;

/** 一次算很多筆的核准人(key → 核准人,含姓名與身分)。 */
export async function resolveApprovers(subjects: ApprovalSubject[]): Promise<Map<string, ApproverInfo[]>> {
  const result = new Map<string, ApproverInfo[]>();
  if (subjects.length === 0) return result;

  const userIds = [...new Set(subjects.map((s) => s.userId))];
  const groupIds = [...new Set(subjects.flatMap((s) => s.groupIds))];
  const [submitters, roles, admins, graph, levelSettings, delegations] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, discipline: true, supervisorId: true } }),
    groupIds.length > 0
      ? prisma.groupRoleAssignment.findMany({
          where: { groupId: { in: groupIds }, role: { in: [...ROLE_ROWS] } },
          select: { groupId: true, role: true, userId: true },
        })
      : Promise.resolve([]),
    prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } }),
    loadSupervisorGraph(),
    getApprovalLevelSettings(),
    loadDelegations(),
  ]);
  const submitterById = new Map(submitters.map((u) => [u.id, u]));
  const adminIds = admins.map((a) => a.id);

  const resolved = new Map<string, ResolvedApprover[]>();
  for (const subject of subjects) {
    const submitter = submitterById.get(subject.userId);
    if (!submitter) continue;
    resolved.set(
      subject.key,
      resolveTimeApprovers({
        submitter,
        groupIds: subject.groupIds,
        roles,
        adminIds,
        managerChain: managerChain(graph, subject.userId),
        levels: levelSettings.timesheet,
        delegations,
      })
    );
  }

  const approverIds = [...new Set([...resolved.values()].flatMap((list) => list.map((a) => a.userId)))];
  const names = await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, name: true } });
  const nameById = new Map(names.map((u) => [u.id, u.name]));
  for (const [key, list] of resolved) {
    result.set(
      key,
      list.map((a) => ({
        userId: a.userId,
        name: nameById.get(a.userId) ?? "(已刪除的使用者)",
        reason: a.reason,
        reasonLabel:
          a.reason === "SUPERVISOR" && a.level ? `${levelLabel(a.level)}${a.deputy ? "(代簽)" : ""}` : APPROVER_REASON_LABELS[a.reason],
        ...(a.level ? { level: a.level } : {}),
        ...(a.deputy ? { deputy: true } : {}),
      }))
    );
  }
  return result;
}

/**
 * 給畫面顯示的核准人:專案相關的(PMD、Team Leader、部門 DM、直屬主管)列出姓名與身分;管理者不一個個列,
 * 只在最後寫一個「管理者」。
 */
export function formatApprovers(list: ApproverInfo[]): string[] {
  const named = list.filter((a) => a.reason !== "ADMIN").map((a) => `${a.name}(${a.reasonLabel})`);
  return list.some((a) => a.reason === "ADMIN") ? [...named, "管理者"] : named;
}

/** 對應專案的會議工時屬於這塊看板的所有分組。 */
export async function groupIdsOfBoards(boardIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (boardIds.length === 0) return map;
  const groups = await prisma.group.findMany({ where: { boardId: { in: boardIds } }, select: { id: true, boardId: true } });
  for (const g of groups) map.set(g.boardId, [...(map.get(g.boardId) ?? []), g.id]);
  return map;
}

/** 這個人的工時是不是免審核(管理者在使用者管理設定)。 */
export async function isTimesheetExempt(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timesheetNoApproval: true } });
  return user?.timesheetNoApproval ?? false;
}

export { EXEMPT_DECISION_NOTE } from "@/lib/timesheetApprovalLabels";
