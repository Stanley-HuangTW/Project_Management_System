import { describe, expect, it } from "vitest";
import { defaultTodoAssignee } from "./todoAssignee";

const none = { ownerIds: [], assignments: [], hours: [] };

describe("defaultTodoAssignee", () => {
  it("訊息裡 @ 到的人優先——即使工作項有負責人", () => {
    expect(defaultTodoAssignee({ ...none, mentioned: ["u_shuyi"], ownerIds: ["u_owner"] })).toEqual({ userId: "u_shuyi", reason: "mention" });
  });

  it("@ 好幾位取第一位(依出現的先後)", () => {
    expect(defaultTodoAssignee({ ...none, mentioned: ["u_a", "u_b"] })).toEqual({ userId: "u_a", reason: "mention" });
  });

  it("沒有 @ 就是工作項的負責人", () => {
    expect(defaultTodoAssignee({ ...none, mentioned: [], ownerIds: ["u_owner"], assignments: [{ userId: "u_x", allocationPct: 90 }] })).toEqual({
      userId: "u_owner",
      reason: "owner",
    });
  });

  it("好幾位負責人:取人員分配工作量比例最高的", () => {
    expect(
      defaultTodoAssignee({
        ...none,
        ownerIds: ["u_a", "u_b"],
        assignments: [
          { userId: "u_a", allocationPct: 30 },
          { userId: "u_b", allocationPct: 70 },
        ],
      })
    ).toEqual({ userId: "u_b", reason: "owner" });
  });

  it("好幾位負責人又沒有人員分配:取第一位", () => {
    expect(defaultTodoAssignee({ ...none, ownerIds: ["u_a", "u_b"] })).toEqual({ userId: "u_a", reason: "owner" });
  });

  it("沒有負責人:取人員分配工作量比例最高的", () => {
    expect(
      defaultTodoAssignee({
        ...none,
        assignments: [
          { userId: "u_a", allocationPct: 20 },
          { userId: "u_b", allocationPct: 80 },
        ],
      })
    ).toEqual({ userId: "u_b", reason: "allocation" });
  });

  it("工作量比例一樣高:看誰登記的工時比較多", () => {
    expect(
      defaultTodoAssignee({
        ...none,
        assignments: [
          { userId: "u_a", allocationPct: 50 },
          { userId: "u_b", allocationPct: 50 },
        ],
        hours: [
          { userId: "u_a", hours: 3 },
          { userId: "u_b", hours: 12 },
        ],
      })
    ).toEqual({ userId: "u_b", reason: "allocation" });
  });

  it("沒有負責人也沒有人員分配:取登記工時最多的(同一個人的好幾筆加總)", () => {
    expect(
      defaultTodoAssignee({
        ...none,
        hours: [
          { userId: "u_a", hours: 5 },
          { userId: "u_b", hours: 4 },
          { userId: "u_b", hours: 4 },
        ],
      })
    ).toEqual({ userId: "u_b", reason: "hours" });
  });

  it("什麼都沒有就是沒有預設(待辦事項不指定處理者)", () => {
    expect(defaultTodoAssignee(none)).toBeNull();
  });
});
