import { beforeEach, describe, expect, it, vi } from "vitest";

const findBoard = vi.fn();
const countLeads = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    board: { findUnique: (...args: unknown[]) => findBoard(...args) },
    groupRoleAssignment: { count: (...args: unknown[]) => countLeads(...args) },
  },
}));

import { canEditBoardBudget } from "@/lib/boardBudgetRights";

const member = { userId: "u-sy", role: "MEMBER" } as const;

describe("樣機計畫、樣機 BOM、預算的編輯權(整塊看板)", () => {
  beforeEach(() => {
    findBoard.mockReset();
    countLeads.mockReset();
    findBoard.mockResolvedValue({ ownerId: "u-owner" });
    countLeads.mockResolvedValue(0);
  });

  it("管理者直接可以,不用查資料庫", async () => {
    expect(await canEditBoardBudget("b1", { userId: "u-admin", role: "ADMIN" })).toBe(true);
    expect(findBoard).not.toHaveBeenCalled();
  });

  it("看板擁有者可以", async () => {
    expect(await canEditBoardBudget("b1", { userId: "u-owner", role: "MEMBER" })).toBe(true);
  });

  it("這塊看板任一分組的 Team Leader 可以——不限於第一列工作項所在的那個分組", async () => {
    countLeads.mockResolvedValue(1);
    expect(await canEditBoardBudget("b1", member)).toBe(true);
    expect(countLeads).toHaveBeenCalledWith({
      where: { userId: "u-sy", role: "TEAM_LEADER", group: { boardId: "b1" } },
    });
  });

  it("不是 Team Leader(例如只有 PMD、DM)也不是擁有者就不行", async () => {
    expect(await canEditBoardBudget("b1", member)).toBe(false);
  });

  it("找不到看板就不行", async () => {
    findBoard.mockResolvedValue(null);
    expect(await canEditBoardBudget("gone", member)).toBe(false);
  });
});
