import { describe, expect, it } from "vitest";
import { metFromDecisions } from "./gateCriterion";

describe("metFromDecisions", () => {
  it("沒有確認人:不由表態決定(維持手動勾選)", () => {
    expect(metFromDecisions([])).toBeNull();
  });
  it("全部同意才算達成", () => {
    expect(metFromDecisions(["APPROVED"])).toBe(true);
    expect(metFromDecisions(["APPROVED", "APPROVED"])).toBe(true);
  });
  it("有人還沒表態、或有人不同意,都不算", () => {
    expect(metFromDecisions(["APPROVED", null])).toBe(false);
    expect(metFromDecisions(["APPROVED", "REJECTED"])).toBe(false);
    expect(metFromDecisions([null])).toBe(false);
  });
});
