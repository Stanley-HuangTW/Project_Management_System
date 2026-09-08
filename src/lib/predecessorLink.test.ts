import { describe, expect, it } from "vitest";
import {
  buildWbsIndexFromItems,
  resolveWbsCode,
  resolvePredValue,
  computeScheduledRange,
  resolveLockedScheduleFields,
  resolveScheduleDays,
} from "./predecessorLink";

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

describe("computeScheduledRange", () => {
  const predRange = { start: new Date("2026-07-20"), end: new Date("2026-07-24") };

  it("FS: starts the day after the predecessor finishes", () => {
    const result = computeScheduledRange(predRange, 5, "FS", 0, "CALENDAR", new Set());
    expect(iso(result!.start)).toBe("2026-07-25");
    expect(iso(result!.end)).toBe("2026-07-29");
  });

  it("SS: starts alongside the predecessor's start", () => {
    const result = computeScheduledRange(predRange, 5, "SS", 0, "CALENDAR", new Set());
    expect(iso(result!.start)).toBe("2026-07-20");
    expect(iso(result!.end)).toBe("2026-07-24");
  });

  it("FF: finishes alongside the predecessor's finish, start derived backward", () => {
    const result = computeScheduledRange(predRange, 5, "FF", 0, "CALENDAR", new Set());
    expect(iso(result!.start)).toBe("2026-07-20");
    expect(iso(result!.end)).toBe("2026-07-24");
  });

  it("SF: finishes alongside the predecessor's start, start derived backward", () => {
    const result = computeScheduledRange(predRange, 5, "SF", 0, "CALENDAR", new Set());
    expect(iso(result!.start)).toBe("2026-07-16");
    expect(iso(result!.end)).toBe("2026-07-20");
  });

  it("applies lag as an extra day offset on top of the relationship anchor", () => {
    const result = computeScheduledRange(predRange, 5, "FS", 2, "CALENDAR", new Set());
    expect(iso(result!.start)).toBe("2026-07-27");
  });

  it("returns null when days is missing or negative", () => {
    expect(computeScheduledRange(predRange, -1, "FS", 0, "CALENDAR", new Set())).toBeNull();
  });

  it("BUSINESS mode skips weekends when placing FS", () => {
    // Fri 2026-07-17 predecessor finish -> next business day is Mon 2026-07-20.
    const fridayFinishRange = { start: new Date("2026-07-13"), end: new Date("2026-07-17") };
    const result = computeScheduledRange(fridayFinishRange, 5, "FS", 0, "BUSINESS", new Set());
    expect(iso(result!.start)).toBe("2026-07-20");
    expect(iso(result!.end)).toBe("2026-07-24");
  });

  it("BUSINESS mode skips weekends when applying lag", () => {
    const mondayStartRange = { start: new Date("2026-07-13"), end: new Date("2026-07-17") };
    const result = computeScheduledRange(mondayStartRange, 5, "SS", 3, "BUSINESS", new Set());
    expect(iso(result!.start)).toBe("2026-07-16");
  });
});

describe("buildWbsIndexFromItems", () => {
  it("assigns dotted WBS codes matching parent/order structure", () => {
    const items = [
      { id: "a", parentId: null, order: 0, groupId: "g1" },
      { id: "a1", parentId: "a", order: 0, groupId: "g1" },
      { id: "a2", parentId: "a", order: 1, groupId: "g1" },
      { id: "b", parentId: null, order: 1, groupId: "g1" },
    ];
    const index = buildWbsIndexFromItems(items);
    expect(index.wbsByItemId.get("a")).toBe("1");
    expect(index.wbsByItemId.get("a1")).toBe("1.1");
    expect(index.wbsByItemId.get("a2")).toBe("1.2");
    expect(index.wbsByItemId.get("b")).toBe("2");
    expect(resolveWbsCode(index, "g1", "1.2")).toBe("a2");
  });

  it("numbers each group independently, so the same code never crosses groups", () => {
    // Two groups whose top-level items both start at order 0 — reproduces
    // the board-wide-numbering bug where a Pred value like "1.1" typed by
    // looking at one group's displayed WBS code could silently resolve to
    // the OTHER group's item once numbering was shared across groups.
    const items = [
      { id: "g1-a", parentId: null, order: 0, groupId: "g1" },
      { id: "g1-a1", parentId: "g1-a", order: 0, groupId: "g1" },
      { id: "g2-a", parentId: null, order: 0, groupId: "g2" },
      { id: "g2-a1", parentId: "g2-a", order: 0, groupId: "g2" },
    ];
    const index = buildWbsIndexFromItems(items);
    expect(index.wbsByItemId.get("g1-a")).toBe("1");
    expect(index.wbsByItemId.get("g2-a")).toBe("1");
    expect(resolveWbsCode(index, "g1", "1.1")).toBe("g1-a1");
    expect(resolveWbsCode(index, "g2", "1.1")).toBe("g2-a1");
    // Same code, wrong group — must not resolve to the other group's item.
    expect(resolveWbsCode(index, "g2", "1.1")).not.toBe("g1-a1");
  });
});

describe("resolveLockedScheduleFields", () => {
  it("leaves Start/Finish/Days editable when no Pred/Link resolves and manual columns aren't configured", () => {
    const items = [{ id: "a", parentId: null, order: 0, groupId: "g1", cellValues: [] }];
    const locks = resolveLockedScheduleFields(items, "predCol", "linkCol");
    expect(locks.get("a")).toBeUndefined();
  });

  it("locks Start/Finish/Days for every item once manualStart/manualDuration are both configured, even without Pred", () => {
    const items = [
      { id: "a", parentId: null, order: 0, groupId: "g1", cellValues: [] },
      { id: "b", parentId: null, order: 1, groupId: "g1", cellValues: [] },
    ];
    const locks = resolveLockedScheduleFields(
      items,
      null,
      null,
      undefined,
      undefined,
      undefined,
      "manualStartCol",
      "manualDurationCol"
    );
    expect(locks.get("a")).toEqual({ startLocked: true, endLocked: true, daysLocked: true });
    expect(locks.get("b")).toEqual({ startLocked: true, endLocked: true, daysLocked: true });
  });

  describe("a summary's rollup lock", () => {
    const cell = (columnId: string, value: unknown) => ({ id: `${columnId}-cv`, itemId: "p", columnId, value: value as never });
    const parent = { id: "p", parentId: null, order: 0, groupId: "g1", cellValues: [] as ReturnType<typeof cell>[] };
    const child = { id: "c", parentId: "p", order: 0, groupId: "g1", cellValues: [] };

    it("locks Start/Finish on a summary whose dates really do come from its subtree", () => {
      const locks = resolveLockedScheduleFields([parent, child], "predCol", "linkCol");
      expect(locks.get("p")).toEqual({ startLocked: true, endLocked: true, daysLocked: false });
    });

    it("leaves a summary with its own start(set) draggable — its bar shows its own dates", () => {
      const withStartSet = {
        ...parent,
        cellValues: [cell("manualStartCol", "2026-07-24")],
      };
      const locks = resolveLockedScheduleFields(
        [withStartSet, child],
        "predCol",
        "linkCol",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "manualStartCol"
      );
      expect(locks.get("p")).toBeUndefined();
    });

    it("leaves a summary with its own Pred draggable at the end its Link doesn't pin", () => {
      const withPred = { ...parent, cellValues: [cell("predCol", "1.1")] };
      const locks = resolveLockedScheduleFields([withPred, child], "predCol", "linkCol");
      // No link options given, so the Pred branch pins neither end — what
      // matters is that the rollup no longer locks both.
      expect(locks.get("p")).toBeUndefined();
    });

    it("ignores a blank start(set) — an empty string is not a rule", () => {
      const blank = { ...parent, cellValues: [cell("manualStartCol", "  ")] };
      const locks = resolveLockedScheduleFields(
        [blank, child],
        "predCol",
        "linkCol",
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "manualStartCol"
      );
      expect(locks.get("p")).toEqual({ startLocked: true, endLocked: true, daysLocked: false });
    });
  });
});

describe("resolveScheduleDays", () => {
  it("uses the manual duration column when it has a value", () => {
    const cells = [
      { columnId: "durationCol", value: 5 },
      { columnId: "daysCol", value: 30 },
    ];
    expect(resolveScheduleDays(cells, "durationCol", "daysCol")).toBe(5);
  });

  it("keeps a zero duration rather than falling through to Days", () => {
    const cells = [
      { columnId: "durationCol", value: 0 },
      { columnId: "daysCol", value: 30 },
    ];
    expect(resolveScheduleDays(cells, "durationCol", "daysCol")).toBe(0);
  });

  it("falls back to Days when the manual duration is blank — an item imported with a length but no duration is still schedulable from its Pred", () => {
    const cells = [{ columnId: "daysCol", value: 30 }];
    expect(resolveScheduleDays(cells, "durationCol", "daysCol")).toBe(30);
  });

  it("is null when neither is set — nothing to compute a Finish from", () => {
    expect(resolveScheduleDays([], "durationCol", "daysCol")).toBeNull();
  });

  it("ignores non-numeric values in either column", () => {
    const cells = [
      { columnId: "durationCol", value: "" },
      { columnId: "daysCol", value: "abc" },
    ];
    expect(resolveScheduleDays(cells, "durationCol", "daysCol")).toBeNull();
  });
});

describe("resolvePredValue", () => {
  // 任務a at 1.1, then 任務b is inserted above it: 任務a becomes 1.2, and a
  // Pred of "1.1" — which meant 任務a — now points at 任務b. Storing the id
  // is what makes the reference survive the insert.
  const before = [
    { id: "root", parentId: null, order: 0, groupId: "g1" },
    { id: "task-a", parentId: "root", order: 0, groupId: "g1" },
    { id: "downstream", parentId: "root", order: 5, groupId: "g1" },
  ];
  const after = [
    ...before,
    { id: "task-b", parentId: "root", order: -1, groupId: "g1" },
  ];

  it("follows an item id through an insert that renumbers everything", () => {
    expect(resolvePredValue(buildWbsIndexFromItems(before), "g1", "task-a")).toBe("task-a");
    expect(resolvePredValue(buildWbsIndexFromItems(after), "g1", "task-a")).toBe("task-a");
  });

  it("shows why a WBS code cannot be trusted: the same code changes target", () => {
    expect(resolvePredValue(buildWbsIndexFromItems(before), "g1", "1.1")).toBe("task-a");
    expect(resolvePredValue(buildWbsIndexFromItems(after), "g1", "1.1")).toBe("task-b");
  });

  it("still resolves a legacy WBS code, so imported and pre-existing values keep working", () => {
    const index = buildWbsIndexFromItems(before);
    expect(resolvePredValue(index, "g1", "1.2")).toBe("downstream");
  });

  it("refuses an item id from another group, same as a code from another group", () => {
    const items = [
      { id: "g1-a", parentId: null, order: 0, groupId: "g1" },
      { id: "g2-a", parentId: null, order: 0, groupId: "g2" },
    ];
    const index = buildWbsIndexFromItems(items);
    expect(resolvePredValue(index, "g1", "g2-a")).toBeUndefined();
    expect(resolvePredValue(index, "g1", "g1-a")).toBe("g1-a");
  });

  it("is undefined for a dangling reference — a deleted item's id resolves to nothing", () => {
    const index = buildWbsIndexFromItems(before);
    expect(resolvePredValue(index, "g1", "deleted-item")).toBeUndefined();
  });
});
