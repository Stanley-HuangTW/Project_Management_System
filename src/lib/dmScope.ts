import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { orgUnitCodesOfDisciplines, resolveGroupRoleAccess } from "./groupRoles";

/**
 * 各職能的 DM 可以看到的範圍(系統設定裡設)。
 *
 * 預設什麼都沒設 = 跟以前一樣,DM 看得到整塊看板。打開之後,那個職能的 DM 只看得到跟自己職能相關的內容:
 * 工作項、人力表與人力規劃彙總、預算金額,三樣各自可以開關。
 */
export type DmScopeFlags = { limitItems: boolean; limitLabour: boolean; limitBudget: boolean };
export type DmScopeSettings = Partial<Record<GroupDiscipline, DmScopeFlags>>;

/** 沒有設定的職能 = 都不限。 */
export const NO_DM_LIMITS: DmScopeFlags = { limitItems: false, limitLabour: false, limitBudget: false };

export type DmRestriction = {
  /** 工作項:只看得到指派給這些人(自己與同職能的組員)的項目與它們的上層;null = 不限。 */
  itemAssigneeIds: Set<string> | null;
  /** 人力表與人力規劃彙總:只看得到這些組織單位代號的名額與欄位;null = 不限。 */
  labourUnits: Set<string> | null;
  /** 預算金額(階段預算、NRE 報價單、樣機 BOM)看不到。 */
  hideBudget: boolean;
};

/**
 * 這個人在這塊看板上有沒有被限制看的範圍。回 null = 完全不受限。
 *
 * 只有「只是 DM」的人才會被限制:管理者、看板建立者、Team Leader、PMD 一律不受影響(他們本來就要看整體)。
 * 身兼好幾個職能的 DM(例如 SW DM 又是 HW DM),每一個職能都打開了某一項限制,那一項才算限制,
 * 看得到的是各職能看得到的聯集——只要有一個職能沒打開,那一項就不限。
 */
export function resolveDmRestriction(input: {
  userId: string;
  isAdmin: boolean;
  isBoardOwner: boolean;
  /** 這個人在這塊看板底下所有分組裡拿到的角色。 */
  roles: { role: GroupRole }[];
  /** 這塊看板各分組的職能名單(分組角色設定裡的組員)。 */
  members: { discipline: GroupDiscipline; userId: string }[];
  settings: DmScopeSettings;
}): DmRestriction | null {
  if (input.isAdmin || input.isBoardOwner) return null;
  const access = resolveGroupRoleAccess(input.roles);
  if (access.hasScheduleRole) return null;
  const disciplines = [...access.disciplines];
  if (disciplines.length === 0) return null;

  const limited = (key: keyof DmScopeFlags) => disciplines.every((d) => input.settings[d]?.[key] === true);
  const items = limited("limitItems");
  const labour = limited("limitLabour");
  const budget = limited("limitBudget");
  if (!items && !labour && !budget) return null;

  return {
    itemAssigneeIds: items
      ? new Set([input.userId, ...input.members.filter((m) => disciplines.includes(m.discipline)).map((m) => m.userId)])
      : null,
    labourUnits: labour ? orgUnitCodesOfDisciplines(disciplines) : null,
    hideBudget: budget,
  };
}

/**
 * 工作項的範圍:原本看得到的項目裡,留下指派給範圍內的人(或自己建立)的,再加上它們的上層項目——
 * 這樣在階層裡才找得到位置。沒指派任何人的項目不算相關。
 *
 * visibleIds 是已經過了隱私規則(私人項目)的結果;這裡只會再縮小,不會多給。
 */
export function restrictItemsToDmScope(
  visibleIds: Set<string>,
  items: { id: string; parentId: string | null; createdById: string | null; assigneeIds: string[] }[],
  scope: { userId: string; assigneeIds: Set<string> }
): Set<string> {
  const parentOf = new Map(items.map((item) => [item.id, item.parentId]));
  const result = new Set<string>();
  for (const item of items) {
    if (!visibleIds.has(item.id)) continue;
    if (item.createdById !== scope.userId && !item.assigneeIds.some((id) => scope.assigneeIds.has(id))) continue;
    // 自己加上整串上層;上層已經在裡面就不用再往上走。seen 是親子關係壞掉(繞圈)時的保險。
    const seen = new Set<string>();
    let current: string | null = item.id;
    while (current && !result.has(current) && !seen.has(current)) {
      seen.add(current);
      if (visibleIds.has(current)) result.add(current);
      current = parentOf.get(current) ?? null;
    }
  }
  return result;
}
