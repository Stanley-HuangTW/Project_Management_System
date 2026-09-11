import { describe, expect, it } from "vitest";
import { computeCriticalPath, computeCriticalPathAcross } from "./criticalPath";
import type { ItemData } from "@/types/board";

const PRED = "predCol";
const LINK = "linkCol";
const LAG = "lagCol";
const START = "startCol";
const DAYS = "daysCol";
const FS = "fs-option";

const columns = {
  predColumnId: PRED,
  linkColumnId: LINK,
  linkColumnOptions: { statuses: [{ id: FS, label: "FS", color: "#000" }] },
  lagColumnId: LAG,
  startColumnId: START,
  durationColumnId: DAYS,
  durationMode: "CALENDAR" as const,
};

/** A leaf task: id, start, days, and the ids it waits on. */
function task(id: string, start: string, days: number, preds: string[] = [], order = 0): ItemData {
  const cells = [
    { id: `${id}-s`, itemId: id, columnId: START, value: start },
    { id: `${id}-d`, itemId: id, columnId: DAYS, value: days },
  ];
  if (preds.length > 0) {
    cells.push({ id: `${id}-p`, itemId: id, columnId: PRED, value: preds.join(",") });
    cells.push({ id: `${id}-l`, itemId: id, columnId: LINK, value: FS });
  }
  return {
    id,
    name: id,
    parentId: null,
    order,
    groupId: "g1",
    boardId: "b1",
    createdAt: new Date(),
    createdById: null,
    typeBeforeSummary: null,
    baselineStart: null,
    baselineEnd: null,
    baselineDays: null,
    cellValues: cells,
    _count: { comments: 0 },
    assignments: [],
  } as unknown as ItemData;
}

const noHolidays = new Set<string>();

describe("computeCriticalPath", () => {
  it("puts the long branch on the critical path and gives the short one slack", () => {
    // A(5d) feeds both B(10d) and C(2d); D waits on both.
    //   A: 01-01..01-05
    //   B: 01-06..01-15   ← the long branch
    //   C: 01-06..01-07   ← finishes 8 days earlier, so it can slip 8 days
    //   D: 01-16..01-17
    const items = [
      task("A", "2026-01-01", 5),
      task("B", "2026-01-06", 10, ["A"], 1),
      task("C", "2026-01-06", 2, ["A"], 2),
      task("D", "2026-01-16", 2, ["B", "C"], 3),
    ];
    const floats = computeCriticalPath(items, columns, noHolidays);

    expect(floats.get("A")?.totalFloat).toBe(0);
    expect(floats.get("B")?.totalFloat).toBe(0);
    expect(floats.get("D")?.totalFloat).toBe(0);
    expect(floats.get("C")?.totalFloat).toBe(8);

    expect(floats.get("A")?.isCritical).toBe(true);
    expect(floats.get("B")?.isCritical).toBe(true);
    expect(floats.get("C")?.isCritical).toBe(false);
    expect(floats.get("D")?.isCritical).toBe(true);
  });

  it("reports the late dates the slack is measured against", () => {
    const items = [
      task("A", "2026-01-01", 5),
      task("B", "2026-01-06", 10, ["A"], 1),
      task("C", "2026-01-06", 2, ["A"], 2),
      task("D", "2026-01-16", 2, ["B", "C"], 3),
    ];
    const floats = computeCriticalPath(items, columns, noHolidays);
    // C could finish as late as the 15th and still not delay D.
    expect(floats.get("C")?.lateFinish.toISOString().slice(0, 10)).toBe("2026-01-15");
    expect(floats.get("C")?.lateStart.toISOString().slice(0, 10)).toBe("2026-01-14");
  });

  it("gives a single unbroken chain zero float throughout", () => {
    const items = [
      task("A", "2026-01-01", 3),
      task("B", "2026-01-04", 3, ["A"], 1),
      task("C", "2026-01-07", 3, ["B"], 2),
    ];
    const floats = computeCriticalPath(items, columns, noHolidays);
    expect([...floats.values()].every((f) => f.isCritical)).toBe(true);
  });

  it("reports negative float on the task that is overrunning, not the one after it", () => {
    // B is scheduled from 01-04 but A does not finish until 01-05, so the
    // chain is already inconsistent. The task at fault is A: to leave B alone
    // it would have had to finish by 01-03, two days earlier than it does.
    const items = [
      task("A", "2026-01-01", 5),
      task("B", "2026-01-04", 2, ["A"], 1),
      task("C", "2026-01-06", 2, ["B"], 2),
    ];
    const floats = computeCriticalPath(items, columns, noHolidays);
    expect(floats.get("A")!.totalFloat).toBe(-2);
    expect(floats.get("A")!.isCritical).toBe(true);
    // B itself is exactly on time for what follows it.
    expect(floats.get("B")!.totalFloat).toBe(0);
  });

  it("leaves summaries out — their dates are their children's, counted already", () => {
    const parent = task("P", "2026-01-01", 10);
    const child = task("A", "2026-01-01", 5);
    (child as unknown as { parentId: string }).parentId = "P";
    const floats = computeCriticalPath([parent, child], columns, noHolidays);
    expect(floats.has("P")).toBe(false);
    expect(floats.has("A")).toBe(true);
  });

  it("returns nothing when the board has no Pred column configured", () => {
    const floats = computeCriticalPath([task("A", "2026-01-01", 5)], { ...columns, predColumnId: null }, noHolidays);
    expect(floats.size).toBe(0);
  });

  it("does not hang on a circular Pred chain", () => {
    const a = task("A", "2026-01-01", 2, ["B"]);
    const b = task("B", "2026-01-03", 2, ["A"], 1);
    expect(() => computeCriticalPath([a, b], columns, noHolidays)).not.toThrow();
  });
});

/**
 * 跨看板要徑 — the float a task has against the whole 專案群組.
 *
 * Each board names its own columns, so the same task read through another
 * board's column ids has no dates at all. These build two boards with
 * deliberately different ids and check both halves of the claim: that the
 * network joins up across them, and that a task's slack is measured against
 * the group's finish rather than its own board's.
 */
function boardColumns(board: string) {
  return {
    predColumnId: `${board}-pred`,
    linkColumnId: `${board}-link`,
    linkColumnOptions: { statuses: [{ id: FS, label: "FS", color: "#000" }] },
    lagColumnId: `${board}-lag`,
    startColumnId: `${board}-start`,
    durationColumnId: `${board}-days`,
    durationMode: "CALENDAR" as const,
  };
}

function boardTask(
  board: string,
  id: string,
  start: string,
  days: number,
  preds: string[] = []
): ItemData {
  const cells = [
    { id: `${id}-s`, itemId: id, columnId: `${board}-start`, value: start },
    { id: `${id}-d`, itemId: id, columnId: `${board}-days`, value: days },
  ];
  if (preds.length > 0) {
    cells.push({ id: `${id}-p`, itemId: id, columnId: `${board}-pred`, value: preds.join(",") });
    cells.push({ id: `${id}-l`, itemId: id, columnId: `${board}-link`, value: FS });
  }
  return {
    id,
    name: id,
    parentId: null,
    order: 0,
    groupId: `${board}-group`,
    boardId: board,
    createdAt: new Date(),
    createdById: null,
    typeBeforeSummary: null,
    baselineStart: null,
    baselineEnd: null,
    baselineDays: null,
    cellValues: cells,
    _count: { comments: 0 },
    assignments: [],
  } as unknown as ItemData;
}

describe("computeCriticalPathAcross", () => {
  const columnsOf = (item: ItemData) => boardColumns(item.boardId);

  it("follows a dependency onto another board", () => {
    // A1 (board A) 01-01..01-05 → B1 (board B) 01-06..01-08, nothing else.
    const items = [
      boardTask("A", "A1", "2026-01-01", 5),
      boardTask("B", "B1", "2026-01-06", 3, ["A1"]),
    ];

    const floats = computeCriticalPathAcross(items, columnsOf, noHolidays);

    // One unbroken chain to the group's finish: neither end has slack.
    expect(floats.get("A1")!.totalFloat).toBe(0);
    expect(floats.get("A1")!.isCritical).toBe(true);
    expect(floats.get("B1")!.isCritical).toBe(true);
  });

  it("measures float against the group's finish, not the board's", () => {
    // Board A holds two tasks that both end on 01-05. On its own, each would
    // be critical — A finishes when they do. But only A2 is waited on by
    // board B, so A1 really does have slack and A2 has none.
    const items = [
      boardTask("A", "A1", "2026-01-01", 5),
      boardTask("A", "A2", "2026-01-01", 5),
      boardTask("B", "B1", "2026-01-06", 10, ["A2"]),
    ];

    const floats = computeCriticalPathAcross(items, columnsOf, noHolidays);

    expect(floats.get("A2")!.totalFloat).toBe(0);
    // A1 may run until the group ends on 01-15 — ten days of slack it would
    // not have been credited with by looking at board A alone.
    expect(floats.get("A1")!.totalFloat).toBe(10);
    expect(floats.get("A1")!.isCritical).toBe(false);
  });

  it("reads every task through its own board's columns", () => {
    // B1 carries A's column ids by mistake. Read through B's configuration it
    // has no dates, so it is simply not in the network — rather than being
    // silently placed using another board's columns.
    const stray = boardTask("A", "B1", "2026-01-06", 3, ["A1"]);
    const items = [
      boardTask("A", "A1", "2026-01-01", 5),
      { ...stray, boardId: "B" } as ItemData,
    ];

    const floats = computeCriticalPathAcross(items, columnsOf, noHolidays);

    expect(floats.has("B1")).toBe(false);
    expect(floats.get("A1")!.isCritical).toBe(true);
  });

  it("leaves out boards that are not set up for scheduling", () => {
    const items = [
      boardTask("A", "A1", "2026-01-01", 5),
      boardTask("B", "B1", "2026-01-06", 3, ["A1"]),
    ];

    const floats = computeCriticalPathAcross(
      items,
      (item) => (item.boardId === "B" ? null : boardColumns(item.boardId)),
      noHolidays
    );

    expect(floats.has("B1")).toBe(false);
    expect(floats.has("A1")).toBe(true);
  });
});
