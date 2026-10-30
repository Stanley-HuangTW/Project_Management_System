import { afterEach, describe, expect, it, vi } from "vitest";
import { appUrl, mailBody } from "./appUrl";

afterEach(() => vi.unstubAllEnvs());

describe("appUrl", () => {
  it("turns a path inside the app into a full URL using APP_BASE_URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://pm.example.com");
    expect(appUrl("/boards/b1?highlight=i1")).toBe("https://pm.example.com/boards/b1?highlight=i1");
  });

  it("ignores a trailing slash on the base URL", () => {
    vi.stubEnv("APP_BASE_URL", "https://pm.example.com//");
    expect(appUrl("/chat?c=1")).toBe("https://pm.example.com/chat?c=1");
  });

  it("falls back to localhost when no base URL is configured", () => {
    vi.stubEnv("APP_BASE_URL", "");
    expect(appUrl("/boards")).toBe("http://localhost:3000/boards");
  });

  it("leaves an address that is already absolute alone", () => {
    expect(appUrl("https://other.example.com/x")).toBe("https://other.example.com/x");
  });
});

describe("mailBody", () => {
  it("adds the link on its own line after the message", () => {
    vi.stubEnv("APP_BASE_URL", "https://pm.example.com");
    expect(mailBody("待辦事項已經逾期", "/boards/b1")).toBe("待辦事項已經逾期\n\n開啟:https://pm.example.com/boards/b1");
  });

  it("is just the message when there is no link", () => {
    expect(mailBody("待辦事項已經逾期")).toBe("待辦事項已經逾期");
    expect(mailBody("待辦事項已經逾期", "")).toBe("待辦事項已經逾期");
  });
});
