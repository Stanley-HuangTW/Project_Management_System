import { describe, expect, it } from "vitest";
import { compareNumericText, compareWbsCodes } from "./wbs";

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

describe("compareNumericText:跟 localeCompare(…, { numeric: true }) 同一個結果(只是比較快)", () => {
  const sign = (n: number) => Math.sign(n);
  const samples = ["", "1", "2", "10", "1.1", "1.2", "1.9", "1.10", "1.11", "1.2.1", "2.1", "10.1", "a1", "a2", "a10", "A1", "專案 2", "專案 10", "1.01", "01"];

  it("每一對範例的先後都一樣", () => {
    for (const a of samples) for (const b of samples) expect(sign(compareNumericText(a, b))).toBe(sign(a.localeCompare(b, undefined, { numeric: true })));
  });

  it("隨機的 WBS 代號:排出來的順序逐筆相同", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const codes = Array.from({ length: 2000 }, () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => 1 + Math.floor(rand() * 30)).join("."));
    expect([...codes].sort(compareNumericText)).toEqual([...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
  });
});
