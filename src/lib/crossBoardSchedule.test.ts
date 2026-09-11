import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 跨看板排程(專案群組).
 *
 * A Pred normally only reaches items on its own board. Once two boards are in
 * one Program they share a schedule network, and the thing that makes that
 * hard is that each board has its OWN columns: B 看板's "Start" is a different
 * column id from A 看板's, so every item has to be read and written through
 * its own board's configuration.
 *
 * These tests run the real engine against an in-memory stand-in for the
 * database — the cascade's behaviour is in the walk, not in Postgres — and
 * assert on what it would have written.
 */

type Cell = { itemId: string; columnId: string; value: unknown };

type FakeBoard = {
  id: string;
  programId: string | null;
  predColumnId: string | null;
  linkColumnId: string | null;
  lagColumnId: string | null;
  ganttStartColumnId: string | null;
  ganttDurationColumnId: string | null;
  ganttEndColumnId: string | null;
  ganttDurationMode: "CALENDAR" | "BUSINESS";
  manualStartColumnId: string | null;
  manualDurationColumnId: string | null;
};

type FakeItem = {
  id: string;
  name: string;
  boardId: string;
  groupId: string;
  parentId: string | null;
  order: number;
  constraintType: string | null;
  constraintDate: Date | null;
  cellValues: Cell[];
};

const db = {
  boards: [] as FakeBoard[],
  items: [] as FakeItem[],
  /** Every option list is the same four relationships; the engine matches on
   *  the option's label, so the ids are arbitrary. */
  linkOptions: {
    statuses: [
      { id: "fs", label: "FS", color: "#1" },
      { id: "ss", label: "SS", color: "#2" },
      { id: "ff", label: "FF", color: "#3" },
      { id: "sf", label: "SF", color: "#4" },
    ],
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    board: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.boards.find((b) => b.id === where.id) ?? null,
      findMany: async ({ where }: { where: { programId: string; id?: { not: string } } }) =>
        db.boards.filter(
          (b) => b.programId === where.programId && b.id !== where.id?.not
        ),
      findFirst: async () => null,
    },
    column: {
      findUnique: async () => ({ options: db.linkOptions }),
    },
    item: {
      findMany: async ({ where }: { where: { boardId: { in: string[] } | string } }) => {
        const ids = typeof where.boardId === "string" ? [where.boardId] : where.boardId.in;
        return db.items.filter((i) => ids.includes(i.boardId));
      },
    },
    cellValue: {
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { itemId_columnId: { itemId: string; columnId: string } };
        update: { value: unknown };
        create: Cell;
      }) => {
        const item = db.items.find((i) => i.id === where.itemId_columnId.itemId)!;
        const cell = item.cellValues.find((c) => c.columnId === where.itemId_columnId.columnId);
        if (cell) cell.value = update.value;
        else item.cellValues.push({ ...create });
      },
    },
    holiday: { findMany: async () => [] },
  },
}));

const { recomputeAllSchedules, syncPredecessorSchedule } = await import("@/lib/predecessorLink");

/** Column ids are deliberately board-specific — the bug this guards against
 *  is reading B's cells through A's column ids. */
const cols = (board: string) => ({
  start: `${board}-start`,
  days: `${board}-days`,
  finish: `${board}-finish`,
  pred: `${board}-pred`,
  link: `${board}-link`,
  lag: `${board}-lag`,
});

function addBoard(id: string, programId: string | null): FakeBoard {
  const c = cols(id);
  const board: FakeBoard = {
    id,
    programId,
    predColumnId: c.pred,
    linkColumnId: c.link,
    lagColumnId: c.lag,
    ganttStartColumnId: c.start,
    ganttDurationColumnId: c.days,
    ganttEndColumnId: c.finish,
    ganttDurationMode: "CALENDAR",
    manualStartColumnId: null,
    manualDurationColumnId: null,
  };
  db.boards.push(board);
  return board;
}

function addItem(
  boardId: string,
  id: string,
  cells: Partial<Record<"start" | "days" | "finish" | "pred" | "link" | "lag", unknown>>
) {
  const c = cols(boardId);
  db.items.push({
    id,
    name: id,
    boardId,
    groupId: `${boardId}-group`,
    parentId: null,
    order: db.items.length + 1,
    constraintType: null,
    constraintDate: null,
    cellValues: Object.entries(cells).map(([key, value]) => ({
      itemId: id,
      columnId: c[key as keyof typeof c],
      value,
    })),
  });
}

function cell(itemId: string, key: "start" | "days" | "finish") {
  const item = db.items.find((i) => i.id === itemId)!;
  const columnId = cols(item.boardId)[key];
  const value = item.cellValues.find((c) => c.columnId === columnId)?.value;
  return value === undefined ? null : value;
}

/**
 * A 看板: A1 starts 2026-10-01 for 5 days (so it finishes on the 5th).
 * B 看板: B1 waits on A1 across the boundary, B2 waits on B1 within B.
 */
function setup(programId: string | null) {
  db.boards = [];
  db.items = [];
  addBoard("A", programId);
  addBoard("B", programId);
  addItem("A", "A1", { start: "2026-10-01", days: 5 });
  addItem("B", "B1", { days: 3, pred: "A1", link: "fs" });
  addItem("B", "B2", { days: 2, pred: "B1", link: "fs" });
}

beforeEach(() => setup("P1"));

describe("cross-board scheduling", () => {
  it("resolves a Pred that points at an item on another board in the same program", async () => {
    const result = await recomputeAllSchedules("A");

    expect(cell("B1", "start")).toBe("2026-10-06");
    expect(cell("B1", "finish")).toBe("2026-10-08");
    expect(result.boardIds).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("keeps cascading once it has crossed over", async () => {
    await recomputeAllSchedules("A");

    expect(cell("B2", "start")).toBe("2026-10-09");
    expect(cell("B2", "finish")).toBe("2026-10-10");
  });

  it("writes each item through its own board's columns", async () => {
    await recomputeAllSchedules("A");

    // Nothing on B may be written under A's column ids — that is the failure
    // mode a single shared config would produce, and it is invisible in the
    // values themselves.
    const b1 = db.items.find((i) => i.id === "B1")!;
    expect(b1.cellValues.map((c) => c.columnId)).not.toContain("A-start");
    expect(b1.cellValues.some((c) => c.columnId === "B-start")).toBe(true);
  });

  it("moves the other board when the upstream item is edited", async () => {
    await recomputeAllSchedules("A");
    expect(cell("B1", "start")).toBe("2026-10-06");

    // A1 grows from 5 days to 10.
    const a1 = db.items.find((i) => i.id === "A1")!;
    a1.cellValues.find((c) => c.columnId === "A-days")!.value = 10;
    const boardIds = await syncPredecessorSchedule("A", "A1", "A-days");

    // A1 is a chain root, so the engine leaves its own cells alone — what
    // moves is everything downstream of it, on the other board.
    expect(cell("B1", "start")).toBe("2026-10-11");
    expect(cell("B2", "start")).toBe("2026-10-14");
    // The caller refreshes B as well, or nobody looking at it sees this.
    expect(boardIds).toEqual(expect.arrayContaining(["A", "B"]));
  });

  it("leaves the boards independent when they are in no program", async () => {
    setup(null);

    await recomputeAllSchedules("A");

    // B1's Pred points off its own board, so it resolves to nothing and B1
    // keeps whatever it had — unsupported, but it fails safe rather than
    // writing something wrong.
    expect(cell("B1", "start")).toBeNull();
    expect(cell("B2", "start")).toBeNull();
  });

  it("stops at the program boundary", async () => {
    setup("P1");
    // C belongs to a different program and depends on A1 — it must not move.
    addBoard("C", "P2");
    addItem("C", "C1", { days: 4, pred: "A1", link: "fs" });

    await recomputeAllSchedules("A");

    expect(cell("B1", "start")).toBe("2026-10-06");
    expect(cell("C1", "start")).toBeNull();
  });
});
