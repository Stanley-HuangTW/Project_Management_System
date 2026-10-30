import { afterEach, describe, expect, it, vi } from "vitest";
import { STALE_BUILD_MESSAGE } from "./staleBuild";
import { UserError, actionErrorMessage, userErrorMessage } from "./userError";

afterEach(() => vi.unstubAllEnvs());

describe("UserError", () => {
  it("is an Error with the reason as its message, so server code can still read it", () => {
    const err = new UserError("權限不足:僅管理者可以執行此操作");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("權限不足:僅管理者可以執行此操作");
  });

  it("carries the reason in its digest, which is what survives production's masking", () => {
    expect(new UserError("找不到使用者").digest).toBe("USER_ERROR:找不到使用者");
  });
});

describe("userErrorMessage", () => {
  it("reads the reason from a UserError", () => {
    expect(userErrorMessage(new UserError("日期格式錯誤"))).toBe("日期格式錯誤");
  });

  it("reads it from what the browser gets: a plain Error that only has the digest", () => {
    const masked = Object.assign(new Error("An error occurred in the Server Components render."), {
      digest: "USER_ERROR:目前密碼不正確",
    });
    expect(userErrorMessage(masked)).toBe("目前密碼不正確");
  });

  it("ignores ordinary errors and Next's own digests", () => {
    expect(userErrorMessage(new Error("boom"))).toBeNull();
    expect(userErrorMessage(Object.assign(new Error("x"), { digest: "2874239491" }))).toBeNull();
    expect(userErrorMessage(Object.assign(new Error("x"), { digest: "NEXT_REDIRECT;replace;/login;307;" }))).toBeNull();
    expect(userErrorMessage(Object.assign(new Error("x"), { digest: "USER_ERROR:" }))).toBeNull();
    expect(userErrorMessage("字串")).toBeNull();
    expect(userErrorMessage(null)).toBeNull();
  });
});

describe("actionErrorMessage", () => {
  it("shows a UserError's reason", () => {
    const masked = Object.assign(new Error("masked"), { digest: "USER_ERROR:只有管理員可以新增資源" });
    expect(actionErrorMessage(masked, "新增失敗")).toBe("只有管理員可以新增資源");
  });

  it("explains a stale page instead of the English message", () => {
    expect(actionErrorMessage(new Error("Failed to find Server Action \"abc\""), "操作失敗")).toBe(STALE_BUILD_MESSAGE);
  });

  it("shows the fallback, not the generic English text, when production masked an unexpected error", () => {
    vi.stubEnv("NODE_ENV", "production");
    const masked = Object.assign(new Error("An error occurred in the Server Components render."), { digest: "2874239491" });
    expect(actionErrorMessage(masked, "新增失敗")).toBe("新增失敗");
  });

  it("keeps the real message of an ordinary error (development, or an error thrown in the browser)", () => {
    expect(actionErrorMessage(new Error("Prisma 說:欄位重複"), "新增失敗")).toBe("Prisma 說:欄位重複");
    vi.stubEnv("NODE_ENV", "production");
    expect(actionErrorMessage(new Error("Failed to fetch"), "新增失敗")).toBe("Failed to fetch");
  });

  it("falls back for anything that is not an Error", () => {
    expect(actionErrorMessage("x", "新增失敗")).toBe("新增失敗");
    expect(actionErrorMessage(undefined, "新增失敗")).toBe("新增失敗");
    expect(actionErrorMessage(new Error(""), "新增失敗")).toBe("新增失敗");
  });
});
