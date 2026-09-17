import { describe, it, expect } from "vitest";
import { safeNextPath } from "@/lib/safeNext";

describe("登入後的轉址目標", () => {
  it("本站的路徑照收", () => {
    expect(safeNextPath("/oauth/authorize?client_id=x")).toBe("/oauth/authorize?client_id=x");
  });

  it("沒帶就回預設", () => {
    expect(safeNextPath(null)).toBe("/boards");
    expect(safeNextPath("")).toBe("/boards");
  });

  it("完整網址擋掉 —— 否則登入頁變成別人的轉址器", () => {
    expect(safeNextPath("https://evil.com")).toBe("/boards");
  });

  it("通訊協定相對網址擋掉,瀏覽器會當成外部網站", () => {
    expect(safeNextPath("//evil.com")).toBe("/boards");
  });

  it("反斜線那一招也擋掉", () => {
    // 反斜線要跳脫,否則這個字串裡根本沒有反斜線,測的是別的東西。
    expect(safeNextPath("/\\evil.com")).toBe("/boards");
  });

  it("javascript: 擋掉", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/boards");
  });

  it("換行擋掉 —— 那是拿來截斷標頭的", () => {
    expect(safeNextPath("/boards\nLocation: https://evil.com")).toBe("/boards");
  });

  it("不是字串擋掉", () => {
    expect(safeNextPath(42)).toBe("/boards");
    expect(safeNextPath({ toString: () => "/x" })).toBe("/boards");
  });

  it("可以指定別的預設值", () => {
    expect(safeNextPath("https://evil.com", "/login")).toBe("/login");
  });
});
