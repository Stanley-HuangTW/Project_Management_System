import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { groupDisciplineTeamUserIds, resolveGroupRoleAccess } from "@/lib/groupRoles";

/**
 * 專案儀表板:一個人在某個看板(專案)上,看得到誰的工作項。
 * - Team Leader、PMD(專案 PM):整個分組(跟他們調時程的權限範圍一樣);
 * - SW / EE / ME / QA / PM DM:自己那個職能在這個分組的「實作成員」名單裡的人,加上自己;
 * - PMM(只是名冊)、沒有角色:沒有。
 * 每個分組各算各的:同一個人在 A 組是 Team Leader、在 B 組只是 SW DM,B 組就只看 SW 組員。
 * 純函式,吃看板資料裡已經有的分組角色與成員名單。
 */

export type GroupScope = "all" | ReadonlySet<string>;

export type ProjectScope = {
  /** 他在這個看板上擔任過的角色(去重複),標題列出來用。 */
  roles: GroupRole[];
  /** 分組 id → 看得到誰。沒有列在這裡的分組,他在那個分組沒有任何角色。 */
  groups: ReadonlyMap<string, GroupScope>;
};

type GroupLike = {
  id: string;
  roleAssignments: { role: GroupRole; userId: string }[];
  members: { discipline: GroupDiscipline; userId: string }[];
};

/** 這幾個角色會讓人有專案儀表板(PMM 只是名冊,不算)。 */
export const PROJECT_DASHBOARD_ROLES: GroupRole[] = ["TEAM_LEADER", "PMD", "SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"];

export function resolveProjectScope(groups: GroupLike[], userId: string): ProjectScope | null {
  const scopes = new Map<string, GroupScope>();
  const roles = new Set<GroupRole>();
  for (const group of groups) {
    const mine = group.roleAssignments.filter((a) => a.userId === userId);
    for (const a of mine) if (PROJECT_DASHBOARD_ROLES.includes(a.role)) roles.add(a.role);
    const access = resolveGroupRoleAccess(mine);
    if (access.hasScheduleRole) {
      scopes.set(group.id, "all");
    } else if (access.disciplines.size > 0) {
      const team = groupDisciplineTeamUserIds(group.members, access);
      team.add(userId);
      scopes.set(group.id, team);
    }
  }
  return scopes.size === 0 ? null : { roles: PROJECT_DASHBOARD_ROLES.filter((r) => roles.has(r)), groups: scopes };
}

/** 管理者:什麼都看得到(從網址進來看任何一個專案)。 */
export function fullProjectScope(groups: { id: string }[]): ProjectScope {
  return { roles: [], groups: new Map(groups.map((g) => [g.id, "all" as const])) };
}

/** 這個人看不看得到分組裡這位負責人。 */
export function personInScope(scope: GroupScope | undefined, personId: string): boolean {
  return scope === "all" || (scope !== undefined && scope.has(personId));
}

/** 標題上寫「你是:…」用的角色稱呼。 */
export const PROJECT_ROLE_LABELS: Record<GroupRole, string> = {
  TEAM_LEADER: "Team Leader(專案負責人)",
  PMD: "PMD(專案 PM)",
  SW_DM: "SW DM",
  HW_DM: "EE DM",
  ME_DM: "ME DM",
  QA: "QA DM",
  PM_DM: "PM DM",
  PMM: "PMM",
};
