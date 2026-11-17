import { describe, expect, it } from "vitest";
import {
  canAddLog,
  canClaimCase,
  canConfirmCase,
  canEditHandlingFields,
  canEditReportFields,
  canManageIssues,
  effectiveIssueRole,
  postLoginPath,
  systemAccess,
} from "./issueAccess";

describe("systemAccess / postLoginPath", () => {
  it("管理者兩個系統都能進,出現選擇頁", () => {
    const a = systemAccess({ role: "ADMIN", pmAccess: false, issueRole: null });
    expect(a).toEqual({ pm: true, issues: true });
    expect(postLoginPath(a)).toBe("/select-system");
  });
  it("既有使用者(預設 pmAccess、沒有 issueRole)照舊直接進看板,不多一頁", () => {
    const a = systemAccess({ role: "MEMBER", pmAccess: true, issueRole: null });
    expect(postLoginPath(a)).toBe("/boards");
  });
  it("只有 ISSUE TRACKER 權限的人直接進 /issues", () => {
    const a = systemAccess({ role: "MEMBER", pmAccess: false, issueRole: "REPORTER" });
    expect(postLoginPath(a)).toBe("/issues");
  });
  it("兩邊都有的非管理者看選擇頁;都沒有的看無權限頁", () => {
    expect(postLoginPath(systemAccess({ role: "SUPERVISOR", pmAccess: true, issueRole: "HANDLER" }))).toBe("/select-system");
    expect(postLoginPath(systemAccess({ role: "MEMBER", pmAccess: false, issueRole: null }))).toBe("/no-access");
  });
});

describe("effectiveIssueRole / canManageIssues", () => {
  it("ADMIN 等同管理者,其他人看 issueRole", () => {
    expect(effectiveIssueRole({ role: "ADMIN", issueRole: null })).toBe("MANAGER");
    expect(effectiveIssueRole({ role: "MEMBER", issueRole: "HANDLER" })).toBe("HANDLER");
    expect(effectiveIssueRole({ role: "MEMBER", issueRole: null })).toBeNull();
  });
  it("選項管理只有管理者", () => {
    expect(canManageIssues("MANAGER")).toBe(true);
    expect(canManageIssues("HANDLER")).toBe(false);
    expect(canManageIssues("REPORTER")).toBe(false);
    expect(canManageIssues(null)).toBe(false);
  });
});

const open = { reporterId: "r1", assigneeIds: ["h1"], locked: false };
const locked = { ...open, locked: true };

describe("案件編輯權限", () => {
  it("回報人只能改自己回報、未鎖定的案件的回報內容,不能改處理內容", () => {
    expect(canEditReportFields("REPORTER", "r1", open)).toBe(true);
    expect(canEditReportFields("REPORTER", "r2", open)).toBe(false);
    expect(canEditReportFields("REPORTER", "r1", locked)).toBe(false);
    expect(canEditHandlingFields("REPORTER", "r1", open)).toBe(false);
  });
  it("處理人只能改自己負責或沒人負責的案件", () => {
    expect(canEditHandlingFields("HANDLER", "h1", open)).toBe(true);
    expect(canEditHandlingFields("HANDLER", "h2", open)).toBe(false);
    expect(canEditHandlingFields("HANDLER", "h2", { ...open, assigneeIds: [] })).toBe(true);
    expect(canEditHandlingFields("HANDLER", "h1", locked)).toBe(false);
  });
  it("管理者隨時能改,鎖定也一樣", () => {
    expect(canEditReportFields("MANAGER", "m", locked)).toBe(true);
    expect(canEditHandlingFields("MANAGER", "m", locked)).toBe(true);
  });
  it("沒有角色什麼都不能做", () => {
    expect(canEditReportFields(null, "x", open)).toBe(false);
    expect(canAddLog(null, "x", open)).toBe(false);
  });
});

describe("時間軸、確認、接手", () => {
  it("鎖定後處理人(負責的)還能補時間軸,回報人不行", () => {
    expect(canAddLog("HANDLER", "h1", locked)).toBe(true);
    expect(canAddLog("HANDLER", "h2", locked)).toBe(false);
    expect(canAddLog("REPORTER", "r1", locked)).toBe(false);
    expect(canAddLog("REPORTER", "r1", open)).toBe(true);
  });
  it("確認完成:案件要是 TC/PC;管理者或回報人才能確認;已鎖定不能再確認", () => {
    expect(canConfirmCase("MANAGER", "m", { ...open, status: "PC" })).toBe(true);
    expect(canConfirmCase("REPORTER", "r1", { ...open, status: "TC" })).toBe(true);
    expect(canConfirmCase("REPORTER", "r2", { ...open, status: "TC" })).toBe(false);
    expect(canConfirmCase("MANAGER", "m", { ...open, status: "OPEN" })).toBe(false);
    expect(canConfirmCase("MANAGER", "m", { ...open, status: "NA" })).toBe(false);
    expect(canConfirmCase("MANAGER", "m", { ...locked, status: "PC" })).toBe(false);
  });
  it("接手:只有處理人、尚未鎖定、沒有負責人的案件", () => {
    expect(canClaimCase("HANDLER", { ...open, assigneeIds: [] })).toBe(true);
    expect(canClaimCase("HANDLER", open)).toBe(false);
    expect(canClaimCase("REPORTER", { ...open, assigneeIds: [] })).toBe(false);
  });
});
