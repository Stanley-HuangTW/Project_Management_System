import { describe, expect, it } from "vitest";
import { approvalOutcome, approvalPrecondition, canSignStep, planApprovalSteps, stepSummary, stepToSign } from "./issueApproval";

const graph = [
  { id: "emp", supervisorId: "boss1" },
  { id: "boss1", supervisorId: "boss2" },
  { id: "boss2", supervisorId: null },
  { id: "loner", supervisorId: null },
];

describe("planApprovalSteps", () => {
  it("預設 1 階:負責人的直屬主管", () => {
    expect(planApprovalSteps({ ownerId: "emp", requesterId: "x", graph, levels: 1 })).toEqual([{ level: 1, approverId: "boss1", auto: false }]);
  });
  it("2 階:直屬 + 二階,各階同時送審", () => {
    expect(planApprovalSteps({ ownerId: "emp", requesterId: "x", graph, levels: 2 }).map((s) => s.approverId)).toEqual(["boss1", "boss2"]);
  });
  it("設定的階數比主管鏈長就簽到最高那一階", () => {
    expect(planApprovalSteps({ ownerId: "emp", requesterId: "x", graph, levels: 5 })).toHaveLength(2);
  });
  it("沒有負責人就用申請人的主管鏈", () => {
    expect(planApprovalSteps({ ownerId: null, requesterId: "emp", graph, levels: 1 })[0].approverId).toBe("boss1");
  });
  it("找不到主管:一階、由管理者簽(approverId = null)", () => {
    expect(planApprovalSteps({ ownerId: "loner", requesterId: "x", graph, levels: 2 })).toEqual([{ level: 1, approverId: null, auto: false }]);
  });
  it("申請人自己就是某一階主管:那階自動視為已簽", () => {
    const steps = planApprovalSteps({ ownerId: "emp", requesterId: "boss1", graph, levels: 2 });
    expect(steps).toEqual([
      { level: 1, approverId: "boss1", auto: true },
      { level: 2, approverId: "boss2", auto: false },
    ]);
  });
});

describe("canSignStep", () => {
  const base = { userId: "boss1", isSystemAdmin: false, isIssueManager: false, requesterId: "emp", step: { approverId: "boss1", decision: null } as const };
  it("簽核人本人可以", () => {
    expect(canSignStep(base)).toBe(true);
  });
  it("別人不行", () => {
    expect(canSignStep({ ...base, userId: "other" })).toBe(false);
  });
  it("代簽的人可以(副主管)", () => {
    expect(canSignStep({ ...base, userId: "deputy", delegatedFor: ["boss1"] })).toBe(true);
    expect(canSignStep({ ...base, userId: "deputy", delegatedFor: ["boss9"] })).toBe(false);
  });
  it("已經簽過的不能再簽", () => {
    expect(canSignStep({ ...base, step: { approverId: "boss1", decision: "APPROVED" } })).toBe(false);
  });
  it("申請人不能簽自己的申請,系統管理員例外", () => {
    expect(canSignStep({ ...base, userId: "boss1", requesterId: "boss1" })).toBe(false);
    expect(canSignStep({ ...base, userId: "admin", isSystemAdmin: true, requesterId: "admin" })).toBe(true);
  });
  it("系統管理員可以簽任何一階", () => {
    expect(canSignStep({ ...base, userId: "admin", isSystemAdmin: true })).toBe(true);
  });
  it("沒有簽核人的那階:ISSUE TRACKER 管理者可以,其他人不行", () => {
    const step = { approverId: null, decision: null } as const;
    expect(canSignStep({ ...base, userId: "mgr", isIssueManager: true, step })).toBe(true);
    expect(canSignStep({ ...base, userId: "handler", step })).toBe(false);
  });
});

describe("approvalOutcome", () => {
  it("全部核准 = 核准", () => {
    expect(approvalOutcome([{ decision: "APPROVED" }, { decision: "APPROVED" }])).toBe("APPROVED");
  });
  it("還有人沒簽 = 簽核中", () => {
    expect(approvalOutcome([{ decision: "APPROVED" }, { decision: null }])).toBe("PENDING");
  });
  it("任何一階退回 = 退回(就算別階還沒簽)", () => {
    expect(approvalOutcome([{ decision: "REJECTED" }, { decision: null }])).toBe("REJECTED");
  });
  it("沒有任何簽核階 = 簽核中(不會憑空核准)", () => {
    expect(approvalOutcome([])).toBe("PENDING");
  });
});

describe("stepToSign", () => {
  const steps = [
    { level: 2, approverId: "boss2", decision: null },
    { level: 1, approverId: "boss1", decision: "APPROVED" as const },
  ];
  const who = { userId: "boss2", isSystemAdmin: false, isIssueManager: false, requesterId: "emp" };
  it("簽自己那一階", () => {
    expect(stepToSign(steps, who)?.level).toBe(2);
  });
  it("沒有能簽的階回 null", () => {
    expect(stepToSign(steps, { ...who, userId: "boss1" })).toBeNull();
  });
});

describe("approvalPrecondition", () => {
  it("結案:問題案件在 FAE 評估 / 待 Sales 判斷;維修案件在維修完成", () => {
    expect(approvalPrecondition("CLOSE", "ISSUE", "SALES_DECISION")).toBeNull();
    expect(approvalPrecondition("CLOSE", "ISSUE", "FAE_REVIEW")).toBeNull();
    expect(approvalPrecondition("CLOSE", "ISSUE", "REPORTED")).toContain("才能申請結案簽核");
    expect(approvalPrecondition("CLOSE", "REPAIR", "REPAIRED")).toBeNull();
    expect(approvalPrecondition("CLOSE", "REPAIR", "REPAIRING")).toContain("維修完成");
  });
  it("轉維修:跟 Issue 轉 Repair 同樣的條件", () => {
    expect(approvalPrecondition("TO_REPAIR", "ISSUE", "SALES_DECISION")).toBeNull();
    expect(approvalPrecondition("TO_REPAIR", "ISSUE", "REPORTED")).not.toBeNull();
    expect(approvalPrecondition("TO_REPAIR", "REPAIR", "SALES_DECISION")).not.toBeNull();
  });
  it("外勤:沒結案的案件都可以,結案後與結案簽核中不行", () => {
    expect(approvalPrecondition("FIELD_TRIP", "ISSUE", "FAE_REVIEW")).toBeNull();
    expect(approvalPrecondition("FIELD_TRIP", "REPAIR", "REPAIRING")).toBeNull();
    expect(approvalPrecondition("FIELD_TRIP", "ISSUE", "CLOSED")).toBe("案件已經結案");
    expect(approvalPrecondition("FIELD_TRIP", "ISSUE", "CLOSING")).toBe("這個案件正在結案簽核中");
  });
});

describe("stepSummary", () => {
  it("每階的簽核人與狀態", () => {
    const label = (n: number) => (n === 1 ? "直屬主管" : "二階主管");
    expect(
      stepSummary(
        [
          { level: 2, approverName: "陳經理", decision: null },
          { level: 1, approverName: "王大明", decision: "APPROVED" },
        ],
        label
      )
    ).toBe("直屬主管 王大明 已簽;二階主管 陳經理 尚待");
    expect(stepSummary([{ level: 1, approverName: null, decision: "REJECTED" }], label)).toBe("管理者 退回");
  });
});
