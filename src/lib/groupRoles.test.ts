import { describe, expect, it } from "vitest";
import {
  resolveGroupRoleAccess,
  groupDisciplineTeamUserIds,
  orgUnitToGroupDiscipline,
  canEditLabourSlot,
} from "./groupRoles";

function roles(...rs: string[]) {
  return rs.map((role) => ({ role: role as never }));
}

describe("resolveGroupRoleAccess", () => {
  it("no assignments grants nothing", () => {
    const access = resolveGroupRoleAccess([]);
    expect(access.hasScheduleRole).toBe(false);
    expect(access.disciplines.size).toBe(0);
  });

  it("TEAM_LEADER gets schedule rights plus every discipline", () => {
    const access = resolveGroupRoleAccess(roles("TEAM_LEADER"));
    expect(access.hasScheduleRole).toBe(true);
    expect([...access.disciplines].sort()).toEqual(["HW", "ME", "PM", "QA", "SW"]);
  });

  it("PMD gets schedule rights but no discipline roster of its own", () => {
    const access = resolveGroupRoleAccess(roles("PMD"));
    expect(access.hasScheduleRole).toBe(true);
    expect(access.disciplines.size).toBe(0);
  });

  it("PMM grants nothing — roster-only, by design (see GroupRolesModal's own copy)", () => {
    const access = resolveGroupRoleAccess(roles("PMM"));
    expect(access.hasScheduleRole).toBe(false);
    expect(access.disciplines.size).toBe(0);
  });

  it("a discipline DM gets exactly that discipline, and no schedule rights", () => {
    expect(resolveGroupRoleAccess(roles("SW_DM")).hasScheduleRole).toBe(false);
    expect([...resolveGroupRoleAccess(roles("SW_DM")).disciplines]).toEqual(["SW"]);
    expect([...resolveGroupRoleAccess(roles("HW_DM")).disciplines]).toEqual(["HW"]);
    expect([...resolveGroupRoleAccess(roles("ME_DM")).disciplines]).toEqual(["ME"]);
    expect([...resolveGroupRoleAccess(roles("QA")).disciplines]).toEqual(["QA"]);
    expect([...resolveGroupRoleAccess(roles("PM_DM")).disciplines]).toEqual(["PM"]);
  });

  it("multiple DM roles union their disciplines", () => {
    const access = resolveGroupRoleAccess(roles("SW_DM", "QA"));
    expect([...access.disciplines].sort()).toEqual(["QA", "SW"]);
    expect(access.hasScheduleRole).toBe(false);
  });

  it("holding both TEAM_LEADER and a DM role is redundant but harmless", () => {
    const access = resolveGroupRoleAccess(roles("TEAM_LEADER", "SW_DM"));
    expect(access.hasScheduleRole).toBe(true);
    expect([...access.disciplines].sort()).toEqual(["HW", "ME", "PM", "QA", "SW"]);
  });
});

describe("groupDisciplineTeamUserIds", () => {
  const members = [
    { discipline: "SW" as const, userId: "sw-1" },
    { discipline: "SW" as const, userId: "sw-2" },
    { discipline: "HW" as const, userId: "hw-1" },
    { discipline: "QA" as const, userId: "qa-1" },
  ];

  it("no disciplines -> empty set, regardless of the roster", () => {
    const ids = groupDisciplineTeamUserIds(members, { hasScheduleRole: false, disciplines: new Set() });
    expect(ids.size).toBe(0);
  });

  it("scopes to only the members in the granted discipline(s)", () => {
    const ids = groupDisciplineTeamUserIds(members, {
      hasScheduleRole: false,
      disciplines: new Set(["SW"]),
    });
    expect([...ids].sort()).toEqual(["sw-1", "sw-2"]);
  });

  it("unions across multiple disciplines", () => {
    const ids = groupDisciplineTeamUserIds(members, {
      hasScheduleRole: false,
      disciplines: new Set(["HW", "QA"]),
    });
    expect([...ids].sort()).toEqual(["hw-1", "qa-1"]);
  });

  it("a discipline with no roster members yields nothing for it, without erroring", () => {
    const ids = groupDisciplineTeamUserIds(members, {
      hasScheduleRole: false,
      disciplines: new Set(["ME"]),
    });
    expect(ids.size).toBe(0);
  });
});

describe("orgUnitToGroupDiscipline", () => {
  it("EE maps to HW — the discipline enum calls it HW, the UI calls it EE", () => {
    expect(orgUnitToGroupDiscipline("EE")).toBe("HW");
  });

  it("SW/ME/QA/PM map to themselves", () => {
    expect(orgUnitToGroupDiscipline("SW")).toBe("SW");
    expect(orgUnitToGroupDiscipline("ME")).toBe("ME");
    expect(orgUnitToGroupDiscipline("QA")).toBe("QA");
    expect(orgUnitToGroupDiscipline("PM")).toBe("PM");
  });

  it("is case-insensitive", () => {
    expect(orgUnitToGroupDiscipline("ee")).toBe("HW");
  });

  it("an org unit with no DM role (FAE, custom units...) maps to null", () => {
    expect(orgUnitToGroupDiscipline("FAE")).toBeNull();
    expect(orgUnitToGroupDiscipline("MARKETING-PM")).toBeNull();
  });
});

describe("canEditLabourSlot", () => {
  it("the matching discipline's DM can edit that unit's slots", () => {
    const access = resolveGroupRoleAccess(roles("HW_DM"));
    expect(canEditLabourSlot(access, "EE")).toBe(true);
    expect(canEditLabourSlot(access, "SW")).toBe(false);
  });

  it("PM_DM can edit PM slots but nothing else", () => {
    const access = resolveGroupRoleAccess(roles("PM_DM"));
    expect(canEditLabourSlot(access, "PM")).toBe(true);
    expect(canEditLabourSlot(access, "SW")).toBe(false);
  });

  it("TEAM_LEADER (DM of every discipline) can edit every mapped unit's slots", () => {
    const access = resolveGroupRoleAccess(roles("TEAM_LEADER"));
    expect(canEditLabourSlot(access, "EE")).toBe(true);
    expect(canEditLabourSlot(access, "SW")).toBe(true);
    expect(canEditLabourSlot(access, "ME")).toBe(true);
    expect(canEditLabourSlot(access, "QA")).toBe(true);
    expect(canEditLabourSlot(access, "PM")).toBe(true);
  });

  it("PMD alone cannot edit a mapped discipline's slots — schedule rights aren't DM rights", () => {
    const access = resolveGroupRoleAccess(roles("PMD"));
    expect(canEditLabourSlot(access, "SW")).toBe(false);
  });

  it("a unit with no DM role falls back to schedule rights (Team Leader/PMD)", () => {
    const pmd = resolveGroupRoleAccess(roles("PMD"));
    expect(canEditLabourSlot(pmd, "FAE")).toBe(true);

    const swDmOnly = resolveGroupRoleAccess(roles("SW_DM"));
    expect(canEditLabourSlot(swDmOnly, "FAE")).toBe(false);
  });
});
