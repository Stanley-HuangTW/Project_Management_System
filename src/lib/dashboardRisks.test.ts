import { describe, expect, it } from "vitest";
import { relatedToUsers, summariseOpenRisks, toOpenRiskRows, type OpenRiskInput } from "./dashboardRisks";

const entry = (over: Partial<OpenRiskInput> & { id: string }): OpenRiskInput => ({
  boardId: "b1",
  kind: "RISK",
  status: "OPEN",
  title: over.id,
  probability: 3,
  impact: 3,
  ownerId: null,
  ownerName: null,
  dueDate: null,
  mantisId: null,
  mantisUrl: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  pendingReviewerIds: [],
  ...over,
});
const boards = new Map([["b1", "P100"], ["b2", "M3"]]);

describe("toOpenRiskRows", () => {
  it("已結案的不列;未處理、處理中、待審核都算還沒完成", () => {
    const rows = toOpenRiskRows(
      [entry({ id: "a", status: "CLOSED" }), entry({ id: "b", status: "OPEN" }), entry({ id: "c", status: "MITIGATING" }), entry({ id: "d", status: "PENDING_REVIEW" })],
      boards,
      "2026-10-13"
    );
    expect(rows.map((r) => r.id).sort()).toEqual(["b", "c", "d"]);
  });

  it("最嚴重的在最前面(機率 × 衝擊),同分的先建立的在前", () => {
    const rows = toOpenRiskRows(
      [
        entry({ id: "low", probability: 1, impact: 2 }),
        entry({ id: "late", probability: 5, impact: 4, createdAt: "2026-10-05T00:00:00.000Z" }),
        entry({ id: "early", probability: 5, impact: 4, createdAt: "2026-10-02T00:00:00.000Z" }),
      ],
      boards,
      "2026-10-13"
    );
    expect(rows.map((r) => r.id)).toEqual(["early", "late", "low"]);
    expect(rows[0]).toMatchObject({ score: 20, bandKey: "critical", bandLabel: "極高" });
  });

  it("帶出看板名稱;到期日已經過了就標逾期,今天到期還不算", () => {
    const rows = toOpenRiskRows(
      [entry({ id: "x", boardId: "b2", dueDate: "2026-10-12" }), entry({ id: "y", dueDate: "2026-10-13" }), entry({ id: "z", dueDate: null })],
      boards,
      "2026-10-13"
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.x.boardName).toBe("M3");
    expect(by.x.overdue).toBe(true);
    expect(by.y.overdue).toBe(false);
    expect(by.z.overdue).toBe(false);
  });
});

describe("relatedToUsers", () => {
  const me = new Set(["u1"]);
  it("我是負責人、或正在等我同意結案:跟我有關", () => {
    expect(relatedToUsers({ ownerId: "u1", pendingReviewerIds: [] }, me)).toBe(true);
    expect(relatedToUsers({ ownerId: "u9", pendingReviewerIds: ["u2", "u1"] }, me)).toBe(true);
  });
  it("別人的、沒有負責人的:無關;主管帶著部屬一起算", () => {
    expect(relatedToUsers({ ownerId: "u9", pendingReviewerIds: [] }, me)).toBe(false);
    expect(relatedToUsers({ ownerId: null, pendingReviewerIds: [] }, me)).toBe(false);
    expect(relatedToUsers({ ownerId: "u9", pendingReviewerIds: [] }, new Set(["u1", "u9"]))).toBe(true);
  });
});

describe("summariseOpenRisks", () => {
  it("統計:共幾筆、極高、高、逾期,以及風險與問題各幾筆", () => {
    const rows = toOpenRiskRows(
      [
        entry({ id: "1", probability: 5, impact: 5 }),
        entry({ id: "2", probability: 3, impact: 3, kind: "ISSUE", dueDate: "2026-10-01" }),
        entry({ id: "3", probability: 2, impact: 2, kind: "ISSUE" }),
      ],
      boards,
      "2026-10-13"
    );
    expect(summariseOpenRisks(rows)).toEqual({ total: 3, critical: 1, high: 1, overdue: 1, risks: 1, issues: 2 });
  });
});
