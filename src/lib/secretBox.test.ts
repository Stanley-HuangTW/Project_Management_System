import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secretBox";

describe("secretBox", () => {
  it("加密再解密拿回原文", () => {
    expect(decryptSecret(encryptSecret("my-token-123", "s1"), "s1")).toBe("my-token-123");
  });

  it("密文裡看不到明文,而且同一個明文每次加密的結果不同", () => {
    const a = encryptSecret("my-token-123", "s1");
    const b = encryptSecret("my-token-123", "s1");
    expect(a).not.toContain("my-token-123");
    expect(a).not.toBe(b);
  });

  it("金鑰換了就解不開(回 null,不丟例外)", () => {
    expect(decryptSecret(encryptSecret("x", "s1"), "s2")).toBeNull();
  });

  it("被改過的密文解不開", () => {
    const stored = encryptSecret("my-token-123", "s1");
    const parts = stored.split(".");
    parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
    expect(decryptSecret(parts.join("."), "s1")).toBeNull();
  });

  it("格式不對回 null", () => {
    expect(decryptSecret("not-a-secret", "s1")).toBeNull();
    expect(decryptSecret("", "s1")).toBeNull();
    expect(decryptSecret("v2.a.b.c", "s1")).toBeNull();
  });

  it("中文與長字串也行", () => {
    const text = "權杖-".repeat(200);
    expect(decryptSecret(encryptSecret(text, "s1"), "s1")).toBe(text);
  });
});
