import { describe, expect, it } from "vitest";
import { assessGate, isCleared, findGateBreaches, type GatePhaseItem } from "./gateReview";

const met = (required = true) => ({ required, met: true });
const unmet = (required = true) => ({ required, met: false });
const approved = { decision: "APPROVED" as const };
const rejected = { decision: "REJECTED" as const };
const silent = { decision: null };

describe("assessGate", () => {
  it("passes when every required criterion is met and everyone has approved", () => {
    const result = assessGate([met(), met(), unmet(false)], [approved, approved]);

    expect(result.canPass).toBe(true);
    expect(result.blockers).toEqual([]);
    // An optional criterion left undone does not block, but is still counted.
    expect(result.metOptional).toBe(0);
    expect(result.totalOptional).toBe(1);
  });

  it("refuses while a required criterion is outstanding", () => {
    const result = assessGate([met(), unmet()], [approved]);

    expect(result.canPass).toBe(false);
    expect(result.blockers).toContain("還有 1 項必要條件未達成");
  });

  it("refuses while anyone has not answered", () => {
    const result = assessGate([met()], [approved, silent]);

    expect(result.canPass).toBe(false);
    expect(result.blockers).toContain("還有 1 位簽核人未表態");
  });

  it("refuses on a rejection even when everyone else agreed", () => {
    const result = assessGate([met()], [approved, rejected]);

    expect(result.canPass).toBe(false);
    expect(result.blockers).toContain("有 1 位簽核人不同意");
  });

  it("refuses a gate with no approvers at all", () => {
    // Otherwise a gate nobody signs would pass itself the moment its boxes
    // were ticked, which is a checklist wearing a review's name.
    const result = assessGate([met()], []);

    expect(result.canPass).toBe(false);
    expect(result.blockers).toContain("尚未指定簽核人");
  });
});

describe("isCleared", () => {
  it("treats 有條件放行 as cleared — the decision was taken, with a reason", () => {
    expect(isCleared("WAIVED")).toBe(true);
    expect(isCleared("PASSED")).toBe(true);
    expect(isCleared("PENDING")).toBe(false);
    expect(isCleared("FAILED")).toBe(false);
    expect(isCleared("DRAFT")).toBe(false);
  });
});

/**
 * Two phases in order under one group, each with a child task:
 *   EVT Phase (order 1) → its gate
 *   PVT Phase (order 2) → PVT-1
 */
function phase(id: string, order: number, progressPct: number | null = null): GatePhaseItem {
  return { id, name: id, parentId: null, groupId: "g", order, progressPct, startDate: null };
}
function child(
  id: string,
  parentId: string,
  progressPct: number | null = null,
  startDate: string | null = null
): GatePhaseItem {
  return { id, name: id, parentId, groupId: "g", order: 1, progressPct, startDate };
}

describe("findGateBreaches", () => {
  const today = "2026-06-15";
  const gate = (status: "DRAFT" | "PENDING" | "PASSED" | "WAIVED" | "FAILED") => [
    { id: "gate1", name: "EVT 出口", itemId: "EVT", status },
  ];

  it("reports the next phase being worked before the gate clears", () => {
    const items = [phase("EVT", 1), phase("PVT", 2), child("PVT-1", "PVT", 40)];

    const [breach] = findGateBreaches(gate("PENDING"), items, today);

    expect(breach.nextPhaseName).toBe("PVT");
    expect(breach.startedNames).toEqual(["PVT-1"]);
    expect(breach.startedCount).toBe(1);
  });

  it("says nothing once the gate has been cleared", () => {
    const items = [phase("EVT", 1), phase("PVT", 2), child("PVT-1", "PVT", 40)];

    expect(findGateBreaches(gate("PASSED"), items, today)).toEqual([]);
    expect(findGateBreaches(gate("WAIVED"), items, today)).toEqual([]);
  });

  it("says nothing when the next phase has not been touched", () => {
    const items = [phase("EVT", 1), phase("PVT", 2), child("PVT-1", "PVT", 0)];

    expect(findGateBreaches(gate("PENDING"), items, today)).toEqual([]);
  });

  it("falls back to the planned start where the board scores no progress", () => {
    const started = [phase("EVT", 1), phase("PVT", 2), child("PVT-1", "PVT", null, "2026-06-01")];
    const future = [phase("EVT", 1), phase("PVT", 2), child("PVT-1", "PVT", null, "2026-08-01")];

    expect(findGateBreaches(gate("PENDING"), started, today)).toHaveLength(1);
    expect(findGateBreaches(gate("PENDING"), future, today)).toEqual([]);
  });

  it("looks down the whole subtree, not just the phase's own children", () => {
    const items = [
      phase("EVT", 1),
      phase("PVT", 2),
      child("PVT-1", "PVT"),
      child("PVT-1a", "PVT-1", 10),
    ];

    const [breach] = findGateBreaches(gate("DRAFT"), items, today);

    expect(breach.startedNames).toEqual(["PVT-1a"]);
  });

  it("ignores a gate on the last phase — there is nothing after it", () => {
    const items = [phase("EVT", 1)];

    expect(findGateBreaches(gate("PENDING"), items, today)).toEqual([]);
  });

  it("ignores a gate that is not attached to a phase", () => {
    const items = [phase("EVT", 1), phase("PVT", 2), child("PVT-1", "PVT", 40)];

    const floating = [{ id: "g2", name: "MRD 凍結", itemId: null, status: "PENDING" as const }];
    expect(findGateBreaches(floating, items, today)).toEqual([]);
  });
});
