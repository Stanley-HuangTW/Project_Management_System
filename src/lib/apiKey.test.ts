import { describe, expect, it } from "vitest";
import {
  generateApiKey,
  hashApiKey,
  apiKeyPrefix,
  looksLikeApiKey,
  hashesMatch,
  readBearerToken,
} from "./apiKey";

describe("generateApiKey", () => {
  it("is prefixed and never repeats", () => {
    const keys = new Set(Array.from({ length: 50 }, generateApiKey));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(looksLikeApiKey(key)).toBe(true);
  });

  it("rejects anything that is not one of ours", () => {
    expect(looksLikeApiKey("hrapp_")).toBe(false);
    expect(looksLikeApiKey("sk-live-whatever")).toBe(false);
  });
});

describe("hashApiKey", () => {
  it("is deterministic, so a key can be looked up by its hash", () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  it("differs for different keys", () => {
    expect(hashApiKey(generateApiKey())).not.toBe(hashApiKey(generateApiKey()));
  });
});

describe("hashesMatch", () => {
  it("matches a digest against itself and nothing else", () => {
    const a = hashApiKey("one");
    expect(hashesMatch(a, hashApiKey("one"))).toBe(true);
    expect(hashesMatch(a, hashApiKey("two"))).toBe(false);
    expect(hashesMatch(a, "abcd")).toBe(false);
  });
});

describe("apiKeyPrefix", () => {
  it("shows the head only", () => {
    const key = generateApiKey();
    expect(apiKeyPrefix(key)).toBe(key.slice(0, 12));
    expect(key.startsWith(apiKeyPrefix(key))).toBe(true);
  });
});

describe("readBearerToken", () => {
  it("accepts both forms people actually send", () => {
    expect(readBearerToken("Bearer hrapp_abc")).toBe("hrapp_abc");
    expect(readBearerToken("bearer  hrapp_abc ")).toBe("hrapp_abc");
    expect(readBearerToken("hrapp_abc")).toBe("hrapp_abc");
  });

  it("is null when there is nothing to read", () => {
    expect(readBearerToken(null)).toBeNull();
    expect(readBearerToken("Bearer ")).toBeNull();
  });
});
