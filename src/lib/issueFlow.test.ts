import { describe, expect, it } from "vitest";
import {
  audienceFor,
  availableMoves,
  backStages,
  canConvertToRepair,
  canMoveStage,
  flowMessage,
  isStageMove,
  isStuck,
  nextStages,
  STAGE_DATE_FIELD,
  stageAfterUnlock,
  stageTrack,
  type FlowActor,
} from "./issueFlow";

describe("流程階段的線", () => {
  it("Issue:通報 → FAE 評估 →(RD 或直接)→ 待 Sales 判斷", () => {
    expect(nextStages("ISSUE", "REPORTED")).toEqual(["FAE_REVIEW"]);
    expect(nextStages("ISSUE", "FAE_REVIEW")).toEqual(["RD_WORKING", "SALES_DECISION"]);
    expect(nextStages("ISSUE", "RD_WORKING")).toEqual(["FAE_REVIEW", "SALES_DECISION"]);
    expect(nextStages("ISSUE", "SALES_DECISION")).toEqual(["REPORTED"]);
  });
  it("Repair:要送回走運送中,現場更換直接維修中", () => {
    expect(nextStages("REPAIR", "FAE_REVIEW")).toEqual(["IN_TRANSIT", "REPAIRING"]);
    expect(nextStages("REPAIR", "IN_TRANSIT")).toEqual(["RECEIVED"]);
    expect(nextStages("REPAIR", "RECEIVED")).toEqual(["REPAIRING"]);
    expect(nextStages("REPAIR", "REPAIRING")).toEqual(["REPAIRED"]);
  });
  it("Repair:客戶自送的件可以從已通報直接收件", () => {
    expect(nextStages("REPAIR", "REPORTED")).toEqual(["FAE_REVIEW", "IN_TRANSIT", "RECEIVED"]);
    expect(backStages("REPAIR", "RECEIVED")).toEqual(["REPORTED", "IN_TRANSIT"]);
  });
  it("進到運送 / 收件 / 維修 / 完成會自動帶日期的欄位", () => {
    expect(STAGE_DATE_FIELD).toEqual({ IN_TRANSIT: "shippedDate", RECEIVED: "receivedDate", REPAIRING: "repairStartDate", REPAIRED: "repairDoneDate" });
  });
  it("結案(簽核中 / 已結案)不能手動推進,也沒有可退回的按鈕", () => {
    expect(availableMoves("ISSUE", "CLOSED")).toEqual([]);
    expect(availableMoves("REPAIR", "CLOSING")).toEqual([]);
  });
  it("退回:只退回進度條上排在前面、而且真的有線指過來的階段", () => {
    expect(backStages("ISSUE", "FAE_REVIEW")).toEqual(["REPORTED"]);
    expect(backStages("ISSUE", "SALES_DECISION")).toEqual(["FAE_REVIEW", "RD_WORKING"]);
    expect(backStages("REPAIR", "REPAIRING")).toEqual(["FAE_REVIEW", "RECEIVED"]);
    expect(backStages("ISSUE", "REPORTED")).toEqual([]);
  });
  it("availableMoves:往前與退回合起來,沒有重複", () => {
    const moves = availableMoves("ISSUE", "RD_WORKING");
    expect(moves.map((m) => `${m.direction}:${m.to}`)).toEqual(["FORWARD:FAE_REVIEW", "FORWARD:SALES_DECISION"]);
    const sales = availableMoves("ISSUE", "SALES_DECISION");
    expect(sales.map((m) => `${m.direction}:${m.to}`)).toEqual(["FORWARD:REPORTED", "BACK:FAE_REVIEW", "BACK:RD_WORKING"]);
  });
  it("isStageMove 擋掉不存在的線", () => {
    expect(isStageMove("ISSUE", "REPORTED", "SALES_DECISION")).toBe(false);
    expect(isStageMove("ISSUE", "REPORTED", "FAE_REVIEW")).toBe(true);
    expect(isStageMove("ISSUE", "REPORTED", "IN_TRANSIT")).toBe(false);
  });
  it("進度條:Issue 沒有運送與維修階段,Repair 沒有 RD / Sales 判斷", () => {
    expect(stageTrack("ISSUE")).not.toContain("IN_TRANSIT");
    expect(stageTrack("REPAIR")).not.toContain("RD_WORKING");
    expect(stageTrack("REPAIR")).not.toContain("SALES_DECISION");
  });
});

describe("Issue 轉 Repair", () => {
  it("只有 Issue 在待 Sales 判斷或 FAE 評估時可以轉", () => {
    expect(canConvertToRepair("ISSUE", "SALES_DECISION")).toBe(true);
    expect(canConvertToRepair("ISSUE", "FAE_REVIEW")).toBe(true);
    expect(canConvertToRepair("ISSUE", "REPORTED")).toBe(false);
    expect(canConvertToRepair("ISSUE", "CLOSED")).toBe(false);
    expect(canConvertToRepair("REPAIR", "SALES_DECISION")).toBe(false);
  });
});

describe("誰能推進階段", () => {
  const actor = (over: Partial<FlowActor>): FlowActor => ({ issueRole: "HANDLER", userId: "u1", lanes: [], ...over });
  const facts = { assigneeIds: ["x"], stage: "FAE_REVIEW" as const, locked: false };
  it("管理者隨時可以,鎖定後也可以", () => {
    expect(canMoveStage(actor({ issueRole: "MANAGER" }), { ...facts, locked: true })).toBe(true);
  });
  it("回報人與沒有角色的人不行", () => {
    expect(canMoveStage(actor({ issueRole: "REPORTER", lanes: ["FAE"] }), facts)).toBe(false);
    expect(canMoveStage(actor({ issueRole: null }), facts)).toBe(false);
  });
  it("處理人:目前這一階輪到的角色是自己的才行", () => {
    expect(canMoveStage(actor({ lanes: ["FAE"] }), facts)).toBe(true);
    expect(canMoveStage(actor({ lanes: ["SALES"] }), facts)).toBe(false);
    expect(canMoveStage(actor({ lanes: [] }), facts)).toBe(false);
  });
  it("負責人本人可以(流程角色還沒設定的團隊也能用)", () => {
    expect(canMoveStage(actor({ userId: "x" }), facts)).toBe(true);
  });
  it("案件鎖定後處理人也不行", () => {
    expect(canMoveStage(actor({ lanes: ["FAE"] }), { ...facts, locked: true })).toBe(false);
  });
  it("結案階段沒有輪到的角色,只有負責人或管理者", () => {
    expect(canMoveStage(actor({ lanes: ["FAE", "SALES", "RD"] }), { ...facts, stage: "CLOSED" })).toBe(false);
  });
});

describe("通知對象與訊息", () => {
  it("新案件:FAE 與管理者", () => {
    expect(audienceFor({ type: "CREATED" })).toEqual({ lanes: ["FAE"], assignees: false, reporter: false, managers: true });
  });
  it("進到 RD 處理中:RD 與負責人", () => {
    expect(audienceFor({ type: "STAGE", to: "RD_WORKING", direction: "FORWARD" })).toMatchObject({ lanes: ["RD"], assignees: true });
  });
  it("寄出 / 收件:Sales、FAE、回報人都知道", () => {
    expect(audienceFor({ type: "STAGE", to: "IN_TRANSIT", direction: "FORWARD" })).toMatchObject({ lanes: ["SALES", "FAE"], reporter: true });
    expect(audienceFor({ type: "STAGE", to: "RECEIVED", direction: "FORWARD" }).reporter).toBe(true);
  });
  it("維修完成:Sales 與回報人,訊息提醒結案與維修日報", () => {
    expect(audienceFor({ type: "STAGE", to: "REPAIRED", direction: "FORWARD" })).toMatchObject({ lanes: ["SALES"], reporter: true });
    expect(flowMessage("CS1", "", { type: "STAGE", to: "REPAIRED", direction: "FORWARD" })).toContain("維修日報");
  });
  it("RD 在 Mantis 回應:FAE、負責人、回報人", () => {
    expect(audienceFor({ type: "RD_UPDATED" })).toEqual({ lanes: ["FAE"], assignees: true, reporter: true, managers: false });
  });
  it("轉 Repair:FAE、Sales、負責人、管理者", () => {
    expect(audienceFor({ type: "TO_REPAIR" })).toEqual({ lanes: ["FAE", "SALES"], assignees: true, reporter: false, managers: true });
  });
  it("結案:負責人、回報人、管理者", () => {
    expect(audienceFor({ type: "CLOSED" })).toEqual({ lanes: [], assignees: true, reporter: true, managers: true });
  });
  it("卡關:該階段的角色、負責人、管理者;訊息講階段與天數", () => {
    const ev = { type: "STUCK" as const, stage: "FAE_REVIEW" as const, days: 4 };
    expect(audienceFor(ev)).toEqual({ lanes: ["FAE"], assignees: true, reporter: false, managers: true });
    expect(flowMessage("CS1", "充電站", ev)).toBe("案件 CS1 在「FAE 評估」已經 4 個工作天沒有進展:充電站");
  });
  it("退回的訊息說是被退回", () => {
    expect(flowMessage("CS1", "", { type: "STAGE", to: "REPORTED", direction: "BACK" })).toContain("被退回到「已通報」");
  });
  it("一般推進的訊息指出輪到誰", () => {
    expect(flowMessage("CS1", "", { type: "STAGE", to: "FAE_REVIEW", direction: "FORWARD" })).toBe("案件 CS1 進到「FAE 評估」,輪到 FAE 處理");
  });
});

describe("卡關判斷", () => {
  it("到天數且沒提醒過才算", () => {
    expect(isStuck("FAE_REVIEW", 3, 3, false)).toBe(true);
    expect(isStuck("FAE_REVIEW", 2, 3, false)).toBe(false);
    expect(isStuck("FAE_REVIEW", 9, 3, true)).toBe(false);
  });
  it("設 0 = 不提醒;結案階段不提醒", () => {
    expect(isStuck("FAE_REVIEW", 99, 0, false)).toBe(false);
    expect(isStuck("CLOSED", 99, 3, false)).toBe(false);
    expect(isStuck("CLOSING", 99, 3, false)).toBe(false);
  });
});

describe("解除鎖定後的階段", () => {
  it("回到結案前那一階", () => {
    expect(stageAfterUnlock("ISSUE")).toBe("SALES_DECISION");
    expect(stageAfterUnlock("REPAIR")).toBe("REPAIRED");
  });
});
