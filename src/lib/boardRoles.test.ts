import { describe, expect, it } from "vitest";
import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { isRoleInherited, planGroupRoleSync, planGroupRosterSync, type SyncGroup, type SyncGroupRoster } from "./boardRoles";

const r = (role: GroupRole, userId: string) => ({ role, userId });

describe("planGroupRoleSync", () => {
  it("gives a group with nothing set the board's names for every role", () => {
    const board = [r("TEAM_LEADER", "alice"), r("PMD", "bob"), r("PMD", "carol")];
    const groups: SyncGroup[] = [{ id: "g1", overrides: [], rows: [] }];
    const plan = planGroupRoleSync(board, groups);
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([
      { groupId: "g1", role: "TEAM_LEADER", userId: "alice" },
      { groupId: "g1", role: "PMD", userId: "bob" },
      { groupId: "g1", role: "PMD", userId: "carol" },
    ]);
  });

  it("makes an inheriting group follow a change of the board: drops who left, adds who joined, leaves the rest alone", () => {
    const board = [r("TEAM_LEADER", "alice"), r("SW_DM", "dave")];
    const groups: SyncGroup[] = [{ id: "g1", overrides: [], rows: [r("TEAM_LEADER", "zed"), r("TEAM_LEADER", "alice")] }];
    const plan = planGroupRoleSync(board, groups);
    expect(plan.remove).toEqual([{ groupId: "g1", role: "TEAM_LEADER", userId: "zed" }]);
    expect(plan.add).toEqual([{ groupId: "g1", role: "SW_DM", userId: "dave" }]);
  });

  it("never touches a role the group set for itself — even when the group's list is empty", () => {
    const board = [r("TEAM_LEADER", "alice"), r("PMD", "bob")];
    const groups: SyncGroup[] = [
      { id: "g1", overrides: ["TEAM_LEADER"], rows: [r("TEAM_LEADER", "zed")] },
      { id: "g2", overrides: ["PMD"], rows: [] },
    ];
    const plan = planGroupRoleSync(board, groups);
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([
      { groupId: "g1", role: "PMD", userId: "bob" },
      { groupId: "g2", role: "TEAM_LEADER", userId: "alice" },
    ]);
  });

  it("handles roles independently inside one group", () => {
    const board = [r("TEAM_LEADER", "alice"), r("QA", "erin")];
    const groups: SyncGroup[] = [{ id: "g1", overrides: ["QA"], rows: [r("QA", "frank")] }];
    const plan = planGroupRoleSync(board, groups);
    expect(plan.add).toEqual([{ groupId: "g1", role: "TEAM_LEADER", userId: "alice" }]);
    expect(plan.remove).toEqual([]);
  });

  it("clears a group's inherited role when the board no longer names anyone", () => {
    const groups: SyncGroup[] = [{ id: "g1", overrides: [], rows: [r("PMM", "gina")] }];
    expect(planGroupRoleSync([], groups)).toEqual({ remove: [{ groupId: "g1", role: "PMM", userId: "gina" }], add: [] });
  });

  it("does nothing when everything already matches", () => {
    const board = [r("TEAM_LEADER", "alice")];
    const groups: SyncGroup[] = [{ id: "g1", overrides: [], rows: [r("TEAM_LEADER", "alice")] }];
    expect(planGroupRoleSync(board, groups)).toEqual({ remove: [], add: [] });
  });
});

describe("isRoleInherited", () => {
  it("is inherited unless the group lists the role as its own", () => {
    expect(isRoleInherited([], "PMD")).toBe(true);
    expect(isRoleInherited(["PMD"], "PMD")).toBe(false);
    expect(isRoleInherited(["PMD"], "TEAM_LEADER")).toBe(true);
  });
});

const m = (discipline: GroupDiscipline, userId: string) => ({ discipline, userId });
const roster = (over: Partial<SyncGroupRoster> & { id: string }): SyncGroupRoster => ({
  memberOverrides: [],
  resourceOverride: false,
  members: [],
  resourceIds: [],
  ...over,
});

describe("planGroupRosterSync", () => {
  it("gives a group with nothing set the board's members for every discipline and the board's Resources", () => {
    const plan = planGroupRosterSync([m("SW", "alice"), m("SW", "bob"), m("QA", "carol")], ["r1"], [roster({ id: "g1" })]);
    expect(plan.removeMembers).toEqual([]);
    expect(plan.addMembers).toEqual([
      { groupId: "g1", discipline: "SW", userId: "alice" },
      { groupId: "g1", discipline: "SW", userId: "bob" },
      { groupId: "g1", discipline: "QA", userId: "carol" },
    ]);
    expect(plan.addResources).toEqual([{ groupId: "g1", resourceId: "r1" }]);
    expect(plan.removeResources).toEqual([]);
  });

  it("makes an inheriting group follow a change of the board: drops who left, adds who joined", () => {
    const plan = planGroupRosterSync(
      [m("SW", "alice"), m("ME", "dave")],
      ["r2"],
      [roster({ id: "g1", members: [m("SW", "zed"), m("SW", "alice")], resourceIds: ["r1"] })]
    );
    expect(plan.removeMembers).toEqual([{ groupId: "g1", discipline: "SW", userId: "zed" }]);
    expect(plan.addMembers).toEqual([{ groupId: "g1", discipline: "ME", userId: "dave" }]);
    expect(plan.removeResources).toEqual([{ groupId: "g1", resourceId: "r1" }]);
    expect(plan.addResources).toEqual([{ groupId: "g1", resourceId: "r2" }]);
  });

  it("never touches a discipline the group set for itself — even when the group's list is empty", () => {
    const plan = planGroupRosterSync(
      [m("SW", "alice"), m("QA", "carol")],
      [],
      [
        roster({ id: "g1", memberOverrides: ["SW"], members: [m("SW", "zed")] }),
        roster({ id: "g2", memberOverrides: ["QA"] }),
      ]
    );
    expect(plan.removeMembers).toEqual([]);
    expect(plan.addMembers).toEqual([
      { groupId: "g1", discipline: "QA", userId: "carol" },
      { groupId: "g2", discipline: "SW", userId: "alice" },
    ]);
  });

  it("never touches the Resource list of a group that set its own — but still syncs its members", () => {
    const plan = planGroupRosterSync(
      [m("HW", "erin")],
      ["r1"],
      [roster({ id: "g1", resourceOverride: true, resourceIds: ["r9"] }), roster({ id: "g2", resourceOverride: true })]
    );
    expect(plan.removeResources).toEqual([]);
    expect(plan.addResources).toEqual([]);
    expect(plan.addMembers).toEqual([
      { groupId: "g1", discipline: "HW", userId: "erin" },
      { groupId: "g2", discipline: "HW", userId: "erin" },
    ]);
  });

  it("clears inherited members and Resources when the board no longer lists anyone", () => {
    const plan = planGroupRosterSync([], [], [roster({ id: "g1", members: [m("PM", "gina")], resourceIds: ["r1"] })]);
    expect(plan).toEqual({
      removeMembers: [{ groupId: "g1", discipline: "PM", userId: "gina" }],
      addMembers: [],
      removeResources: [{ groupId: "g1", resourceId: "r1" }],
      addResources: [],
    });
  });

  it("does nothing when everything already matches", () => {
    const plan = planGroupRosterSync([m("SW", "alice")], ["r1"], [roster({ id: "g1", members: [m("SW", "alice")], resourceIds: ["r1"] })]);
    expect(plan).toEqual({ removeMembers: [], addMembers: [], removeResources: [], addResources: [] });
  });
});
