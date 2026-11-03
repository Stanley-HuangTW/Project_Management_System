import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 分組角色設定:管理者什麼都能設;分組的 Team Leader 只能在「自己的分組」指定 DM 與各職能的 member,
 * Team Leader / PMM / PMD 這幾個管整個分組的角色仍然只有管理者能設。
 * 資格是對那一個分組而言的:groupId 一定要驗證屬於傳進來的 boardId。
 */

type Session = { userId: string; role: "ADMIN" | "SUPERVISOR" | "MEMBER"; name: string; email: string };

const state = {
  session: { userId: "u_tl", role: "MEMBER", name: "TL", email: "tl@example.com" } as Session,
  groups: [
    { id: "g1", boardId: "b1", roleOverrides: [] as string[], memberOverrides: [] as string[], resourceOverride: false },
    { id: "g2", boardId: "b1", roleOverrides: [] as string[], memberOverrides: [] as string[], resourceOverride: false },
    { id: "g_other", boardId: "b2", roleOverrides: [] as string[], memberOverrides: [] as string[], resourceOverride: false },
  ],
  /** 誰在哪個分組擔任什麼角色 */
  roles: [{ groupId: "g1", role: "TEAM_LEADER", userId: "u_tl" }] as { groupId: string; role: string; userId: string }[],
  members: [] as { groupId: string; discipline: string; userId: string }[],
  groupResources: [] as { groupId: string; resourceId: string }[],
  /** 看板層級的實作成員與 Resource 成員 */
  boardMembers: [] as { boardId: string; discipline: string; userId: string }[],
  boardResources: [] as { boardId: string; resourceId: string }[],
  /** 看板層級的角色(管理者在「整個看板」設的) */
  boardRoles: [] as { boardId: string; role: string; userId: string }[],
  boards: [
    { id: "b1", ownerId: "u_owner" },
    { id: "b2", ownerId: "u_owner" },
  ],
};

vi.mock("@/lib/session", () => ({ requireSession: async () => state.session }));
vi.mock("@/lib/boardAccess", () => ({ requireBoardAccess: async () => undefined }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
const sync = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined));
vi.mock("@/lib/boardRolesServer", () => ({ syncGroupRolesFromBoard: sync }));
vi.mock("@/lib/prisma", () => {
  const tx = {
    group: {
      findUnique: async ({ where }: { where: { id: string } }) => state.groups.find((g) => g.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(state.groups.find((x) => x.id === where.id)!, data);
      },
    },
    board: {
      findUnique: async ({ where }: { where: { id: string } }) => state.boards.find((b) => b.id === where.id) ?? null,
    },
    boardRoleAssignment: {
      findFirst: async ({ where }: { where: { userId: string; role: string; boardId?: string; board?: { groups: { some: { id: string } } } } }) =>
        state.boardRoles.find((r) => {
          if (r.userId !== where.userId || r.role !== where.role) return false;
          if (where.boardId) return r.boardId === where.boardId;
          const groupId = where.board?.groups.some.id;
          return state.groups.find((g) => g.id === groupId)?.boardId === r.boardId;
        }) ?? null,
      deleteMany: async ({ where }: { where: { boardId: string; role: string } }) => {
        state.boardRoles = state.boardRoles.filter((r) => !(r.boardId === where.boardId && r.role === where.role));
      },
      createMany: async ({ data }: { data: { boardId: string; role: string; userId: string }[] }) => {
        state.boardRoles.push(...data);
      },
    },
    groupMember: {
      deleteMany: async ({ where }: { where: { groupId: string; discipline: string } }) => {
        state.members = state.members.filter((m) => !(m.groupId === where.groupId && m.discipline === where.discipline));
      },
      createMany: async ({ data }: { data: { groupId: string; discipline: string; userId: string }[] }) => {
        state.members.push(...data);
      },
    },
    groupResourceMember: {
      deleteMany: async ({ where }: { where: { groupId: string } }) => {
        state.groupResources = state.groupResources.filter((r) => r.groupId !== where.groupId);
      },
      createMany: async ({ data }: { data: { groupId: string; resourceId: string }[] }) => {
        state.groupResources.push(...data);
      },
    },
    boardDisciplineMember: {
      deleteMany: async ({ where }: { where: { boardId: string; discipline: string } }) => {
        state.boardMembers = state.boardMembers.filter((m) => !(m.boardId === where.boardId && m.discipline === where.discipline));
      },
      createMany: async ({ data }: { data: { boardId: string; discipline: string; userId: string }[] }) => {
        state.boardMembers.push(...data);
      },
    },
    boardResourceMember: {
      deleteMany: async ({ where }: { where: { boardId: string } }) => {
        state.boardResources = state.boardResources.filter((r) => r.boardId !== where.boardId);
      },
      createMany: async ({ data }: { data: { boardId: string; resourceId: string }[] }) => {
        state.boardResources.push(...data);
      },
    },
    groupRoleAssignment: {
      findFirst: async ({ where }: { where: { userId: string; groupId: string; role: string } }) =>
        state.roles.find((r) => r.userId === where.userId && r.groupId === where.groupId && r.role === where.role) ?? null,
      deleteMany: async ({ where }: { where: { groupId: string; role: string } }) => {
        state.roles = state.roles.filter((r) => !(r.groupId === where.groupId && r.role === where.role));
      },
      createMany: async ({ data }: { data: { groupId: string; role: string; userId: string }[] }) => {
        state.roles.push(...data);
      },
    },
  };
  return {
    prisma: {
      ...tx,
      $transaction: async (arg: unknown) => (typeof arg === "function" ? (arg as (t: typeof tx) => unknown)(tx) : Promise.all(arg as unknown[])),
    },
  };
});

const {
  setGroupRoleAssignments,
  setGroupMembers,
  setBoardRoleAssignments,
  setGroupMemberInherit,
  setGroupResourceMembers,
  setGroupResourceInherit,
  setBoardMembers,
  setBoardResourceMembers,
} = await import("./groupRoles");

const rolesOf = (groupId: string, role: string) => state.roles.filter((r) => r.groupId === groupId && r.role === role).map((r) => r.userId);

beforeEach(() => {
  state.session = { userId: "u_tl", role: "MEMBER", name: "TL", email: "tl@example.com" };
  state.roles = [{ groupId: "g1", role: "TEAM_LEADER", userId: "u_tl" }];
  state.members = [];
  state.groupResources = [];
  state.boardMembers = [];
  state.boardResources = [];
  state.boardRoles = [];
  for (const g of state.groups) Object.assign(g, { roleOverrides: [], memberOverrides: [], resourceOverride: false });
  sync.mockClear();
});

describe("分組的 Team Leader 指定 DM", () => {
  it("在自己的分組可以指定各職能的 DM,並標成這個分組自己設定的", async () => {
    const result = await setGroupRoleAssignments("b1", "g1", "SW_DM", ["u_a", "u_b"]);
    expect(result).toEqual({});
    expect(rolesOf("g1", "SW_DM")).toEqual(["u_a", "u_b"]);
    expect(state.groups[0].roleOverrides).toContain("SW_DM");
  });

  it("五個職能的 DM(SW / EE / ME / QA / PM)都可以", async () => {
    for (const role of ["SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"] as const) {
      expect(await setGroupRoleAssignments("b1", "g1", role, ["u_a"])).toEqual({});
    }
  });

  it("Team Leader / PMM / PMD 管整個分組,只有管理者能設", async () => {
    for (const role of ["TEAM_LEADER", "PMM", "PMD"] as const) {
      const result = await setGroupRoleAssignments("b1", "g1", role, ["u_a"]);
      expect(result.error).toMatch(/僅管理者/);
    }
    expect(rolesOf("g1", "TEAM_LEADER")).toEqual(["u_tl"]); // 沒被動到(也不能把自己換掉或加人)
  });

  it("別的分組(不是他當 Team Leader 的)不行,即使同一個看板", async () => {
    const result = await setGroupRoleAssignments("b1", "g2", "SW_DM", ["u_a"]);
    expect(result.error).toMatch(/權限不足/);
    expect(rolesOf("g2", "SW_DM")).toEqual([]);
  });

  it("不能拿自己分組的資格,配上別的看板的 boardId 去改別的分組", async () => {
    // g_other 屬於 b2,但前端傳 b1:驗證 group.boardId 對不上,直接擋下。
    const result = await setGroupRoleAssignments("b1", "g_other", "SW_DM", ["u_a"]);
    expect(result.error).toBe("找不到這個分組");
    expect(rolesOf("g_other", "SW_DM")).toEqual([]);
  });

  it("一般成員(不是這個分組的 Team Leader)不行", async () => {
    state.session = { userId: "u_x", role: "MEMBER", name: "X", email: "x@example.com" };
    const result = await setGroupRoleAssignments("b1", "g1", "SW_DM", ["u_a"]);
    expect(result.error).toMatch(/權限不足/);
  });
});

describe("分組的 Team Leader 指定各職能的 member", () => {
  it("在自己的分組可以", async () => {
    expect(await setGroupMembers("b1", "g1", "SW", ["u_a", "u_a", "u_b"])).toEqual({});
    expect(state.members.map((m) => m.userId)).toEqual(["u_a", "u_b"]); // 重複的人只算一個
  });

  it("別的分組不行", async () => {
    const result = await setGroupMembers("b1", "g2", "SW", ["u_a"]);
    expect(result.error).toMatch(/權限不足/);
    expect(state.members).toEqual([]);
  });

  it("一般成員不行", async () => {
    state.session = { userId: "u_x", role: "MEMBER", name: "X", email: "x@example.com" };
    expect((await setGroupMembers("b1", "g1", "SW", ["u_a"])).error).toMatch(/權限不足/);
  });
});

describe("管理者", () => {
  it("任何分組、任何角色都能設", async () => {
    state.session = { userId: "u_admin", role: "ADMIN", name: "A", email: "a@example.com" };
    expect(await setGroupRoleAssignments("b1", "g2", "TEAM_LEADER", ["u_z"])).toEqual({});
    expect(rolesOf("g2", "TEAM_LEADER")).toEqual(["u_z"]);
    expect(await setGroupMembers("b1", "g2", "ME", ["u_z"])).toEqual({});
  });
});

describe("看板層級的 Team Leader(管理者在「整個看板」設的)", () => {
  const boardRolesOf = (boardId: string, role: string) => state.boardRoles.filter((r) => r.boardId === boardId && r.role === role).map((r) => r.userId);
  const asBoardLeader = () => {
    state.roles = []; // 沒有任何分組層級的資格,只有整個看板的
    state.boardRoles = [{ boardId: "b1", role: "TEAM_LEADER", userId: "u_tl" }];
  };

  it("可以在「整個看板」指定各職能的 DM", async () => {
    asBoardLeader();
    expect(await setBoardRoleAssignments("b1", "SW_DM", ["u_a"])).toEqual({});
    expect(boardRolesOf("b1", "SW_DM")).toEqual(["u_a"]);
  });

  it("Team Leader / PMM / PMD 在看板層級也鎖住,只有管理者能設(包含他自己的 Team Leader)", async () => {
    asBoardLeader();
    for (const role of ["TEAM_LEADER", "PMM", "PMD"] as const) {
      expect((await setBoardRoleAssignments("b1", role, ["u_a"])).error).toMatch(/權限不足/);
    }
    expect(boardRolesOf("b1", "TEAM_LEADER")).toEqual(["u_tl"]);
  });

  it("別的看板不行", async () => {
    asBoardLeader();
    expect((await setBoardRoleAssignments("b2", "SW_DM", ["u_a"])).error).toMatch(/權限不足/);
    expect(boardRolesOf("b2", "SW_DM")).toEqual([]);
  });

  it("分組層級的 Team Leader(不是看板層級)不能改整個看板的角色", async () => {
    // beforeEach 的設定:u_tl 只是 g1 的 Team Leader
    expect((await setBoardRoleAssignments("b1", "SW_DM", ["u_a"])).error).toMatch(/權限不足/);
  });

  it("這個看板的每個分組都能指定 DM 與 member,即使他不是那個分組的 Team Leader", async () => {
    asBoardLeader();
    expect(await setGroupRoleAssignments("b1", "g2", "HW_DM", ["u_a"])).toEqual({});
    expect(rolesOf("g2", "HW_DM")).toEqual(["u_a"]);
    expect(await setGroupMembers("b1", "g2", "ME", ["u_b"])).toEqual({});
    expect(state.members.map((m) => m.userId)).toEqual(["u_b"]);
  });

  it("別的看板的分組不行", async () => {
    asBoardLeader();
    expect((await setGroupRoleAssignments("b2", "g_other", "SW_DM", ["u_a"])).error).toMatch(/權限不足/);
    expect(rolesOf("g_other", "SW_DM")).toEqual([]);
  });

  it("沒有任何 Team Leader 資格的一般成員不行", async () => {
    state.roles = [];
    expect((await setBoardRoleAssignments("b1", "SW_DM", ["u_a"])).error).toMatch(/權限不足/);
  });

  it("看板擁有者照舊可以設任何看板角色", async () => {
    state.session = { userId: "u_owner", role: "SUPERVISOR", name: "Owner", email: "o@example.com" };
    expect(await setBoardRoleAssignments("b1", "TEAM_LEADER", ["u_z"])).toEqual({});
  });
});

describe("實作成員、Resource 成員:分組自己設定 vs 沿用看板", () => {
  const asAdmin = () => {
    state.session = { userId: "u_admin", role: "ADMIN", name: "A", email: "a@example.com" };
  };
  const group = (id: string) => state.groups.find((g) => g.id === id)!;

  it("在分組改某個職能的名單 = 這個分組自己設定那個職能(別的職能仍然沿用)", async () => {
    expect(await setGroupMembers("b1", "g1", "SW", ["u_a"])).toEqual({});
    expect(group("g1").memberOverrides).toEqual(["SW"]);
    // 再改一次同一個職能,不會重複記
    await setGroupMembers("b1", "g1", "SW", ["u_b"]);
    expect(group("g1").memberOverrides).toEqual(["SW"]);
    await setGroupMembers("b1", "g1", "QA", ["u_c"]);
    expect(group("g1").memberOverrides).toEqual(["SW", "QA"]);
  });

  it("管理者把某個職能改回沿用看板:取消「自己設定」,並從看板重新同步這個分組", async () => {
    asAdmin();
    group("g1").memberOverrides = ["SW", "QA"];
    expect(await setGroupMemberInherit("b1", "g1", "SW", true)).toEqual({});
    expect(group("g1").memberOverrides).toEqual(["QA"]);
    expect(sync).toHaveBeenCalledWith("b1", { groupId: "g1" }, expect.anything());
    // 改成自己設定:名單先不動,只記下來,也不需要同步
    sync.mockClear();
    expect(await setGroupMemberInherit("b1", "g1", "ME", false)).toEqual({});
    expect(group("g1").memberOverrides).toEqual(["QA", "ME"]);
    expect(sync).not.toHaveBeenCalled();
  });

  it("沿用看板的開關只有管理者能動(分組的 Team Leader 也不行),也不能拿別的看板的 boardId 去改", async () => {
    group("g1").memberOverrides = ["SW"];
    expect((await setGroupMemberInherit("b1", "g1", "SW", true)).error).toMatch(/權限不足/);
    expect(group("g1").memberOverrides).toEqual(["SW"]);
    asAdmin();
    await setGroupMemberInherit("b2", "g1", "SW", true); // g1 不屬於 b2
    expect(group("g1").memberOverrides).toEqual(["SW"]);
  });

  it("管理者在分組改 Resource 名單 = 這個分組自己設定 Resource;改回沿用 → 重新同步", async () => {
    asAdmin();
    await setGroupResourceMembers("b1", "g1", ["r1", "r1", "r2"]);
    expect(state.groupResources.map((r) => r.resourceId)).toEqual(["r1", "r2"]);
    expect(group("g1").resourceOverride).toBe(true);
    expect(await setGroupResourceInherit("b1", "g1", true)).toEqual({});
    expect(group("g1").resourceOverride).toBe(false);
    expect(sync).toHaveBeenCalledWith("b1", { groupId: "g1" }, expect.anything());
  });

  it("分組的 Team Leader 不能改 Resource 成員,也不能動沿用開關", async () => {
    await expect(setGroupResourceMembers("b1", "g1", ["r1"])).rejects.toThrow();
    expect(state.groupResources).toEqual([]);
    expect((await setGroupResourceInherit("b1", "g1", false)).error).toMatch(/權限不足/);
    expect(group("g1").resourceOverride).toBe(false);
  });
});

describe("看板層級的實作成員與 Resource 成員", () => {
  const boardMembersOf = (boardId: string, discipline: string) =>
    state.boardMembers.filter((m) => m.boardId === boardId && m.discipline === discipline).map((m) => m.userId);
  const asBoardLeader = () => {
    state.roles = [];
    state.boardRoles = [{ boardId: "b1", role: "TEAM_LEADER", userId: "u_tl" }];
  };
  const asOwner = () => {
    state.session = { userId: "u_owner", role: "SUPERVISOR", name: "Owner", email: "o@example.com" };
  };

  it("看板擁有者可以設各職能的實作成員(整批取代、重複的人只算一個),並同步所有沒有自己設定的分組", async () => {
    asOwner();
    expect(await setBoardMembers("b1", "SW", ["u_a", "u_a", "u_b"])).toEqual({});
    expect(boardMembersOf("b1", "SW")).toEqual(["u_a", "u_b"]);
    expect(await setBoardMembers("b1", "SW", ["u_c"])).toEqual({});
    expect(boardMembersOf("b1", "SW")).toEqual(["u_c"]);
    expect(sync).toHaveBeenCalledWith("b1", {}, expect.anything());
  });

  it("管理者與整個看板的 Team Leader 可以設實作成員", async () => {
    state.session = { userId: "u_admin", role: "ADMIN", name: "A", email: "a@example.com" };
    expect(await setBoardMembers("b1", "ME", ["u_a"])).toEqual({});
    state.session = { userId: "u_tl", role: "MEMBER", name: "TL", email: "tl@example.com" };
    asBoardLeader();
    expect(await setBoardMembers("b1", "QA", ["u_b"])).toEqual({});
    expect(boardMembersOf("b1", "QA")).toEqual(["u_b"]);
  });

  it("別的看板的 Team Leader、分組層級的 Team Leader、一般成員都不行", async () => {
    asBoardLeader();
    expect((await setBoardMembers("b2", "SW", ["u_a"])).error).toMatch(/權限不足/);
    state.roles = [{ groupId: "g1", role: "TEAM_LEADER", userId: "u_tl" }];
    state.boardRoles = [];
    expect((await setBoardMembers("b1", "SW", ["u_a"])).error).toMatch(/權限不足/);
    state.roles = [];
    expect((await setBoardMembers("b1", "SW", ["u_a"])).error).toMatch(/權限不足/);
    expect(state.boardMembers).toEqual([]);
    expect(sync).not.toHaveBeenCalled();
  });

  it("Resource 成員只有管理者與看板擁有者能設;整個看板的 Team Leader 不行", async () => {
    asBoardLeader();
    expect((await setBoardResourceMembers("b1", ["r1"])).error).toMatch(/權限不足/);
    expect(state.boardResources).toEqual([]);
    asOwner();
    expect(await setBoardResourceMembers("b1", ["r1", "r1", "r2"])).toEqual({});
    expect(state.boardResources.map((r) => r.resourceId)).toEqual(["r1", "r2"]);
    expect(await setBoardResourceMembers("b1", [])).toEqual({});
    expect(state.boardResources).toEqual([]);
    expect(sync).toHaveBeenCalledWith("b1", {}, expect.anything());
  });
});
