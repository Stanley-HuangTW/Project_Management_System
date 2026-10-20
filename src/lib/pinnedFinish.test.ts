import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 「必須完成於」+ 天數:沒有前置依賴、沒有手動開始日也要算得出 Start / Finish / Days。
 *
 * 約束原本只會改寫「別的東西算出來的」區間——只設了完成日和天數的項目沒有區間可改,
 * 所以 Start / Finish / Days 一直是空的,甘特圖也畫不出條。
 *
 * 跑真的排程引擎,資料庫換成記憶體版(行為在遍歷裡,不在 Postgres 裡),斷言它會寫什麼。
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
  typeColumnId: string | null;
};

type FakeItem = {
  id: string;
  name: string;
  boardId: string;
  groupId: string;
  parentId: string | null;
  order: number;
  constraintType: string | null;
  constraintDate: string | null;
  cellValues: Cell[];
};

const db = {
  boards: [] as FakeBoard[],
  items: [] as FakeItem[],
  linkOptions: { statuses: [{ id: "fs", label: "FS", color: "#1" }] },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    board: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        db.boards.find((b) => b.id === where.id) ?? null,
      findMany: async () => [],
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

const { recomputeAllSchedules, syncPredecessorSchedule, findConstraintConflicts, describeConstraintConflicts } =
  await import("@/lib/predecessorLink");

const COLS = {
  start: "start",
  days: "days",
  finish: "finish",
  pred: "pred",
  link: "link",
  lag: "lag",
  mstart: "mstart",
  mdur: "mdur",
};

function setupBoard(options: { alwaysComputed?: boolean; mode?: "CALENDAR" | "BUSINESS" } = {}) {
  db.boards = [
    {
      id: "B",
      programId: null,
      predColumnId: COLS.pred,
      linkColumnId: COLS.link,
      lagColumnId: COLS.lag,
      ganttStartColumnId: COLS.start,
      ganttDurationColumnId: COLS.days,
      ganttEndColumnId: COLS.finish,
      ganttDurationMode: options.mode ?? "CALENDAR",
      manualStartColumnId: options.alwaysComputed ? COLS.mstart : null,
      manualDurationColumnId: options.alwaysComputed ? COLS.mdur : null,
      typeColumnId: null,
    },
  ];
  db.items = [];
}

function addItem(
  id: string,
  cells: Partial<Record<keyof typeof COLS, unknown>>,
  extra: Partial<Pick<FakeItem, "constraintType" | "constraintDate" | "parentId">> = {}
) {
  db.items.push({
    id,
    name: id,
    boardId: "B",
    groupId: "G",
    parentId: extra.parentId ?? null,
    order: db.items.length + 1,
    constraintType: extra.constraintType ?? null,
    constraintDate: extra.constraintDate ?? null,
    cellValues: Object.entries(cells).map(([key, value]) => ({
      itemId: id,
      columnId: COLS[key as keyof typeof COLS],
      value,
    })),
  });
}

function cell(itemId: string, key: keyof typeof COLS) {
  const item = db.items.find((i) => i.id === itemId)!;
  const value = item.cellValues.find((c) => c.columnId === COLS[key])?.value;
  return value === undefined ? null : value;
}

const MUST_FINISH = { constraintType: "MUST_FINISH_ON", constraintDate: "2026-11-03" } as const;

beforeEach(() => setupBoard());

describe("必須完成於 + 天數(沒有前置依賴)", () => {
  it("classic board: finish is the constraint date and start is counted back by Days", async () => {
    addItem("T", { days: 23 }, MUST_FINISH);

    await recomputeAllSchedules("B");

    expect(cell("T", "finish")).toBe("2026-11-03");
    // 23 calendar days ending on 11/03 start on 10/12.
    expect(cell("T", "start")).toBe("2026-10-12");
    expect(cell("T", "days")).toBe(23);
  });

  it("always-computed board: duration alone is enough — Days is written too", async () => {
    setupBoard({ alwaysComputed: true });
    addItem("T", { mdur: 23 }, MUST_FINISH);

    await recomputeAllSchedules("B");

    expect(cell("T", "finish")).toBe("2026-11-03");
    expect(cell("T", "start")).toBe("2026-10-12");
    expect(cell("T", "days")).toBe(23);
  });

  it("counts working days on a business-day board", async () => {
    setupBoard({ mode: "BUSINESS" });
    addItem("T", { days: 5 }, { constraintType: "MUST_FINISH_ON", constraintDate: "2026-09-04" });

    await recomputeAllSchedules("B");

    // Friday back five working days is the Monday of that week.
    expect(cell("T", "start")).toBe("2026-08-31");
    expect(cell("T", "finish")).toBe("2026-09-04");
  });

  it("writes nothing when there is no length to count back with", async () => {
    addItem("T", {}, MUST_FINISH);

    await recomputeAllSchedules("B");

    expect(cell("T", "start")).toBeNull();
    expect(cell("T", "finish")).toBeNull();
  });

  it("ignores constraints that don't pin the finish", async () => {
    addItem("T", { days: 5 }, { constraintType: "FINISH_NO_LATER_THAN", constraintDate: "2026-11-03" });

    await recomputeAllSchedules("B");

    expect(cell("T", "start")).toBeNull();
  });

  it("leaves a summary alone — its dates are its children's span", async () => {
    addItem("P", { days: 10 }, MUST_FINISH);
    addItem("C", { start: "2026-10-01", days: 3 }, { parentId: "P" });

    await recomputeAllSchedules("B");

    expect(cell("P", "start")).toBeNull();
    expect(cell("P", "finish")).toBeNull();
  });

  it("a predecessor does not override the pin", async () => {
    addItem("A", { start: "2026-10-20", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, MUST_FINISH);

    await recomputeAllSchedules("B");

    expect(cell("T", "finish")).toBe("2026-11-03");
    expect(cell("T", "start")).toBe("2026-11-01");
  });
});

describe("約束日期跟前置依賴矛盾", () => {
  // A 排在 T 前面(FS)。T 必須完成於 11/03、3 天 → 11/01 ~ 11/03,所以 A 最晚要在 10/31 做完。
  function chain(aStart: string) {
    addItem("A", { start: aStart, days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, MUST_FINISH);
    addItem("U", { days: 2, pred: "T", link: "fs" });
  }

  it("a predecessor that finishes too late conflicts with the pin", async () => {
    chain("2026-11-01"); // A 到 11/05 → T 最快 11/06 ~ 11/08
    const found = await findConstraintConflicts("B", "T");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ itemId: "T" });
    expect(found[0].message).toContain("2026-11-06 ~ 2026-11-08");
  });

  it("a predecessor with room to spare does not", async () => {
    chain("2026-10-20"); // A 到 10/24 → T 最快 10/25 ~ 10/27,趕得上
    expect(await findConstraintConflicts("B", "T")).toEqual([]);
  });

  it("the editor of an upstream item hears about the pinned item behind it (downstream)", async () => {
    chain("2026-11-01");
    expect(await findConstraintConflicts("B", "A")).toEqual([]);
    const found = await findConstraintConflicts("B", "A", { downstream: true });
    expect(found.map((c) => c.itemId)).toEqual(["T"]);
    expect(describeConstraintConflicts(found, "A")).toContain("「T」:");
  });

  it("an edit to a column that cannot move dates is not worth the check", async () => {
    chain("2026-11-01");
    expect(await findConstraintConflicts("B", "T", { editedColumnId: "comment" })).toEqual([]);
    expect(await findConstraintConflicts("B", "T", { editedColumnId: COLS.pred })).toHaveLength(1);
  });

  it("works on the stored dates, so it agrees with what the recompute wrote", async () => {
    chain("2026-11-01");
    await recomputeAllSchedules("B");
    // T is pinned at 11/01 ~ 11/03 even though A runs to 11/05; the conflict is still reported.
    expect(cell("T", "finish")).toBe("2026-11-03");
    expect(await findConstraintConflicts("B", "T")).toHaveLength(1);
  });
});

describe("儲存日期約束之後重算", () => {
  it("re-schedules the item itself when the Pred column is the trigger (classic board)", async () => {
    addItem("T", { days: 23 }, MUST_FINISH);

    await syncPredecessorSchedule("B", "T", COLS.pred);

    expect(cell("T", "finish")).toBe("2026-11-03");
    expect(cell("T", "start")).toBe("2026-10-12");
  });

  it("the Start column only cascades to dependents, never the item itself", async () => {
    addItem("T", { days: 23 }, MUST_FINISH);

    await syncPredecessorSchedule("B", "T", COLS.start);

    expect(cell("T", "start")).toBeNull();
  });

  it("always-computed board: the manual start column re-schedules the item", async () => {
    setupBoard({ alwaysComputed: true });
    addItem("T", { mdur: 23 }, MUST_FINISH);

    await syncPredecessorSchedule("B", "T", COLS.mstart);

    expect(cell("T", "start")).toBe("2026-10-12");
    expect(cell("T", "days")).toBe(23);
  });
});
