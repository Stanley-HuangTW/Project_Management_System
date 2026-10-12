import { describe, expect, it } from "vitest";
import { attributeAudit, startImpersonationError } from "./impersonation";

const admin = { userId: "u_admin" };

describe("startImpersonationError", () => {
  it("管理者切到別人:可以", () => {
    expect(startImpersonationError(admin, "ADMIN", "u_member", true)).toBeNull();
  });

  it("不是管理者(用資料庫現在的角色判斷)不能切", () => {
    expect(startImpersonationError(admin, "MEMBER", "u_member", true)).toMatch(/只有管理者/);
    expect(startImpersonationError(admin, "SUPERVISOR", "u_member", true)).toMatch(/只有管理者/);
    expect(startImpersonationError(admin, null, "u_member", true)).toMatch(/只有管理者/);
  });

  it("已經在代操作中不能再切(不能一層疊一層)", () => {
    expect(startImpersonationError({ userId: "u_member", impersonatorId: "u_admin" }, "ADMIN", "u_other", true)).toMatch(/先退出/);
  });

  it("找不到對象、或切給自己都不行", () => {
    expect(startImpersonationError(admin, "ADMIN", "u_ghost", false)).toMatch(/找不到/);
    expect(startImpersonationError(admin, "ADMIN", "u_admin", true)).toMatch(/自己/);
  });
});

describe("attributeAudit", () => {
  const impersonating = { userId: "u_member", name: "王小明", impersonatorId: "u_admin" };

  it("代操作中:紀錄記管理者,訊息註記是以誰的身分", () => {
    expect(attributeAudit(impersonating, "u_member", "新增產品「M3」")).toEqual({
      actorId: "u_admin",
      message: "新增產品「M3」〔管理者以「王小明」的身分操作〕",
    });
  });

  it("沒有代操作、或沒有 session(排程、MCP):照原樣", () => {
    expect(attributeAudit({ userId: "u_admin", name: "Admin" }, "u_admin", "新增產品")).toEqual({ actorId: "u_admin", message: "新增產品" });
    expect(attributeAudit(null, "u_member", "新增產品")).toEqual({ actorId: "u_member", message: "新增產品" });
  });

  it("代操作中,但這筆紀錄的 actorId 不是被檢視的人(例如系統的 null):照原樣,不亂改", () => {
    expect(attributeAudit(impersonating, null, "系統自動")).toEqual({ actorId: null, message: "系統自動" });
    expect(attributeAudit(impersonating, "u_admin", "管理者結束檢視")).toEqual({ actorId: "u_admin", message: "管理者結束檢視" });
  });
});
