import type { GroupDiscipline, GroupRole } from "@prisma/client";

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

/** 五個職能,實作成員的順序。看板層級與分組層級用同一組。 */
export const ALL_DISCIPLINES: GroupDiscipline[] = ["SW", "HW", "ME", "QA", "PM"];

type MemberRow = { discipline: GroupDiscipline; userId: string };
type GroupMemberRow = MemberRow & { groupId: string };
type GroupResourceRow = { groupId: string; resourceId: string };

export type SyncGroupRoster = {
  id: string;
  /** 這個分組自己設定實作成員的職能(不沿用看板)。 */
  memberOverrides: GroupDiscipline[];
  /** 這個分組自己設定 Resource 成員(不沿用看板)。 */
  resourceOverride: boolean;
  /** 分組目前的 GroupMember。 */
  members: MemberRow[];
  /** 分組目前的 GroupResourceMember。 */
  resourceIds: string[];
};

/**
 * 跟 planGroupRoleSync 同一個道理,只是對象是實作成員(每個職能一份名單)與 Resource 成員(整個分組一份名單):
 * 沒有自己設定的職能 / Resource,名單要跟看板一模一樣;分組自己設定的完全不動。
 */
export function planGroupRosterSync(
  boardMembers: MemberRow[],
  boardResourceIds: string[],
  groups: SyncGroupRoster[]
): { removeMembers: GroupMemberRow[]; addMembers: GroupMemberRow[]; removeResources: GroupResourceRow[]; addResources: GroupResourceRow[] } {
  const removeMembers: GroupMemberRow[] = [];
  const addMembers: GroupMemberRow[] = [];
  const removeResources: GroupResourceRow[] = [];
  const addResources: GroupResourceRow[] = [];
  const wantedResources = new Set(boardResourceIds);
  for (const group of groups) {
    const own = new Set(group.memberOverrides);
    for (const discipline of ALL_DISCIPLINES) {
      if (own.has(discipline)) continue;
      const wanted = new Set(boardMembers.filter((m) => m.discipline === discipline).map((m) => m.userId));
      const current = new Set(group.members.filter((m) => m.discipline === discipline).map((m) => m.userId));
      for (const userId of current) if (!wanted.has(userId)) removeMembers.push({ groupId: group.id, discipline, userId });
      for (const userId of wanted) if (!current.has(userId)) addMembers.push({ groupId: group.id, discipline, userId });
    }
    if (!group.resourceOverride) {
      const current = new Set(group.resourceIds);
      for (const resourceId of current) if (!wantedResources.has(resourceId)) removeResources.push({ groupId: group.id, resourceId });
      for (const resourceId of wantedResources) if (!current.has(resourceId)) addResources.push({ groupId: group.id, resourceId });
    }
  }
  return { removeMembers, addMembers, removeResources, addResources };
}
