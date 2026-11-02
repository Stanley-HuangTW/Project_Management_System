import type { GroupRole } from "@prisma/client";

/**
 * 誰看得到一個看板的預算金額(階段預算、NRE 報價單、樣機 BOM、人力規劃彙總、成本與 EVM、預算警示…)。
 * 純邏輯,伺服器端的判斷與測試共用同一份。
 *
 * 看得到看板不等於看得到預算。看得到預算的是:
 *   - 管理者、看板擁有者;
 *   - 這塊看板上任一分組的 Team Leader、PMD、PM DM(專案負責人那一層的角色);
 *   - 這塊看板指名「可以看預算的人」(看板分享設定);
 *   - 系統設定裡挑的組織的主管(預設對所有看板有效)。
 * 其他人一律看不到,包含只是被加進成員名單的人、各職能 DM、QA、一般主管。
 *
 * PM DM 同時還受系統設定「DM 的可見範圍」的預算開關管:那裡把 PM 職能的預算限制打開,PM DM 就看不到
 * (除非他同時是上面其他身分)。
 */
export const BUDGET_VIEW_ROLES: GroupRole[] = ["TEAM_LEADER", "PMD", "PM_DM"];

export type BudgetAccessInput = {
  isAdmin: boolean;
  isBoardOwner: boolean;
  /** 這個人在這塊看板底下所有分組拿到的角色。 */
  roles: { role: GroupRole }[];
  /** 這塊看板指名可以看預算的人裡有他。 */
  isNamedViewer: boolean;
  /** 他是系統設定裡「可以看預算的組織」其中一個的主管。 */
  isOrgHead: boolean;
  /** 系統設定「DM 的可見範圍」把他在這塊看板的預算限制掉了(只對 PM DM 這條路有影響)。 */
  dmScopeHidesBudget: boolean;
};

/**
 * 項目上填的「直接費用」(預算、實際)也是預算金額:看不到預算的人拿到的項目資料,這兩個數字要拿掉,
 * 不能只在畫面上藏——不然開瀏覽器的開發者工具就看得到。
 */
export function withoutItemCosts<T extends { budgetCost: number | null; actualCost: number | null }>(item: T): T {
  return { ...item, budgetCost: null, actualCost: null };
}

export function canViewBudget(input: BudgetAccessInput): boolean {
  if (input.isAdmin || input.isBoardOwner || input.isNamedViewer || input.isOrgHead) return true;
  const roles = new Set(input.roles.map((r) => r.role));
  if (roles.has("TEAM_LEADER") || roles.has("PMD")) return true;
  if (roles.has("PM_DM")) return !input.dmScopeHidesBudget;
  return false;
}
