import { describe, expect, it, vi, beforeEach } from "vitest";
import { UserError } from "@/lib/userError";

/**
 * 甘特圖選取列的批次「指派人員」「使用樣機」:逐項走單項的 server action,
 * 沒權限 / 做不到的項目略過並說明,不會讓整批失敗;單項的提醒(樣機重疊)要帶出來。
 */

const state = {
  /** 項目 id → 現有的人員分配 / 樣機 */
  items: {} as Record<string, { users: string[]; units: string[] }>,
  /** 這些項目單項動作會被擋下(沒權限) */
  denied: new Set<string>(),
  calls: [] as string[],
  warning: undefined as string | undefined,
};

vi.mock("@/lib/session", () => ({ requireSession: async () => ({ userId: "u1", role: "MEMBER" }) }));
vi.mock("@/lib/boardAccess", () => ({ requireBoardAccess: async () => undefined }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: async () => ({ id: "u_x" }) },
    item: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in
          .filter((id) => state.items[id])
          .map((id) => ({
            id,
            assignments: state.items[id].users.map((userId) => ({ userId })),
            protoUnits: state.items[id].units.map((protoUnitId) => ({ protoUnitId })),
          })),
    },
  },
}));
vi.mock("@/lib/actions/assignment", () => ({
  upsertAssignment: async (_b: string, itemId: string, userId: string, pct: number) => {
    if (state.denied.has(itemId)) throw new UserError("權限不足:僅該項目的負責人或管理者可以調整人員分配");
    state.calls.push(`upsert ${itemId} ${userId} ${pct}`);
  },
  removeAssignment: async (_b: string, itemId: string, userId: string) => {
    if (state.denied.has(itemId)) throw new UserError("權限不足:僅該項目的負責人或管理者可以調整人員分配");
    state.calls.push(`remove ${itemId} ${userId}`);
  },
}));
vi.mock("@/lib/actions/itemProtoUnits", () => ({
  setItemProtoUnits: async (itemId: string, ids: string[]) => {
    if (state.denied.has(itemId)) return { error: "權限不足:你只能編輯自己被指派或負責項目的「使用樣機」" };
    state.calls.push(`units ${itemId} ${[...ids].sort().join(",")}`);
    return state.warning ? { warning: state.warning } : {};
  },
}));

const { bulkAssignUsers, bulkSetProtoUnits } = await import("./bulkAssign");

beforeEach(() => {
  state.items = { a: { users: [], units: ["p1"] }, b: { users: ["u_x"], units: [] }, c: { users: [], units: ["p1", "p2"] } };
  state.denied = new Set();
  state.calls = [];
  state.warning = undefined;
});

describe("bulkAssignUsers", () => {
  it("加入:每項各自套用配置比例;已經有的項目改成新的比例", async () => {
    const result = await bulkAssignUsers("b1", ["a", "b"], "u_x", 50, "add");
    expect(result).toEqual({ applied: 2, skipped: [] });
    expect(state.calls).toEqual(["upsert a u_x 50", "upsert b u_x 50"]);
  });

  it("沒權限的項目略過並說明,其他項目照做", async () => {
    state.denied.add("a");
    const result = await bulkAssignUsers("b1", ["a", "b", "c"], "u_x", 100, "add");
    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual(["1 項:權限不足:僅該項目的負責人或管理者可以調整人員分配"]);
  });

  it("移除:本來就沒被分配的不呼叫移除,並說明", async () => {
    const result = await bulkAssignUsers("b1", ["a", "b"], "u_x", 100, "remove");
    expect(result.applied).toBe(1);
    expect(state.calls).toEqual(["remove b u_x"]);
    expect(result.skipped).toEqual(["1 項:這個人本來就沒有被分配到,不用移除"]);
  });

  it("不存在的項目與空選取:說明而不丟錯", async () => {
    expect((await bulkAssignUsers("b1", ["a", "zzz"], "u_x", 100, "add")).skipped).toEqual(["1 項:項目不存在或不屬於這個看板"]);
    expect(await bulkAssignUsers("b1", [], "u_x", 100, "add")).toEqual({ applied: 0, skipped: ["沒有選取任何項目"] });
  });
});

describe("bulkSetProtoUnits", () => {
  it("加入:保留每一項原本選的,再多加", async () => {
    const result = await bulkSetProtoUnits("b1", ["a", "b", "c"], ["p2"], "add");
    expect(state.calls).toEqual(["units a p1,p2", "units b p2"]);
    expect(result.applied).toBe(2);
    expect(result.skipped).toEqual(["1 項:已經選了這些樣機"]);
  });

  it("移除:只拿掉指定的樣機", async () => {
    await bulkSetProtoUnits("b1", ["a", "c"], ["p1"], "remove");
    expect(state.calls).toEqual(["units a ", "units c p2"]);
  });

  it("沒權限的項目略過並說明;樣機重疊的提醒帶出來", async () => {
    state.denied.add("b");
    state.warning = "M3 EVT1 #1 在 11/20 的使用超過 100%";
    const result = await bulkSetProtoUnits("b1", ["a", "b"], ["p2"], "add");
    expect(result.applied).toBe(1);
    expect(result.skipped).toEqual([
      "1 項:權限不足:你只能編輯自己被指派或負責項目的「使用樣機」",
      "注意:M3 EVT1 #1 在 11/20 的使用超過 100%",
    ]);
  });

  it("沒選樣機:請先選", async () => {
    await expect(bulkSetProtoUnits("b1", ["a"], [], "add")).rejects.toThrow(/請先選/);
  });
});
