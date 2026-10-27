import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 「一律自己計算」的看板上,Summary(有子項、沒有自己 Pred 的父項)的起訖是所有子項的範圍:
 * 最早的開始、最晚的結束,Days 是這段的長度。寫進儲存格,表格與後面接著排的項目讀到的才是同一份。
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
      findUnique: async ({ where }: { where: { id: string } }) => db.items.find((i) => i.id === where.id) ?? null,
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

const { recomputeAllSchedules, syncPredecessorSchedule, rollUpSummaries, previewScheduleCascade } = await import(
  "@/lib/predecessorLink"
);

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
      manualStartColumnId: options.alwaysComputed === false ? null : COLS.mstart,
      manualDurationColumnId: options.alwaysComputed === false ? null : COLS.mdur,
      typeColumnId: null,
    },
  ];
  db.items = [];
}

function addItem(id: string, cells: Partial<Record<keyof typeof COLS, unknown>>, parentId: string | null = null) {
  db.items.push({
    id,
    name: id,
    boardId: "B",
    groupId: "G",
    parentId,
    order: db.items.length + 1,
    constraintType: null,
    constraintDate: null,
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

/** 2026-10-08 這種 Summary 自己的值(建立當天、0 天),是正式環境看到的那種。 */
const STALE_OWN = { mstart: "2026-10-08", mdur: 0, start: "2026-10-08", days: 0, finish: "2026-10-08" };

const calendarDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1;

beforeEach(() => setupBoard());

describe("Summary 的起訖取子項的範圍", () => {
  it("開始 = 最早的子項開始、結束 = 最晚的子項結束、Days = 這段的長度", async () => {
    addItem("S", STALE_OWN);
    addItem("C1", { mstart: "2026-08-20", mdur: 3 }, "S");
    addItem("C2", { mstart: "2027-03-30", mdur: 2 }, "S");

    await recomputeAllSchedules("B");

    expect(cell("S", "start")).toBe("2026-08-20");
    expect(cell("S", "finish")).toBe("2027-03-31");
    expect(cell("S", "days")).toBe(calendarDays("2026-08-20", "2027-03-31"));
  });

  it("工作天看板:Days 算工作天(週末與假日不算)", async () => {
    setupBoard({ mode: "BUSINESS" });
    addItem("S", STALE_OWN);
    // 2026-10-05 週一做 5 天到週五 10-09;2026-10-12 週一做 1 天。
    addItem("C1", { mstart: "2026-10-05", mdur: 5 }, "S");
    addItem("C2", { mstart: "2026-10-12", mdur: 1 }, "S");

    await recomputeAllSchedules("B");

    expect(cell("S", "start")).toBe("2026-10-05");
    expect(cell("S", "finish")).toBe("2026-10-12");
    expect(cell("S", "days")).toBe(6);
  });

  it("一層一層往上:Summary 裡的 Summary,最上層取到最底下所有葉子的範圍", async () => {
    addItem("TOP", STALE_OWN);
    addItem("MID", STALE_OWN, "TOP");
    addItem("L1", { mstart: "2026-09-01", mdur: 10 }, "MID");
    addItem("L2", { mstart: "2026-11-01", mdur: 5 }, "MID");
    addItem("L3", { mstart: "2026-12-10", mdur: 4 }, "TOP");

    await recomputeAllSchedules("B");

    expect(cell("MID", "start")).toBe("2026-09-01");
    expect(cell("MID", "finish")).toBe("2026-11-05");
    expect(cell("TOP", "start")).toBe("2026-09-01");
    expect(cell("TOP", "finish")).toBe("2026-12-13");
  });

  it("改了一個子項的天數,它的 Summary(與上層)的結束跟著變", async () => {
    addItem("TOP", STALE_OWN);
    addItem("MID", STALE_OWN, "TOP");
    addItem("L1", { mstart: "2026-09-01", mdur: 10 }, "MID");
    await recomputeAllSchedules("B");
    expect(cell("TOP", "finish")).toBe("2026-09-10");

    // 使用者把 L1 改成 20 天(這個欄位是觸發欄位)。
    db.items.find((i) => i.id === "L1")!.cellValues.find((c) => c.columnId === COLS.mdur)!.value = 20;
    await syncPredecessorSchedule("B", "L1", COLS.mdur);

    expect(cell("L1", "finish")).toBe("2026-09-20");
    expect(cell("MID", "finish")).toBe("2026-09-20");
    expect(cell("TOP", "finish")).toBe("2026-09-20");
    expect(cell("TOP", "days")).toBe(20);
  });

  it("有自己 Pred 的父項不跟子項走(它自己的排程規則優先)", async () => {
    addItem("A", { mstart: "2026-09-01", mdur: 5 });
    addItem("S", { pred: "A", link: "fs", mstart: "2026-09-01", mdur: 10 });
    addItem("C1", { mstart: "2026-12-01", mdur: 3 }, "S");

    await recomputeAllSchedules("B");

    // S 接在 A 後面(A 在 09-05 結束),不是取 C1 的 12 月。
    expect(cell("S", "start")).toBe("2026-09-06");
  });

  it("後面接在 Summary 之後的項目,跟著 Summary 新的結束日走", async () => {
    addItem("S", STALE_OWN);
    addItem("C1", { mstart: "2026-09-01", mdur: 10 }, "S");
    addItem("D", { pred: "S", link: "fs", mstart: "2026-01-01", mdur: 2 });

    await recomputeAllSchedules("B");

    expect(cell("S", "finish")).toBe("2026-09-10");
    // FS:Summary 結束的隔天開始。
    expect(cell("D", "start")).toBe("2026-09-11");
  });

  it("資料有環(子項的前置是自己的父項)也停得下來,不會無窮遞迴", async () => {
    addItem("S", STALE_OWN);
    addItem("C1", { pred: "S", link: "fs", mstart: "2026-09-01", mdur: 3 }, "S");

    await expect(recomputeAllSchedules("B")).resolves.toBeDefined();
  });

  it("不是「一律自己計算」的看板不動它(Days 在那裡是手填的輸入)", async () => {
    setupBoard({ alwaysComputed: false });
    addItem("S", { start: "2026-10-08", days: 1 });
    addItem("C1", { start: "2026-08-20", days: 3 }, "S");

    await recomputeAllSchedules("B");

    expect(cell("S", "start")).toBe("2026-10-08");
    expect(cell("S", "days")).toBe(1);
  });
});

describe("結構變了之後重新統計(rollUpSummaries)", () => {
  it("搬走最晚的子項:結束日縮回剩下子項的範圍", async () => {
    addItem("S", STALE_OWN);
    addItem("C1", { mstart: "2026-09-01", mdur: 3 }, "S");
    addItem("C2", { mstart: "2027-03-30", mdur: 2 }, "S");
    await recomputeAllSchedules("B");
    expect(cell("S", "finish")).toBe("2027-03-31");

    db.items.find((i) => i.id === "C2")!.parentId = null; // 搬到最上層

    await rollUpSummaries("B", ["S"]);

    expect(cell("S", "finish")).toBe("2026-09-03");
    expect(cell("S", "days")).toBe(3);
  });

  it("最後一個子項沒了:父項回到它自己的開始日 + 天數", async () => {
    addItem("S", { mstart: "2026-10-08", mdur: 4 });
    addItem("C1", { mstart: "2026-09-01", mdur: 3 }, "S");
    await recomputeAllSchedules("B");
    expect(cell("S", "start")).toBe("2026-09-01");

    db.items = db.items.filter((i) => i.id !== "C1");
    await rollUpSummaries("B", ["S"]);

    expect(cell("S", "start")).toBe("2026-10-08");
    expect(cell("S", "finish")).toBe("2026-10-11");
    expect(cell("S", "days")).toBe(4);
  });
});

describe("預覽「這樣拖會連動誰」不列被統計的 Summary", () => {
  it("拖一個子項:Summary 跟著變,但不會讓確認視窗列出它", async () => {
    addItem("S", STALE_OWN);
    addItem("C1", { mstart: "2026-09-01", mdur: 3 }, "S");
    await recomputeAllSchedules("B");

    const preview = await previewScheduleCascade("B", "C1", {
      start: new Date("2026-09-10T00:00:00Z"),
      end: new Date("2026-09-12T00:00:00Z"),
    });

    expect(preview.cascaded.map((c) => c.itemId)).not.toContain("S");
  });
});
