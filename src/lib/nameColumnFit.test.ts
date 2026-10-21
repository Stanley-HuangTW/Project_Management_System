import { describe, expect, it } from "vitest";
import { autoFitCap, fitNameColumnWidth } from "./nameColumnFit";

/** 每個字 10px、編號每個字 6px——數字好算。 */
const measure = (text: string, kind: "name" | "code") => text.length * (kind === "name" ? 10 : 6);

const base = { measure, indentPerLevel: 20, chrome: 100, min: 200, max: 700 };

describe("fitNameColumnWidth", () => {
  it("is as wide as the longest name plus the row's fixed parts", () => {
    const items = [
      { id: "a", name: "短", parentId: null },
      { id: "b", name: "這是一個比較長的項目名稱", parentId: null }, // 12 字 = 120
    ];
    expect(fitNameColumnWidth({ ...base, items })).toBe(220); // 120 + 100
  });

  it("counts the indent of a deep item — a short name far down can be the widest row", () => {
    const items = [
      { id: "a", name: "一二三四五六七八", parentId: null }, // 80 + 100 = 180
      { id: "b", name: "子", parentId: "a" },
      { id: "c", name: "孫", parentId: "b" },
      { id: "d", name: "曾孫名字很長很長很長很長", parentId: "c" }, // 3 層 60 + 120 + 100 = 280
    ];
    expect(fitNameColumnWidth({ ...base, items })).toBe(280);
  });

  it("counts the WBS code when there is one", () => {
    const items = [{ id: "a", name: "名稱十個字的名稱字", parentId: null }]; // 90
    const codeOf = () => "2.1.12"; // 6 字 = 36
    expect(fitNameColumnWidth({ ...base, items, codeOf, min: 0 })).toBe(90 + 36 + 100);
  });

  it("never goes below the minimum, even for short names", () => {
    expect(fitNameColumnWidth({ ...base, items: [{ id: "a", name: "短", parentId: null }] })).toBe(200);
  });

  it("never goes above the cap — one huge name must not swallow the table", () => {
    const items = [{ id: "a", name: "長".repeat(200), parentId: null }];
    expect(fitNameColumnWidth({ ...base, items })).toBe(700);
  });

  it("returns the minimum for an empty list", () => {
    expect(fitNameColumnWidth({ ...base, items: [] })).toBe(200);
  });

  it("copes with a parent that is missing or a parent loop", () => {
    const orphan = [{ id: "a", name: "孤兒項目", parentId: "gone" }];
    expect(fitNameColumnWidth({ ...base, items: orphan, min: 0 })).toBe(40 + 100);
    const loop = [
      { id: "a", name: "甲", parentId: "b" },
      { id: "b", name: "乙", parentId: "a" },
    ];
    expect(() => fitNameColumnWidth({ ...base, items: loop })).not.toThrow();
  });
});

describe("autoFitCap", () => {
  it("is half the container", () => {
    expect(autoFitCap(1200, 400)).toBe(600);
  });
  it("keeps a floor on a narrow pane and a ceiling on a wide one", () => {
    expect(autoFitCap(600, 400)).toBe(400);
    expect(autoFitCap(3000, 400)).toBe(720);
  });
});
