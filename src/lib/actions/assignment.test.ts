import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 人員分配:主管只能把任務指派給自己或自己團隊的成員,但這個項目所在分組的 Team Leader
 * (那個分組的,或整個看板的)是專案的負責人,可以指派給任何人——被指派的人不一定是他的部屬。
 */

type Role = "ADMIN" | "SUPERVISOR" | "MEMBER";
const state = {
  session: { userId: "u_sup", role: "SUPERVISOR" as Role, name: "主管", email: "s@example.com" },
  /** 這個主管直接 / 間接的部屬 */
  subordinates: ["u_sub1"] as string[],
  /** 這個人是 Team Leader 的分組(分組的或整個看板的,isGroupLeader 已經合併) */
  leaderGroups: [] as string[],
  /** 項目現有的指派,用來讓主管通過「能編輯這個項目的人員分配」那一關 */
  assigned: ["u_sub1"] as string[],
  hasScheduleRole: false,
  upserts: [] as { itemId: string; userId: string }[],
};

vi.mock("@/lib/session", () => ({ requireSession: async () => state.session }));
vi.mock("@/lib/boardAccess", () => ({ requireBoardAccess: async () => undefined, requireItemBoardAccess: async () => "b1" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/notify", () => ({ filterInAppRecipients: async () => [], notifyEmailIfNeeded: async () => undefined }));
vi.mock("@/lib/activityLog", () => ({ logActivity: async () => undefined }));
vi.mock("@/lib/orgChartServer", () => ({ subordinateIdsOf: async () => new Set(state.subordinates) }));
vi.mock("@/lib/groupLeaderServer", () => ({ isGroupLeader: async (_userId: string, groupId: string) => state.leaderGroups.includes(groupId) }));
vi.mock("@/lib/groupRoleContext", () => ({
  loadGroupRoleContext: async () => ({ access: { hasScheduleRole: state.hasScheduleRole, disciplines: new Set() }, teamUserIds: new Set<string>() }),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    item: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        boardId: "b1",
        groupId: "g1",
        cellValues: [],
        assignments: state.assigned.map((userId) => ({ userId })),
      }),
    },
    column: { findMany: async () => [] },
    assignment: {
      findUnique: async () => null,
      upsert: async ({ where }: { where: { itemId_userId: { itemId: string; userId: string } } }) => {
        state.upserts.push(where.itemId_userId);
      },
    },
    user: { findUnique: async () => ({ name: "某人" }) },
    notification: { create: async () => undefined },
  },
}));

const { upsertAssignment, canAssignToAnyone } = await import("./assignment");

beforeEach(() => {
  state.session = { userId: "u_sup", role: "SUPERVISOR", name: "主管", email: "s@example.com" };
  state.subordinates = ["u_sub1"];
  state.leaderGroups = [];
  state.assigned = ["u_sub1"];
  state.hasScheduleRole = false;
  state.upserts = [];
});

describe("主管指派", () => {
  it("可以指派給自己的部屬與自己", async () => {
    await upsertAssignment("b1", "i1", "u_sub1", 50);
    await upsertAssignment("b1", "i1", "u_sup", 20);
    expect(state.upserts.map((u) => u.userId)).toEqual(["u_sub1", "u_sup"]);
  });

  it("不是部屬、也不是這個分組的 Team Leader:不能指派給別人的部屬", async () => {
    await expect(upsertAssignment("b1", "i1", "u_other", 50)).rejects.toThrow(/只能將任務指派給自己或自己團隊/);
    expect(state.upserts).toEqual([]);
  });

  it("這個項目所在分組的 Team Leader(含整個看板的):可以指派給任何人,即使不是部屬", async () => {
    state.leaderGroups = ["g1"];
    state.hasScheduleRole = true; // Team Leader 本來就能編輯分組裡每個項目的人員分配
    await upsertAssignment("b1", "i1", "u_other", 50);
    expect(state.upserts).toEqual([{ itemId: "i1", userId: "u_other" }]);
  });

  it("別的分組的 Team Leader 不算:這個項目所在的分組不是他當 Team Leader 的", async () => {
    state.leaderGroups = ["g_other"];
    await expect(upsertAssignment("b1", "i1", "u_other", 50)).rejects.toThrow(/只能將任務指派給自己或自己團隊/);
    expect(state.upserts).toEqual([]);
  });
});

describe("canAssignToAnyone(畫面決定要不要把全部人列進下拉選單)", () => {
  it("主管:是這個項目所在分組的 Team Leader 才是 true", async () => {
    expect(await canAssignToAnyone("i1")).toBe(false);
    state.leaderGroups = ["g1"];
    expect(await canAssignToAnyone("i1")).toBe(true);
    state.leaderGroups = ["g_other"];
    expect(await canAssignToAnyone("i1")).toBe(false);
  });

  it("其他身分本來就沒有「只能選自己團隊」的限制", async () => {
    state.session = { ...state.session, role: "MEMBER" };
    expect(await canAssignToAnyone("i1")).toBe(true);
    state.session = { ...state.session, role: "ADMIN" };
    expect(await canAssignToAnyone("i1")).toBe(true);
  });
});
