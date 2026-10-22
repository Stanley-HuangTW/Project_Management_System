import { describe, expect, it } from "vitest";
import type { GroupRole } from "@prisma/client";
import { isRoleInherited, planGroupRoleSync, type SyncGroup } from "./boardRoles";

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
