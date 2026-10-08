import { describe, expect, it } from "vitest";
import {
  allReviewersApproved,
  describeRiskChanges,
  mantisReadOnly,
  riskPermissions,
  type RiskActors,
  type RiskSnapshot,
} from "./riskWorkflow";

const actors: RiskActors = {
  createdById: "creator",
  ownerId: "owner",
  reviewers: [
    { userId: "rev1", approved: false },
    { userId: "rev2", approved: true },
  ],
};
const perms = (userId: string, status: "OPEN" | "MITIGATING" | "PENDING_REVIEW" | "CLOSED" = "MITIGATING", role: "ADMIN" | "SUPERVISOR" | "MEMBER" = "MEMBER") =>
  riskPermissions({ userId, role, status, actors });

describe("riskPermissions", () => {
  it("建立者、審核人、管理者可以改內容;負責人與一般成員不行", () => {
    expect(perms("creator").canEditContent).toBe(true);
    expect(perms("rev1").canEditContent).toBe(true);
    expect(perms("someone", "MITIGATING", "ADMIN").canEditContent).toBe(true);
    expect(perms("owner").canEditContent).toBe(false);
    expect(perms("stranger").canEditContent).toBe(false);
    expect(perms("stranger", "MITIGATING", "SUPERVISOR").canEditContent).toBe(false);
  });

  it("負責人可以寫進度更新、切換處理狀態、申請結案;一般成員唯讀", () => {
    const owner = perms("owner");
    expect(owner.canPostUpdate).toBe(true);
    expect(owner.canSetWorkingStatus).toBe(true);
    expect(owner.canRequestClosure).toBe(true);
    const stranger = perms("stranger");
    expect(stranger.canPostUpdate).toBe(false);
    expect(stranger.canSetWorkingStatus).toBe(false);
    expect(stranger.canRequestClosure).toBe(false);
  });

  it("建立者不能替負責人申請結案,管理者可以", () => {
    expect(perms("creator").canRequestClosure).toBe(false);
    expect(perms("someone", "OPEN", "ADMIN").canRequestClosure).toBe(true);
  });

  it("待審核中:只有還沒同意的審核人能審,負責人與編輯者可以撤回,不能再切狀態或申請", () => {
    expect(perms("rev1", "PENDING_REVIEW").canReview).toBe(true);
    expect(perms("rev2", "PENDING_REVIEW").canReview).toBe(false); // 已經同意過
    expect(perms("creator", "PENDING_REVIEW").canReview).toBe(false);
    expect(perms("rev1", "MITIGATING").canReview).toBe(false);
    const owner = perms("owner", "PENDING_REVIEW");
    expect(owner.canWithdrawClosure).toBe(true);
    expect(owner.canRequestClosure).toBe(false);
    expect(owner.canSetWorkingStatus).toBe(false);
    expect(perms("stranger", "PENDING_REVIEW").canWithdrawClosure).toBe(false);
  });

  it("已結案:編輯者可以重新開啟,負責人不行,也不能再申請結案", () => {
    expect(perms("creator", "CLOSED").canReopen).toBe(true);
    expect(perms("owner", "CLOSED").canReopen).toBe(false);
    expect(perms("owner", "CLOSED").canRequestClosure).toBe(false);
  });

  it("刪除限建立者與管理者", () => {
    expect(perms("creator").canDelete).toBe(true);
    expect(perms("x", "MITIGATING", "ADMIN").canDelete).toBe(true);
    expect(perms("rev1").canDelete).toBe(false);
    expect(perms("owner").canDelete).toBe(false);
  });

  it("舊資料沒有建立者:只有審核人與管理者能改", () => {
    const legacy = riskPermissions({
      userId: "creator",
      role: "MEMBER",
      status: "OPEN",
      actors: { createdById: null, ownerId: null, reviewers: [] },
    });
    expect(legacy.canEditContent).toBe(false);
  });
});

describe("allReviewersApproved", () => {
  it("沒有審核人不算同意", () => {
    expect(allReviewersApproved([])).toBe(false);
  });
  it("要每一位都同意", () => {
    expect(allReviewersApproved([{ approved: true }, { approved: false }])).toBe(false);
    expect(allReviewersApproved([{ approved: true }, { approved: true }])).toBe(true);
  });
});

describe("describeRiskChanges", () => {
  const base: RiskSnapshot = {
    kind: "RISK",
    status: "OPEN",
    title: "電池交期太長",
    description: "",
    probability: 5,
    impact: 2,
    costImpact: null,
    probabilityPct: null,
    mitigation: "",
    ownerId: "a",
    reviewerIds: ["r1"],
    dueDate: null,
    itemId: null,
  };
  const names = { user: (id: string) => ({ a: "Ann", b: "Bob", r1: "Rey", r2: "Sam" })[id] ?? id, item: (id: string) => `工作項${id}` };

  it("沒變就沒有紀錄", () => {
    expect(describeRiskChanges(base, { ...base }, names)).toEqual([]);
  });

  it("一個欄位一句話", () => {
    const after: RiskSnapshot = {
      ...base,
      kind: "ISSUE",
      status: "MITIGATING",
      title: "電池交期太長,需要 4W 以上",
      probability: 4,
      costImpact: 150000,
      ownerId: "b",
      dueDate: "2026-10-30",
      itemId: "7",
    };
    expect(describeRiskChanges(base, after, names)).toEqual([
      "類型:風險 → 問題",
      "狀態:未處理 → 處理中",
      "標題:「電池交期太長」→「電池交期太長,需要 4W 以上」",
      "機率:5 → 4",
      "金額:未估 → 150000",
      "負責人:Ann → Bob",
      "對策到期日:— → 2026-10-30",
      "相關工作項:未指定 → 工作項7",
    ]);
  });

  it("長文字只講修改了,不把全文塞進紀錄", () => {
    const after = { ...base, description: "很長的說明", mitigation: "測試標準與需求" };
    expect(describeRiskChanges(base, after, names)).toEqual(["修改了說明", "修改了對策與驗收標準"]);
  });

  it("審核人:順序不同不算變,增減才算", () => {
    expect(describeRiskChanges({ ...base, reviewerIds: ["r1", "r2"] }, { ...base, reviewerIds: ["r2", "r1"] }, names)).toEqual([]);
    expect(describeRiskChanges(base, { ...base, reviewerIds: ["r1", "r2"] }, names)).toEqual(["審核人:Rey → Rey、Sam"]);
    expect(describeRiskChanges(base, { ...base, reviewerIds: [] }, names)).toEqual(["審核人:Rey → 無"]);
  });
});

describe("從 Mantis 同步來的問題是唯讀的", () => {
  it("管理者、建立者、負責人、審核人都不能改內容、改狀態、走結案流程或刪除", () => {
    for (const userId of ["admin", "creator", "owner", "rev1"]) {
      const base = riskPermissions({ userId, role: userId === "admin" ? "ADMIN" : "MEMBER", status: "MITIGATING", actors });
      const locked = mantisReadOnly(base);
      expect(locked).toMatchObject({
        canEditContent: false,
        canSetWorkingStatus: false,
        canRequestClosure: false,
        canWithdrawClosure: false,
        canReview: false,
        canReopen: false,
        canDelete: false,
      });
    }
  });

  it("已結案的也不能重新開啟(狀態以 Mantis 為準)", () => {
    const base = riskPermissions({ userId: "admin", role: "ADMIN", status: "CLOSED", actors });
    expect(base.canReopen).toBe(true);
    expect(mantisReadOnly(base).canReopen).toBe(false);
  });

  it("進度更新照常可以寫", () => {
    const base = riskPermissions({ userId: "owner", role: "MEMBER", status: "OPEN", actors });
    expect(base.canPostUpdate).toBe(true);
    expect(mantisReadOnly(base).canPostUpdate).toBe(true);
  });
});
