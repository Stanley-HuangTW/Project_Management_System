import { describe, expect, it } from "vitest";
import { findOverAllocations, movableTasks } from "./overAllocation";
import type { MemberTask } from "./workload";

function task(
  itemId: string,
  allocationPct: number,
  start: string,
  end: string
): MemberTask {
  return {
    boardId: "b1",
    boardName: "板",
    groupId: "g1",
    groupName: "分組",
    itemId,
    itemName: itemId,
    allocationPct,
    startDate: new Date(start),
    endDate: new Date(end),
  };
}

const users = [{ id: "u1", name: "阿明" }];
const monday = new Date("2026-01-05");

describe("findOverAllocations", () => {
  it("says nothing about someone inside the threshold", () => {
    const byUser = new Map([["u1", [task("a", 50, "2026-01-05", "2026-01-09")]]]);
    expect(findOverAllocations(byUser, users, monday, 7, 100)).toEqual([]);
  });

  it("catches a single-day spike an average would hide", () => {
    const byUser = new Map([
      ["u1", [task("a", 60, "2026-01-05", "2026-01-09"), task("b", 250, "2026-01-08", "2026-01-08")]],
    ]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100);
    expect(overload.peakPct).toBe(310);
    expect(overload.days).toEqual([{ date: "2026-01-08", pct: 310, onLeave: false }]);
  });

  it("blames only the tasks running on the overloaded day", () => {
    const byUser = new Map([
      [
        "u1",
        [
          task("early", 100, "2026-01-05", "2026-01-06"),
          task("late-a", 80, "2026-01-08", "2026-01-09"),
          task("late-b", 80, "2026-01-08", "2026-01-09"),
        ],
      ],
    ]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100);
    expect(overload.tasks.map((t) => t.itemId).sort()).toEqual(["late-a", "late-b"]);
  });

  it("lists the heaviest task first", () => {
    const byUser = new Map([
      ["u1", [task("small", 40, "2026-01-05", "2026-01-09"), task("big", 90, "2026-01-05", "2026-01-09")]],
    ]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100);
    expect(overload.tasks.map((t) => t.itemId)).toEqual(["big", "small"]);
  });

  it("puts the worst-loaded person at the top", () => {
    const byUser = new Map([
      ["u1", [task("a", 150, "2026-01-05", "2026-01-09")]],
      ["u2", [task("b", 400, "2026-01-05", "2026-01-09")]],
    ]);
    const found = findOverAllocations(byUser, [...users, { id: "u2", name: "小華" }], monday, 7, 100);
    expect(found.map((o) => o.userId)).toEqual(["u2", "u1"]);
  });

  it("ignores a task with no dates — it is on nobody's day", () => {
    const undated: MemberTask = { ...task("x", 500, "2026-01-05", "2026-01-09"), startDate: null, endDate: null };
    expect(findOverAllocations(new Map([["u1", [undated]]]), users, monday, 7, 100)).toEqual([]);
  });
});

describe("休假", () => {
  it("flags any booking at all on a day someone is away", () => {
    const byUser = new Map([["u1", [task("a", 20, "2026-01-05", "2026-01-09")]]]);
    const leave = new Map([["u1", new Set(["2026-01-07"])]]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100, new Map(), leave);
    expect(overload.days).toEqual([{ date: "2026-01-07", pct: 20, onLeave: true }]);
    expect(overload.leaveDays).toBe(1);
  });

  it("leaves an unbooked leave day alone", () => {
    const byUser = new Map([["u1", [task("a", 50, "2026-01-05", "2026-01-06")]]]);
    const leave = new Map([["u1", new Set(["2026-01-08"])]]);
    expect(findOverAllocations(byUser, users, monday, 7, 100, new Map(), leave)).toEqual([]);
  });

  it("counts an overloaded day that is also a leave day only once", () => {
    const byUser = new Map([["u1", [task("a", 150, "2026-01-05", "2026-01-09")]]]);
    const leave = new Map([["u1", new Set(["2026-01-06"])]]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100, new Map(), leave);
    expect(overload.days.length).toBe(5);
    expect(overload.leaveDays).toBe(1);
  });
});

describe("movableTasks", () => {
  it("offers only what can slip without moving the project", () => {
    const byUser = new Map([
      ["u1", [task("critical", 100, "2026-01-05", "2026-01-09"), task("slack", 80, "2026-01-05", "2026-01-09")]],
    ]);
    const floats = new Map([
      ["critical", 0],
      ["slack", 5],
    ]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100, floats);
    expect(movableTasks(overload).map((t) => t.itemId)).toEqual(["slack"]);
  });

  it("offers nothing when no float is known — a guess is worse than silence", () => {
    const byUser = new Map([["u1", [task("a", 200, "2026-01-05", "2026-01-09")]]]);
    const [overload] = findOverAllocations(byUser, users, monday, 7, 100);
    expect(movableTasks(overload)).toEqual([]);
  });
});

/**
 * The 過度配置 card lets the window and the threshold be changed — a month at
 * a time, an arbitrary range, and any loading percentage. Both are arguments
 * here, so these fix the behaviour those controls depend on.
 */
describe("window and threshold", () => {
  it("scans a whole month, not just the first week", () => {
    const byUser = new Map([["u1", [task("a", 150, "2026-01-28", "2026-01-30")]]]);

    // A week from the 5th misses it entirely; the month does not.
    expect(findOverAllocations(byUser, users, monday, 7, 95)).toEqual([]);
    const [overload] = findOverAllocations(byUser, users, new Date("2026-01-01"), 31, 95);
    expect(overload.days.map((d) => d.date)).toEqual(["2026-01-28", "2026-01-29", "2026-01-30"]);
  });

  it("cuts at the threshold it is given, exclusive", () => {
    const byUser = new Map([["u1", [task("a", 95, "2026-01-05", "2026-01-05")]]]);

    // Exactly 95 is not over 95 — the default threshold leaves it alone.
    expect(findOverAllocations(byUser, users, monday, 7, 95)).toEqual([]);
    // A point lower and the same day is over.
    expect(findOverAllocations(byUser, users, monday, 7, 94)).toHaveLength(1);
  });

  it("uses the lower threshold to catch what 100% would have missed", () => {
    const byUser = new Map([["u1", [task("a", 98, "2026-01-06", "2026-01-06")]]]);

    expect(findOverAllocations(byUser, users, monday, 7, 100)).toEqual([]);
    expect(findOverAllocations(byUser, users, monday, 7, 95)).toHaveLength(1);
  });
});
