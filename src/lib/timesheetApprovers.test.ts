import { describe, expect, it } from "vitest";
import { dmRoleOfDiscipline, resolveTimeApprovers, type GroupRoleRow } from "./timesheetApprovers";

const submitter = { id: "me", discipline: "SW", supervisorId: "boss" };
const roles: GroupRoleRow[] = [
  { groupId: "g1", role: "TEAM_LEADER", userId: "tl" },
  { groupId: "g1", role: "PMD", userId: "pmd" },
  { groupId: "g1", role: "SW_DM", userId: "swdm" },
  { groupId: "g1", role: "ME_DM", userId: "medm" },
  { groupId: "g2", role: "TEAM_LEADER", userId: "other-tl" },
];
const resolve = (overrides: Partial<Parameters<typeof resolveTimeApprovers>[0]> = {}) =>
  resolveTimeApprovers({ submitter, groupIds: ["g1"], roles, adminIds: ["admin"], ...overrides });

describe("resolveTimeApprovers", () => {
  it("該分組的 PMD / Team Leader、同部門 DM、直屬主管、管理者都能核准", () => {
    const result = resolve();
    expect(result.map((r) => `${r.userId}:${r.reason}`)).toEqual([
      "pmd:PMD",
      "tl:TEAM_LEADER",
      "swdm:DM",
      "boss:SUPERVISOR",
      "admin:ADMIN",
    ]);
  });

  it("別的部門的 DM 不能核准(ME DM 不核准 SW 同仁的工時)", () => {
    expect(resolve().some((r) => r.userId === "medm")).toBe(false);
  });

  it("別的分組的 Team Leader 不能核准", () => {
    expect(resolve().some((r) => r.userId === "other-tl")).toBe(false);
  });

  it("對應專案的會議:看板的所有分組都算", () => {
    const ids = resolve({ groupIds: ["g1", "g2"] }).map((r) => r.userId);
    expect(ids).toContain("other-tl");
  });

  it("自己不能核准自己,就算自己是 Team Leader 或管理者", () => {
    const self = { id: "tl", discipline: "SW", supervisorId: null };
    const ids = resolve({ submitter: self, adminIds: ["tl", "admin"] }).map((r) => r.userId);
    expect(ids).not.toContain("tl");
    expect(ids).toContain("admin");
  });

  it("同一個人有好幾個身分時,列最專案的那個", () => {
    const result = resolve({ submitter: { ...submitter, supervisorId: "tl" }, adminIds: ["tl"] });
    expect(result.find((r) => r.userId === "tl")?.reason).toBe("TEAM_LEADER");
    expect(result.filter((r) => r.userId === "tl")).toHaveLength(1);
  });

  it("沒有所屬單位就沒有 DM 可以核准", () => {
    const ids = resolve({ submitter: { ...submitter, discipline: null } }).map((r) => r.userId);
    expect(ids).not.toContain("swdm");
  });
});

describe("dmRoleOfDiscipline", () => {
  it("單位對應到 DM 角色;QA 就是 QA 角色,硬體叫 EE 或 HW 都行", () => {
    expect(dmRoleOfDiscipline("SW")).toBe("SW_DM");
    expect(dmRoleOfDiscipline("EE")).toBe("HW_DM");
    expect(dmRoleOfDiscipline("hw")).toBe("HW_DM");
    expect(dmRoleOfDiscipline("QA")).toBe("QA");
    expect(dmRoleOfDiscipline("OTHER")).toBeNull();
    expect(dmRoleOfDiscipline(null)).toBeNull();
  });
});
