import { describe, expect, it } from "vitest";
import { formatMinute, parseMinute, snapMinute, validateStartMinute } from "./timeOfDay";

describe("validateStartMinute", () => {
  it("沒排時間(null/undefined)沒問題", () => {
    expect(validateStartMinute(null, 2)).toBeNull();
    expect(validateStartMinute(undefined, 2)).toBeNull();
  });

  it("一天之內的整數分鐘沒問題", () => {
    expect(validateStartMinute(0, 1)).toBeNull();
    expect(validateStartMinute(525, 0.5)).toBeNull();
    expect(validateStartMinute(23 * 60, 1)).toBeNull();
  });

  it("負數、小數、超出一天都不行", () => {
    expect(validateStartMinute(-1, 1)).toBe("開始時間不正確");
    expect(validateStartMinute(10.5, 1)).toBe("開始時間不正確");
    expect(validateStartMinute(1440, 1)).toBe("開始時間不正確");
  });

  it("開始時間加工時不能跨過午夜", () => {
    expect(validateStartMinute(23 * 60 + 30, 1)).toBe("開始時間加上工時不能跨過午夜");
    expect(validateStartMinute(23 * 60 + 30, 0.5)).toBeNull();
  });
});

describe("formatMinute / parseMinute", () => {
  it("來回轉換", () => {
    expect(formatMinute(525)).toBe("08:45");
    expect(formatMinute(0)).toBe("00:00");
    expect(parseMinute("08:45")).toBe(525);
    expect(parseMinute("8:05")).toBe(485);
  });

  it("格式不對回 null", () => {
    expect(parseMinute("25:00")).toBeNull();
    expect(parseMinute("08:60")).toBeNull();
    expect(parseMinute("八點")).toBeNull();
  });
});

describe("snapMinute", () => {
  it("對齊到 15 分鐘並夾在一天之內", () => {
    expect(snapMinute(527)).toBe(525);
    expect(snapMinute(533)).toBe(540);
    expect(snapMinute(-20)).toBe(0);
    expect(snapMinute(5000)).toBe(1425);
  });
});
