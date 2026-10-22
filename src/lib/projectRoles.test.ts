import { describe, expect, it } from "vitest";
import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { fullProjectScope, personInScope, resolveProjectScope } from "./projectRoles";

const g = (id: string, roles: [GroupRole, string][] = [], members: [GroupDiscipline, string][] = []) => ({
  id,
  roleAssignments: roles.map(([role, userId]) => ({ role, userId })),
  members: members.map(([discipline, userId]) => ({ discipline, userId })),
});

describe("resolveProjectScope", () => {
  it("Team Leader 與 PMD:整個分組", () => {
    expect(resolveProjectScope([g("A", [["TEAM_LEADER", "me"]]), g("B", [["PMD", "me"]])], "me")?.groups).toEqual(new Map([["A", "all"], ["B", "all"]]));
  });

  it("DM:自己職能的組員名單加自己,不含別的職能的人", () => {
    const scope = resolveProjectScope([g("A", [["SW_DM", "me"]], [["SW", "s1"], ["SW", "s2"], ["HW", "h1"]])], "me");
    expect(scope?.groups.get("A")).toEqual(new Set(["s1", "s2", "me"]));
    expect(scope?.roles).toEqual(["SW_DM"]);
  });

  it("同時是 SW DM 與 QA DM:兩個名單合起來", () => {
    const scope = resolveProjectScope([g("A", [["SW_DM", "me"], ["QA", "me"]], [["SW", "s1"], ["QA", "q1"], ["HW", "h1"]])], "me");
    expect(scope?.groups.get("A")).toEqual(new Set(["s1", "q1", "me"]));
  });

  it("EE DM 看的是 HW 組員名單(對外叫 EE,資料裡是 HW)", () => {
    const scope = resolveProjectScope([g("A", [["HW_DM", "me"]], [["HW", "h1"], ["SW", "s1"]])], "me");
    expect(scope?.groups.get("A")).toEqual(new Set(["h1", "me"]));
  });

  it("每個分組各算各的:A 組是 Team Leader、B 組只是 SW DM", () => {
    const scope = resolveProjectScope(
      [g("A", [["TEAM_LEADER", "me"]]), g("B", [["SW_DM", "me"]], [["SW", "s1"], ["HW", "h1"]]), g("C")],
      "me"
    );
    expect(scope?.groups.get("A")).toBe("all");
    expect(scope?.groups.get("B")).toEqual(new Set(["s1", "me"]));
    expect(scope?.groups.has("C")).toBe(false);
  });

  it("PMM(只是名冊)與沒有任何角色:沒有專案儀表板", () => {
    expect(resolveProjectScope([g("A", [["PMM", "me"]])], "me")).toBeNull();
    expect(resolveProjectScope([g("A", [["TEAM_LEADER", "someone"]])], "me")).toBeNull();
    expect(resolveProjectScope([], "me")).toBeNull();
  });

  it("DM 的名單是空的(還沒設組員):還是有儀表板,只看得到自己", () => {
    expect(resolveProjectScope([g("A", [["QA", "me"]])], "me")?.groups.get("A")).toEqual(new Set(["me"]));
  });

  it("角色清單去重複、照固定順序", () => {
    const scope = resolveProjectScope([g("A", [["QA", "me"], ["TEAM_LEADER", "me"]]), g("B", [["TEAM_LEADER", "me"]])], "me");
    expect(scope?.roles).toEqual(["TEAM_LEADER", "QA"]);
  });
});

describe("personInScope / fullProjectScope", () => {
  it("all 看得到每個人;名單只看得到名單上的人;沒有範圍(不在這個分組)看不到", () => {
    expect(personInScope("all", "x")).toBe(true);
    expect(personInScope(new Set(["a"]), "a")).toBe(true);
    expect(personInScope(new Set(["a"]), "b")).toBe(false);
    expect(personInScope(undefined, "a")).toBe(false);
  });

  it("管理者的範圍:每個分組都是 all", () => {
    expect(fullProjectScope([{ id: "A" }, { id: "B" }]).groups).toEqual(new Map([["A", "all"], ["B", "all"]]));
  });
});
