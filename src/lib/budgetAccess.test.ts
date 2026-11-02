import { describe, expect, it } from "vitest";
import { canViewBudget, withoutItemCosts, type BudgetAccessInput } from "./budgetAccess";

const none: BudgetAccessInput = {
  isAdmin: false,
  isBoardOwner: false,
  roles: [],
  isNamedViewer: false,
  isOrgHead: false,
  dmScopeHidesBudget: false,
};

describe("canViewBudget", () => {
  it("is closed by default: being able to open the board is not enough", () => {
    expect(canViewBudget(none)).toBe(false);
    expect(canViewBudget({ ...none, roles: [] })).toBe(false);
  });

  it("lets admins and the board owner in", () => {
    expect(canViewBudget({ ...none, isAdmin: true })).toBe(true);
    expect(canViewBudget({ ...none, isBoardOwner: true })).toBe(true);
  });

  it("lets Team Leader and PMD in", () => {
    expect(canViewBudget({ ...none, roles: [{ role: "TEAM_LEADER" }] })).toBe(true);
    expect(canViewBudget({ ...none, roles: [{ role: "PMD" }] })).toBe(true);
  });

  it("lets a PM DM in, unless the DM visibility setting hides the budget from that discipline", () => {
    expect(canViewBudget({ ...none, roles: [{ role: "PM_DM" }] })).toBe(true);
    expect(canViewBudget({ ...none, roles: [{ role: "PM_DM" }], dmScopeHidesBudget: true })).toBe(false);
  });

  it("keeps out the other DMs, QA and PMM, however many of those roles somebody holds", () => {
    for (const role of ["SW_DM", "HW_DM", "ME_DM", "QA", "PMM"] as const) {
      expect(canViewBudget({ ...none, roles: [{ role }] })).toBe(false);
    }
    expect(canViewBudget({ ...none, roles: [{ role: "SW_DM" }, { role: "HW_DM" }, { role: "QA" }] })).toBe(false);
  });

  it("lets in the people the board names, and the heads of the organisations picked in settings", () => {
    expect(canViewBudget({ ...none, isNamedViewer: true })).toBe(true);
    expect(canViewBudget({ ...none, isOrgHead: true })).toBe(true);
  });

  it("a named viewer or an org head is not undone by the DM setting", () => {
    expect(canViewBudget({ ...none, isNamedViewer: true, dmScopeHidesBudget: true })).toBe(true);
    expect(canViewBudget({ ...none, isOrgHead: true, roles: [{ role: "PM_DM" }], dmScopeHidesBudget: true })).toBe(true);
  });

  it("holding a viewing role on top of a DM role is enough", () => {
    expect(canViewBudget({ ...none, roles: [{ role: "SW_DM" }, { role: "TEAM_LEADER" }] })).toBe(true);
  });
});

describe("withoutItemCosts", () => {
  it("drops the direct costs typed on an item and leaves everything else alone", () => {
    const item = { id: "i1", name: "機構設計", budgetCost: 50_000, actualCost: 42_000 };
    expect(withoutItemCosts(item)).toEqual({ id: "i1", name: "機構設計", budgetCost: null, actualCost: null });
  });

  it("does not change the item it was given", () => {
    const item = { budgetCost: 1, actualCost: 2 };
    withoutItemCosts(item);
    expect(item).toEqual({ budgetCost: 1, actualCost: 2 });
  });
});
