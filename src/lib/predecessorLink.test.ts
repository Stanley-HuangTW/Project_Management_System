import { describe, expect, it } from "vitest";
import {
  buildWbsIndexFromItems,
  resolveWbsCode,
  resolvePredValue,
  resolvePredValues,
  formatPredValue,
  parsePredEntries,
  formatPredEntries,
  pickLatest,
  computeScheduledRange,
  resolveLockedScheduleFields,
  resolveScheduleDays,
  isMilestoneItem,
  scheduleDaysOf,
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

    it("still follows its children when it carries a start(set) — every item on an always-computed board has one", () => {
      const withStartSet = {
        ...parent,
        cellValues: [cell("manualStartCol", "2026-07-24")],
      };
      const locks = resolveLockedScheduleFields([withStartSet, child], "predCol", "linkCol");
      expect(locks.get("p")).toEqual({ startLocked: true, endLocked: true, daysLocked: false });
    });

    it("leaves a summary with its own Pred draggable at the end its Link doesn't pin", () => {
      const withPred = { ...parent, cellValues: [cell("predCol", "1.1")] };
      const locks = resolveLockedScheduleFields([withPred, child], "predCol", "linkCol");
      // No link options given, so the Pred branch pins neither end — what
      // matters is that the rollup no longer locks both.
      expect(locks.get("p")).toBeUndefined();
    });

    it("ignores a blank Pred — an empty string is not a rule", () => {
      const blank = { ...parent, cellValues: [cell("predCol", "  ")] };
      const locks = resolveLockedScheduleFields([blank, child], "predCol", "linkCol");
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

  it("accepts an item id from another group — EVT really does wait on POC", () => {
    const items = [
      { id: "g1-a", parentId: null, order: 0, groupId: "g1" },
      { id: "g2-a", parentId: null, order: 0, groupId: "g2" },
    ];
    const index = buildWbsIndexFromItems(items);
    expect(resolvePredValue(index, "g1", "g2-a")).toBe("g2-a");
    expect(resolvePredValue(index, "g1", "g1-a")).toBe("g1-a");
  });

  it("still reads a WBS code against the referencing item's own group", () => {
    // Both groups have a "1"; the code can only mean the reader's own.
    const items = [
      { id: "g1-a", parentId: null, order: 0, groupId: "g1" },
      { id: "g2-a", parentId: null, order: 0, groupId: "g2" },
    ];
    const index = buildWbsIndexFromItems(items);
    expect(resolvePredValue(index, "g1", "1")).toBe("g1-a");
    expect(resolvePredValue(index, "g2", "1")).toBe("g2-a");
  });

  it("is undefined for a dangling reference — a deleted item's id resolves to nothing", () => {
    const index = buildWbsIndexFromItems(before);
    expect(resolvePredValue(index, "g1", "deleted-item")).toBeUndefined();
  });
});

describe("resolvePredValues", () => {
  const items = [
    { id: "sw", parentId: null, order: 0, groupId: "g1" },
    { id: "me", parentId: null, order: 1, groupId: "g1" },
    { id: "integration", parentId: null, order: 2, groupId: "g1" },
    { id: "other-group", parentId: null, order: 0, groupId: "g2" },
  ];
  const index = buildWbsIndexFromItems(items);

  it("reads a comma-separated list — a task can wait on several things", () => {
    expect(resolvePredValues(index, "g1", "sw,me")).toEqual(["sw", "me"]);
  });

  it("still reads a single value, which is every board written before this", () => {
    expect(resolvePredValues(index, "g1", "sw")).toEqual(["sw"]);
  });

  it("mixes ids and legacy WBS codes in one list", () => {
    // "2" is me's code; a sheet import can leave codes beside pinned ids.
    expect(resolvePredValues(index, "g1", "sw,2")).toEqual(["sw", "me"]);
  });

  it("drops entries that resolve to nothing, and tolerates stray spacing", () => {
    expect(resolvePredValues(index, "g1", " sw , deleted-item ,, me ")).toEqual(["sw", "me"]);
  });

  it("collapses duplicates, including an id repeated as its own code", () => {
    expect(resolvePredValues(index, "g1", "me,2,me")).toEqual(["me"]);
  });

  it("takes an id from another group, which is what a cross-group dependency is", () => {
    expect(resolvePredValues(index, "g1", "sw,other-group")).toEqual(["sw", "other-group"]);
  });

  it("is empty for a blank cell", () => {
    expect(resolvePredValues(index, "g1", "")).toEqual([]);
    expect(resolvePredValues(index, "g1", null)).toEqual([]);
  });
});

describe("parsePredEntries", () => {
  const items = [
    { id: "sw", parentId: null, order: 0, groupId: "g1" },
    { id: "me", parentId: null, order: 1, groupId: "g1" },
    // A cuid that happens to end in "ss": the reason the relationship needs
    // a separator instead of being glued to the reference.
    { id: "cmtabcss", parentId: null, order: 2, groupId: "g1" },
  ];
  const index = buildWbsIndexFromItems(items);

  it("reads a bare id as 'use the item's own Link and Lag'", () => {
    expect(parsePredEntries(index, "g1", "sw")).toEqual([
      { itemId: "sw", relationship: null, lag: null },
    ]);
  });

  it("reads a relationship and a lag off one edge", () => {
    expect(parsePredEntries(index, "g1", "sw:SS-2")).toEqual([
      { itemId: "sw", relationship: "SS", lag: -2 },
    ]);
  });

  it("lets one task wait on two things in different ways", () => {
    expect(parsePredEntries(index, "g1", "sw:FS+3,me:SS")).toEqual([
      { itemId: "sw", relationship: "FS", lag: 3 },
      { itemId: "me", relationship: "SS", lag: null },
    ]);
  });

  it("takes a lag without a relationship", () => {
    expect(parsePredEntries(index, "g1", "me+5")).toEqual([
      { itemId: "me", relationship: null, lag: 5 },
    ]);
  });

  it("does not read the end of an id as a relationship", () => {
    expect(parsePredEntries(index, "g1", "cmtabcss")).toEqual([
      { itemId: "cmtabcss", relationship: null, lag: null },
    ]);
  });

  it("accepts a lower-case relationship, storing the canonical one", () => {
    expect(parsePredEntries(index, "g1", "sw:ff")[0].relationship).toBe("FF");
  });

  it("keeps the first of a repeated predecessor, with its relationship", () => {
    expect(parsePredEntries(index, "g1", "sw:FF,sw:SS")).toEqual([
      { itemId: "sw", relationship: "FF", lag: null },
    ]);
  });
});

describe("formatPredEntries", () => {
  it("writes a bare id when the edge adds nothing", () => {
    expect(formatPredEntries([{ itemId: "a", relationship: null, lag: null }])).toBe("a");
  });

  it("writes the relationship and lag it was given", () => {
    expect(
      formatPredEntries([
        { itemId: "a", relationship: "SS", lag: -2 },
        { itemId: "b", relationship: "FS", lag: 3 },
        { itemId: "c", relationship: null, lag: 1 },
      ])
    ).toBe("a:SS-2,b:FS+3,c+1");
  });

  it("round-trips through parsePredEntries", () => {
    const index = buildWbsIndexFromItems([
      { id: "a", parentId: null, order: 0, groupId: "g1" },
      { id: "b", parentId: null, order: 1, groupId: "g1" },
    ]);
    const entries = [
      { itemId: "a", relationship: "FF" as const, lag: 4 },
      { itemId: "b", relationship: null, lag: null },
    ];
    expect(parsePredEntries(index, "g1", formatPredEntries(entries))).toEqual(entries);
  });

  it("clears the cell rather than storing an empty string", () => {
    expect(formatPredEntries([])).toBeNull();
  });
});

describe("formatPredValue", () => {
  it("joins ids the way the cell stores them", () => {
    expect(formatPredValue(["a", "b"])).toBe("a,b");
  });

  it("clears the cell rather than storing an empty string", () => {
    expect(formatPredValue([])).toBeNull();
  });

  it("collapses duplicates", () => {
    expect(formatPredValue(["a", "a", "b"])).toBe("a,b");
  });
});

describe("pickLatest", () => {
  const r = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

  it("takes the predecessor that pushes this item latest — you wait for the last one", () => {
    // Software porting frees this task on the 10th, the mechanical sample not
    // until the 20th. The 20th is the one that actually governs.
    const chosen = pickLatest([r("2026-08-10", "2026-08-14"), r("2026-08-20", "2026-08-24")]);
    expect(chosen?.start.toISOString().slice(0, 10)).toBe("2026-08-20");
  });

  it("ignores predecessors with no dates of their own — they constrain nothing", () => {
    const chosen = pickLatest([null, r("2026-08-10", "2026-08-14"), null]);
    expect(chosen?.start.toISOString().slice(0, 10)).toBe("2026-08-10");
  });

  it("is null when nothing constrains the item, so it falls back to its own start(set)", () => {
    expect(pickLatest([])).toBeNull();
    expect(pickLatest([null, null])).toBeNull();
  });

  it("keeps a single predecessor exactly as it was — the pre-existing behaviour", () => {
    const only = r("2026-08-10", "2026-08-14");
    expect(pickLatest([only])).toBe(only);
  });
});

describe("里程碑的天數(Days 欄鎖在 0、新建的是空的)", () => {
  const typeOptions = [
    { id: "task", label: "Task", color: "#000" },
    { id: "ms", label: "Milestone", color: "#e2445c" },
  ];
  const cells = (type: string | null) => (type ? [{ columnId: "type", value: type }] : []);

  it("isMilestoneItem:Type 選的是標籤叫 Milestone 的選項", () => {
    expect(isMilestoneItem(cells("ms"), "type", typeOptions)).toBe(true);
    expect(isMilestoneItem(cells("task"), "type", typeOptions)).toBe(false);
    expect(isMilestoneItem(cells(null), "type", typeOptions)).toBe(false);
    expect(isMilestoneItem(cells("ms"), null, typeOptions)).toBe(false); // 看板沒有設定 Type 欄
  });

  it("scheduleDaysOf:有數字就用;里程碑沒填算 0;別的項目沒填就算不出來", () => {
    expect(scheduleDaysOf(5, false)).toBe(5);
    expect(scheduleDaysOf(5, true)).toBe(5);
    expect(scheduleDaysOf(null, true)).toBe(0);
    expect(scheduleDaysOf(null, false)).toBeNull();
    expect(scheduleDaysOf(0, false)).toBe(0);
  });

  it("里程碑 FF 接在前置後面:完成日 = 前置完成日 + lag,開始日 = 完成日(0 天)", () => {
    const predRange = { start: new Date("2026-07-20"), end: new Date("2026-07-24") };
    const days = scheduleDaysOf(null, true)!;
    const result = computeScheduledRange(predRange, days, "FF", 0, "CALENDAR", new Set());
    expect(iso(result!.start)).toBe("2026-07-24");
    expect(iso(result!.end)).toBe("2026-07-24");
    const withLag = computeScheduledRange(predRange, days, "FF", 2, "CALENDAR", new Set());
    expect(iso(withLag!.end)).toBe("2026-07-26");
  });
});
