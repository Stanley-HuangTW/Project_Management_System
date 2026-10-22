import type { GroupRole } from "@prisma/client";

/** 八個角色,畫面上的順序。看板層級與分組層級用同一組。 */
export const ALL_GROUP_ROLES: GroupRole[] = ["TEAM_LEADER", "SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM", "PMM", "PMD"];

type RoleRow = { role: GroupRole; userId: string };
type GroupRoleRow = RoleRow & { groupId: string };

export type SyncGroup = {
  id: string;
  /** 這個分組自己設定的角色(不沿用看板)。 */
  overrides: GroupRole[];
  /** 分組目前的 GroupRoleAssignment。 */
  rows: RoleRow[];
};

/**
 * 看板的角色名單改了(或分組剛建立、或某個角色改回「沿用看板」)之後,每個分組該怎麼改:
 * 沒有自己設定的角色,名單要跟看板一模一樣;分組自己設定的角色完全不動。
 * 純函式,只算「刪哪些、加哪些」,寫入由 boardRolesServer 做。
 */
export function planGroupRoleSync(boardRows: RoleRow[], groups: SyncGroup[]): { remove: GroupRoleRow[]; add: GroupRoleRow[] } {
  const remove: GroupRoleRow[] = [];
  const add: GroupRoleRow[] = [];
  for (const group of groups) {
    const own = new Set(group.overrides);
    for (const role of ALL_GROUP_ROLES) {
      if (own.has(role)) continue;
      const wanted = new Set(boardRows.filter((r) => r.role === role).map((r) => r.userId));
      const current = new Set(group.rows.filter((r) => r.role === role).map((r) => r.userId));
      for (const userId of current) if (!wanted.has(userId)) remove.push({ groupId: group.id, role, userId });
      for (const userId of wanted) if (!current.has(userId)) add.push({ groupId: group.id, role, userId });
    }
  }
  return { remove, add };
}

/** 某個分組的某個角色是不是沿用看板。 */
export function isRoleInherited(overrides: GroupRole[], role: GroupRole): boolean {
  return !overrides.includes(role);
}
