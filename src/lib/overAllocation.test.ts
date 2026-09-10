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
    expect(overload.days).toEqual([{ date: "2026-01-08", pct: 310 }]);
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
