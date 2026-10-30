import { describe, expect, it } from "vitest";
import { canViewBudget, type BudgetAccessInput } from "./budgetAccess";

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
