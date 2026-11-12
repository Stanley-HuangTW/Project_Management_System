import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 日期約束的日期可以跟著前置任務的開始日 / 完成日走。
 *
 * 跑真的排程引擎,資料庫換成記憶體版(行為在遍歷裡,不在 Postgres 裡):約束日期取自前置任務現在的起訖、
 * 前置任務一動就跟著動、算出來的日期存回 constraintDate、前置任務不在 Pred 裡了就轉成固定日期。
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
  constraintRefItemId: string | null;
  constraintRefEdge: "START" | "FINISH" | null;
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
      findUnique: async ({ where }: { where: { id: string } }) => db.boards.find((b) => b.id === where.id) ?? null,
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
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeItem> }) => {
        const item = db.items.find((i) => i.id === where.id)!;
        Object.assign(item, data);
        return item;
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

const { recomputeAllSchedules, listItemPredecessors, previewScheduleChange } = await import("@/lib/predecessorLink");

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

function setupBoard() {
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
      ganttDurationMode: "CALENDAR",
      manualStartColumnId: null,
      manualDurationColumnId: null,
      typeColumnId: null,
    },
  ];
  db.items = [];
}

function addItem(
  id: string,
  cells: Partial<Record<keyof typeof COLS, unknown>>,
  extra: Partial<Pick<FakeItem, "constraintType" | "constraintDate" | "constraintRefItemId" | "constraintRefEdge">> = {}
) {
  db.items.push({
    id,
    name: `任務${id}`,
    boardId: "B",
    groupId: "G",
    parentId: null,
    order: db.items.length + 1,
    constraintType: extra.constraintType ?? null,
    constraintDate: extra.constraintDate ?? null,
    constraintRefItemId: extra.constraintRefItemId ?? null,
    constraintRefEdge: extra.constraintRefEdge ?? null,
    cellValues: Object.entries(cells).map(([key, value]) => ({ itemId: id, columnId: COLS[key as keyof typeof COLS], value })),
  });
}

const item = (id: string) => db.items.find((i) => i.id === id)!;
function cell(itemId: string, key: keyof typeof COLS) {
  const value = item(itemId).cellValues.find((c) => c.columnId === COLS[key])?.value;
  return value === undefined ? null : value;
}
function setCell(itemId: string, key: keyof typeof COLS, value: unknown) {
  const target = item(itemId);
  const existing = target.cellValues.find((c) => c.columnId === COLS[key]);
  if (existing) existing.value = value;
  else target.cellValues.push({ itemId, columnId: COLS[key], value });
}

beforeEach(() => setupBoard());

describe("約束日期跟著前置任務的完成日(必須完成於)", () => {
  // A 11/02 起 5 天 → 11/02 ~ 11/06。T 排在 A 後面(FS),必須完成於「A 的完成日」,3 天 → 11/04 ~ 11/06。
  const follow = { constraintType: "MUST_FINISH_ON", constraintDate: "2026-01-01", constraintRefItemId: "A", constraintRefEdge: "FINISH" } as const;

  it("T 的完成日釘在 A 現在的完成日,存下來的約束日期也換成那一天", async () => {
    addItem("A", { start: "2026-11-02", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, follow);

    await recomputeAllSchedules("B");

    expect(cell("T", "finish")).toBe("2026-11-06");
    expect(cell("T", "start")).toBe("2026-11-04");
    expect(item("T").constraintDate).toBe("2026-11-06");
    expect(item("T").constraintRefItemId).toBe("A");
  });

  it("A 往後挪,T 跟著動:完成日、開始日與存下來的約束日期都更新", async () => {
    addItem("A", { start: "2026-11-02", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, follow);
    await recomputeAllSchedules("B");

    setCell("A", "start", "2026-11-09"); // A 變成 11/09 ~ 11/13
    setCell("A", "finish", "2026-11-13");
    await recomputeAllSchedules("B");

    expect(cell("T", "finish")).toBe("2026-11-13");
    expect(cell("T", "start")).toBe("2026-11-11");
    expect(item("T").constraintDate).toBe("2026-11-13");
  });

  it("後面接著 T 的項目也跟著算(連動一路傳下去)", async () => {
    addItem("A", { start: "2026-11-02", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, follow);
    addItem("U", { days: 2, pred: "T", link: "fs" });
    await recomputeAllSchedules("B");
    expect(cell("U", "start")).toBe("2026-11-07"); // T 到 11/06,FS 接在隔天

    setCell("A", "start", "2026-11-09");
    setCell("A", "finish", "2026-11-13");
    await recomputeAllSchedules("B");

    expect(cell("U", "start")).toBe("2026-11-14");
  });
});

describe("約束日期跟著前置任務的開始日", () => {
  it("不得早於(開始):前置算出的開始日比前置任務的開始日早,就被推到前置任務的開始日", async () => {
    // A 11/10 起 5 天;B 排在 A 後面 FS → 最快 11/15。約束「不得早於 A 的開始日」= 11/10,比 11/15 早,不動。
    addItem("A", { start: "2026-11-10", days: 5 });
    addItem("B", { days: 3, pred: "A", link: "fs" }, { constraintType: "START_NO_EARLIER_THAN", constraintDate: "2026-01-01", constraintRefItemId: "A", constraintRefEdge: "START" });

    await recomputeAllSchedules("B");

    expect(cell("B", "start")).toBe("2026-11-15");
    expect(item("B").constraintDate).toBe("2026-11-10"); // 存的是 A 的開始日
  });

  it("不得早於前置任務的完成日:比 FS 的隔天更早排不進去,所以照約束推到完成日當天以後", async () => {
    // A 11/10 起 5 天 → 到 11/14。B 沒有 Link(預設 FS 隔天 = 11/15);約束不得早於 A 的完成日 11/14,不更晚,不動。
    addItem("A", { start: "2026-11-10", days: 5 });
    addItem("B", { days: 2, pred: "A" }, { constraintType: "START_NO_EARLIER_THAN", constraintDate: null, constraintRefItemId: "A", constraintRefEdge: "FINISH" });

    await recomputeAllSchedules("B");

    expect(item("B").constraintDate).toBe("2026-11-14");
  });
});

describe("前置任務不在 Pred 裡了:轉成固定日期", () => {
  const follow = { constraintType: "MUST_FINISH_ON", constraintDate: "2026-11-06", constraintRefItemId: "A", constraintRefEdge: "FINISH" } as const;

  it("把 A 從 Pred 拿掉:約束留在存下來的日期(固定),不再跟著 A,日期不會消失", async () => {
    addItem("A", { start: "2026-11-02", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, follow);
    await recomputeAllSchedules("B");
    expect(item("T").constraintRefItemId).toBe("A");

    setCell("T", "pred", null); // 拿掉前置任務
    await recomputeAllSchedules("B");

    expect(item("T").constraintRefItemId).toBeNull();
    expect(item("T").constraintRefEdge).toBeNull();
    expect(item("T").constraintType).toBe("MUST_FINISH_ON");
    expect(item("T").constraintDate).toBe("2026-11-06");
    expect(cell("T", "finish")).toBe("2026-11-06");

    // 之後 A 再怎麼動,T 都不受影響
    setCell("A", "start", "2026-12-01");
    setCell("A", "finish", "2026-12-05");
    await recomputeAllSchedules("B");
    expect(cell("T", "finish")).toBe("2026-11-06");
  });

  it("存著的前置任務根本不是這個項目的前置:同樣轉成固定日期", async () => {
    addItem("A", { start: "2026-11-02", days: 5 });
    addItem("X", { start: "2026-12-01", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, { ...follow, constraintRefItemId: "X" });

    await recomputeAllSchedules("B");

    expect(item("T").constraintRefItemId).toBeNull();
    expect(cell("T", "finish")).toBe("2026-11-06"); // 用存著的固定日期
  });
});

describe("固定日期的約束不受影響", () => {
  it("沒有 constraintRefItemId:跟以前一模一樣", async () => {
    addItem("A", { start: "2026-10-20", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, { constraintType: "MUST_FINISH_ON", constraintDate: "2026-11-03" });

    await recomputeAllSchedules("B");

    expect(cell("T", "finish")).toBe("2026-11-03");
    expect(cell("T", "start")).toBe("2026-11-01");
    expect(item("T").constraintDate).toBe("2026-11-03");
    expect(item("T").constraintRefItemId).toBeNull();
  });
});

describe("listItemPredecessors:給約束日期選單用的前置任務", () => {
  it("列出 Pred 裡的前置任務與它們現在的起訖", async () => {
    addItem("A", { start: "2026-11-02", days: 5, finish: "2026-11-06" });
    addItem("C", { start: "2026-11-10", days: 2, finish: "2026-11-11" });
    addItem("T", { days: 3, pred: "A,C", link: "fs" });

    const list = await listItemPredecessors("B", "T");

    expect(list.map((p) => p.itemId).sort()).toEqual(["A", "C"]);
    const a = list.find((p) => p.itemId === "A")!;
    expect(a).toMatchObject({ name: "任務A", start: "2026-11-02", end: "2026-11-06", boardName: null });
  });

  it("沒有前置任務、或前置任務還沒有日期:空清單 / 日期是 null", async () => {
    addItem("A", {});
    addItem("T", { days: 3, pred: "A", link: "fs" });
    addItem("U", { days: 3 });

    expect(await listItemPredecessors("B", "U")).toEqual([]);
    expect((await listItemPredecessors("B", "T"))[0]).toMatchObject({ itemId: "A", start: null, end: null });
  });
});

describe("預覽 Pred 修改時也認約束的日期來源", () => {
  it("拿掉前置任務之後,預覽用存著的固定日期;沒拿掉時用前置任務現在的日期", async () => {
    addItem("A", { start: "2026-11-02", days: 5 });
    addItem("T", { days: 3, pred: "A", link: "fs" }, { constraintType: "MUST_FINISH_ON", constraintDate: "2026-01-01", constraintRefItemId: "A", constraintRefEdge: "FINISH" });

    const kept = await previewScheduleChange("B", "T", COLS.pred, "A");
    expect(kept?.end).toBe("2026-11-06"); // 跟著 A 的完成日
    const dropped = await previewScheduleChange("B", "T", COLS.pred, null);
    expect(dropped?.end).toBe("2026-01-01"); // A 不在 Pred 了 → 存著的日期
  });
});
