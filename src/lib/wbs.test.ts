import { describe, expect, it } from "vitest";
import { compareWbsCodes } from "./wbs";

describe("compareWbsCodes", () => {
  const sorted = (codes: string[]) => [...codes].sort(compareWbsCodes);

  it("逐段比數字,不是比字串", () => {
    // 字串比較會把 1.11 排在 1.9 前面,因為 "1" < "9"。
    expect(sorted(["1.9", "1.11", "1.2"])).toEqual(["1.2", "1.9", "1.11"]);
  });

  it("前綴較短的排前面 —— 父項在它的子項之前", () => {
    expect(sorted(["1.2.1", "1.2", "1.2.10", "1.2.2"])).toEqual(["1.2", "1.2.1", "1.2.2", "1.2.10"]);
  });

  it("深度不同的分支照第一段分開", () => {
    expect(sorted(["2.1.1.1", "1.16.2.1", "1.3.1", "10.1"])).toEqual([
      "1.3.1",
      "1.16.2.1",
      "2.1.1.1",
      "10.1",
    ]);
  });

  it("同一個代號視為相等", () => {
    expect(compareWbsCodes("1.2.3", "1.2.3")).toBe(0);
  });

  it("空字串排在最前面,不會把排序弄壞", () => {
    expect(sorted(["1.1", "", "1.2"])).toEqual(["", "1.1", "1.2"]);
  });
});
