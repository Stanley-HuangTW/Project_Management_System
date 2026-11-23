import { describe, expect, it } from "vitest";
import { clampColWidth, colWidthStyle, MAX_COL_WIDTH, MIN_COL_WIDTH, parseColWidths } from "./bomColumnWidths";

describe("clampColWidth", () => {
  it("夾在最小與最大之間、取整數", () => {
    expect(clampColWidth(10)).toBe(MIN_COL_WIDTH);
    expect(clampColWidth(5000)).toBe(MAX_COL_WIDTH);
    expect(clampColWidth(171.6)).toBe(172);
  });
});

describe("parseColWidths", () => {
  it("正常的紀錄讀得回來,範圍外的夾進範圍", () => {
    expect(parseColWidths('{"name":300,"c_x":10}')).toEqual({ name: 300, c_x: MIN_COL_WIDTH });
  });

  it("壞掉的資料(不是 JSON、不是物件、值不是數字)不會丟錯,只留好的", () => {
    expect(parseColWidths("not json")).toEqual({});
    expect(parseColWidths("[1,2]")).toEqual({});
    expect(parseColWidths("null")).toEqual({});
    expect(parseColWidths('{"name":"wide","qty":120,"x":null}')).toEqual({ qty: 120 });
    expect(parseColWidths(null)).toEqual({});
    expect(parseColWidths("")).toEqual({});
  });
});

describe("colWidthStyle", () => {
  it("調整過的欄回寬度與最小寬度,沒調整過的是 undefined(照原本的最小寬度)", () => {
    expect(colWidthStyle({ name: 300 }, "name")).toEqual({ width: 300, minWidth: 300 });
    expect(colWidthStyle({ name: 300 }, "qty")).toBeUndefined();
    expect(colWidthStyle(undefined, "name")).toBeUndefined();
  });
});
