import type { GroupDiscipline, GroupRole } from "@prisma/client";

const DM_ROLE_DISCIPLINE: Partial<Record<GroupRole, GroupDiscipline>> = {
  SW_DM: "SW",
  HW_DM: "HW",
  ME_DM: "ME",
  QA: "QA",
  PM_DM: "PM",
};

export type GroupRoleAccess = {
  /** TEAM_LEADER or PMD for this group — schedule-edit rights (Gantt drag,
   *  Start/Days/Finish) on every item in the group, unconditional. */
  hasScheduleRole: boolean;
  /** Disciplines this user is the DM of in this group (TEAM_LEADER counts as
   *  DM of all four) — structure rights (item create/assign/progress) scoped
   *  to that discipline's GroupMember roster. */
  disciplines: Set<GroupDiscipline>;
};

/**
 * Resolves what a user's GroupRoleAssignment rows in one group grant them.
 * Pure function — usable on both the server (permission checks) and the
 * client (to decide what buttons/handles to render), same pattern as
 * resolveLockedScheduleFields.
 */
export function resolveGroupRoleAccess(
  assignments: { role: GroupRole }[]
): GroupRoleAccess {
  const roles = new Set(assignments.map((a) => a.role));
  const hasScheduleRole = roles.has("TEAM_LEADER") || roles.has("PMD");
  const disciplines = new Set<GroupDiscipline>();
  if (roles.has("TEAM_LEADER")) {
    disciplines.add("SW");
    disciplines.add("HW");
    disciplines.add("ME");
    disciplines.add("QA");
    disciplines.add("PM");
  }
  for (const [role, discipline] of Object.entries(DM_ROLE_DISCIPLINE) as [GroupRole, GroupDiscipline][]) {
    if (roles.has(role)) disciplines.add(discipline);
  }
  return { hasScheduleRole, disciplines };
}

/**
 * 管理者與看板建立者:什麼都能編——排程權加上每一種職能,跟 Team Leader 一樣。直接沿用 Team Leader 的
 * 結果,不另外列一份職能清單(以前列的是 SW/HW/ME/QA,新增 PM 後漏了,管理者反而改不了 PM 單位的名額)。
 */
export const FULL_GROUP_ACCESS: GroupRoleAccess = resolveGroupRoleAccess([{ role: "TEAM_LEADER" }]);

/**
 * The userIds a DM (of one or more disciplines) manages in this group — the
 * union of GroupMember rosters for `access.disciplines`. Feed into
 * isItemAssignedToTeam the same way a SUPERVISOR's direct-report set is,
 * to scope structure rights (create/assign/progress) to "members under them".
 */
export function groupDisciplineTeamUserIds(
  members: { discipline: GroupDiscipline; userId: string }[],
  access: GroupRoleAccess
): Set<string> {
  const ids = new Set<string>();
  if (access.disciplines.size === 0) return ids;
  for (const m of members) {
    if (access.disciplines.has(m.discipline)) ids.add(m.userId);
  }
  return ids;
}

/**
 * 人力表名額的組織單位代號(EE/SW/ME/QA,系統設定裡可以再加別的)對到分組
 * 職能列舉。EE 對外一律叫 HW(跟 GroupRolesModal 的 UNIT_ALIASES 同一套
 * 對照,只是反過來查:代號 -> 列舉)。查不到就回 null —— 那個組織單位
 * (FAE、業務……)沒有 DM 這個角色可以對應。
 */
const ORG_UNIT_TO_DISCIPLINE: Record<string, GroupDiscipline> = {
  EE: "HW",
  HW: "HW",
  SW: "SW",
  ME: "ME",
  QA: "QA",
  PM: "PM",
};

export function orgUnitToGroupDiscipline(orgUnitCode: string): GroupDiscipline | null {
  return ORG_UNIT_TO_DISCIPLINE[orgUnitCode.toUpperCase()] ?? null;
}

/** orgUnitToGroupDiscipline 的反向:這幾個職能底下有哪些組織單位代號(HW 對到 EE 與 HW)。 */
export function orgUnitCodesOfDisciplines(disciplines: Iterable<GroupDiscipline>): Set<string> {
  const wanted = new Set(disciplines);
  return new Set(
    Object.entries(ORG_UNIT_TO_DISCIPLINE)
      .filter(([, discipline]) => wanted.has(discipline))
      .map(([code]) => code)
  );
}

/**
 * 這個人可不可以編輯某個組織單位底下的人力名額(指定人員、填月份數字、
 * 新增/刪除/改名名額)。
 *
 * 單位對得到 DM 角色的,問該單位的 DM(Team Leader 算全部單位的 DM);
 * 對不到的(FAE、業務……沒有 DM 這個角色),退回時程規劃的權限
 * (Team Leader/PMD)—— 沒有更細的角色可以問,就比照上一層。
 */
export function canEditLabourSlot(access: GroupRoleAccess, orgUnitCode: string): boolean {
  const discipline = orgUnitToGroupDiscipline(orgUnitCode);
  return discipline ? access.disciplines.has(discipline) : access.hasScheduleRole;
}
