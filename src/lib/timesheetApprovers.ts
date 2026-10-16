import type { GroupRole } from "@prisma/client";
import { requiredLevels } from "@/lib/approvalLevels";

/**
 * 工時要誰核准。一筆工時的核准人(任一人即可):
 *  - 這個工作項所在分組(對應專案的會議則是這塊看板的任一分組)的 Team Leader / PMD;
 *  - 同部門的 DM:只能核准「跟自己同部門」同仁的工時;
 *  - 送審者的直屬主管(系統設定可以要求二階、三階主管也要同意,見 approvalLevels.ts);
 *  - 管理者。
 * 不能核准自己的。
 */

export type ApproverReason = "PMD" | "TEAM_LEADER" | "DM" | "SUPERVISOR" | "ADMIN";

export const APPROVER_REASON_LABELS: Record<ApproverReason, string> = {
  PMD: "PMD",
  TEAM_LEADER: "Team Leader",
  DM: "部門 DM",
  SUPERVISOR: "直屬主管",
  ADMIN: "管理者",
};

/** 使用者的所屬單位(OrgUnit.code)對應到哪個 DM 角色。QA 的 DM 就是 QA 角色本身;硬體單位叫 EE 或 HW 都算。 */
const DM_ROLE_OF_DISCIPLINE: Record<string, GroupRole> = {
  SW: "SW_DM",
  HW: "HW_DM",
  EE: "HW_DM",
  ME: "ME_DM",
  QA: "QA",
  PM: "PM_DM",
};

export function dmRoleOfDiscipline(discipline: string | null | undefined): GroupRole | null {
  return discipline ? (DM_ROLE_OF_DISCIPLINE[discipline.toUpperCase()] ?? null) : null;
}

export type GroupRoleRow = { groupId: string; role: GroupRole; userId: string };

/** level:這位主管是送審者的第幾階主管(只有 reason 是 SUPERVISOR 時才有),1 = 直屬。 */
export type ResolvedApprover = { userId: string; reason: ApproverReason; level?: number };

/** 同一個人符合好幾個身分時,顯示最「專案」的那個。 */
const REASON_PRIORITY: ApproverReason[] = ["PMD", "TEAM_LEADER", "DM", "SUPERVISOR", "ADMIN"];

export function resolveTimeApprovers(args: {
  submitter: { id: string; discipline: string | null; supervisorId: string | null };
  /** 這筆工時所屬的分組(工作項:一個;對應專案的會議:該看板所有分組)。 */
  groupIds: string[];
  roles: GroupRoleRow[];
  adminIds: string[];
  /** 送審者頭上的主管,由近到遠(直屬 → 二階 → …)。沒給就只看 submitter.supervisorId 一階。 */
  managerChain?: string[];
  /** 「主管這一條路」設定要幾階主管同意(1 = 只要直屬主管)。 */
  levels?: number;
}): ResolvedApprover[] {
  const { submitter, groupIds, roles, adminIds } = args;
  const groups = new Set(groupIds);
  const dmRole = dmRoleOfDiscipline(submitter.discipline);

  const found = new Map<string, { reason: ApproverReason; level?: number }>();
  const add = (userId: string, reason: ApproverReason, level?: number) => {
    if (userId === submitter.id) return;
    const existing = found.get(userId);
    if (!existing || REASON_PRIORITY.indexOf(reason) < REASON_PRIORITY.indexOf(existing.reason)) found.set(userId, { reason, level });
  };

  for (const row of roles) {
    if (!groups.has(row.groupId)) continue;
    if (row.role === "PMD") add(row.userId, "PMD");
    else if (row.role === "TEAM_LEADER") add(row.userId, "TEAM_LEADER");
    else if (dmRole && row.role === dmRole) add(row.userId, "DM");
  }
  if (args.managerChain) {
    const required = requiredLevels(args.managerChain.length, args.levels ?? 1);
    for (let i = 0; i < required; i++) add(args.managerChain[i], "SUPERVISOR", i + 1);
  } else if (submitter.supervisorId) {
    add(submitter.supervisorId, "SUPERVISOR", 1);
  }
  for (const id of adminIds) add(id, "ADMIN");

  return [...found.entries()]
    .map(([userId, { reason, level }]) => ({ userId, reason, ...(level ? { level } : {}) }))
    .sort(
      (a, b) =>
        REASON_PRIORITY.indexOf(a.reason) - REASON_PRIORITY.indexOf(b.reason) || (a.level ?? 0) - (b.level ?? 0)
    );
}
