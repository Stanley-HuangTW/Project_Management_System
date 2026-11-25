import { describe, expect, it } from "vitest";
import { ancestorConstraintLines, type ConstraintNode } from "./ancestorConstraint";

const node = (id: string, parentId: string | null, name: string, type: ConstraintNode["constraintType"] = null, date: string | null = null): ConstraintNode => ({
  id, parentId, name, constraintType: type, constraintDate: date,
});

describe("ancestorConstraintLines", () => {
  const nodes = [
    node("top", null, "專案", "FINISH_NO_LATER_THAN", "2026-12-31"),
    node("mid", "top", "階段", "START_NO_EARLIER_THAN", "2026-11-01"),
    node("leaf", "mid", "任務"),
    node("free", null, "沒約束的上層"),
    node("freeLeaf", "free", "任務二"),
  ];
  it("子項目完成日超過上層「不得晚於」→ 提醒(連再上一層也看)", () => {
    const lines = ancestorConstraintLines(nodes, [{ itemId: "leaf", start: "2026-11-10", end: "2027-01-05" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("上層「專案」");
    expect(lines[0]).toContain("不得晚於(完成) 2026-12-31");
    expect(lines[0]).toContain("完成日 2027-01-05");
  });
  it("子項目開始日早於上層「不得早於」→ 提醒", () => {
    const lines = ancestorConstraintLines(nodes, [{ itemId: "leaf", start: "2026-10-20", end: "2026-11-10" }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("上層「階段」");
    expect(lines[0]).toContain("開始日 2026-10-20");
  });
  it("在約束內、或上層沒有約束 → 沒有提醒", () => {
    expect(ancestorConstraintLines(nodes, [{ itemId: "leaf", start: "2026-11-02", end: "2026-12-31" }])).toEqual([]);
    expect(ancestorConstraintLines(nodes, [{ itemId: "freeLeaf", start: "2020-01-01", end: "2030-01-01" }])).toEqual([]);
  });
  it("「必須完成於」也算:完成日晚於那天", () => {
    const n = [node("p", null, "上層", "MUST_FINISH_ON", "2026-12-01"), node("c", "p", "子")];
    expect(ancestorConstraintLines(n, [{ itemId: "c", start: "2026-11-20", end: "2026-12-05" }])[0]).toContain("必須完成於 2026-12-01");
  });
  it("自己的約束不算(只看上層)", () => {
    expect(ancestorConstraintLines(nodes, [{ itemId: "mid", start: "2026-10-01", end: "2026-11-30" }])).toEqual([]);
  });
});
