import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildGanttWorkbook } from "./ganttWorkbookExport";
import { BASE_DETAIL_HEADERS } from "./exportFields";
import type { BoardWithData, ColumnData, GroupData, ItemData } from "@/types/board";

const COL = {
  type: "c-type",
  priority: "c-priority",
  status: "c-status",
  resource: "c-resource",
  pred: "c-pred",
  link: "c-link",
  lag: "c-lag",
  comment: "c-comment",
  start: "c-start",
  days: "c-days",
  finish: "c-finish",
  startSet: "c-startset",
  progress: "c-progress",
};
const FS = "opt-fs";
const TASK = "opt-task";

function column(id: string, name: string, type: string, statuses: string[] = []): ColumnData {
  return {
    id,
    boardId: "b1",
    name,
    type,
    order: 0,
    options:
      statuses.length > 0
        ? { statuses: statuses.map((label) => ({ id: `opt-${label.toLowerCase()}`, label, color: "#000" })) }
        : null,
  } as unknown as ColumnData;
}

type Cell = [string, string | number | null];

function item(
  id: string,
  name: string,
  cells: Cell[],
  extra: Partial<ItemData> = {},
  order = 0
): ItemData {
  return {
    id,
    name,
    parentId: null,
    order,
    groupId: "g1",
    boardId: "b1",
    constraintType: null,
    constraintDate: null,
    baselineStart: null,
    baselineEnd: null,
    baselineDays: null,
    cellValues: cells.map(([columnId, value], i) => ({ id: `${id}-${i}`, itemId: id, columnId, value })),
    _count: { comments: 0 },
    assignments: [],
    viewers: [],
    ...extra,
  } as unknown as ItemData;
}

const group = { id: "g1", boardId: "b1", name: "專案", order: 0 } as unknown as GroupData;

function board(items: ItemData[]): BoardWithData {
  return {
    id: "b1",
    name: "測試看板",
    levelColors: [],
    groups: [group],
    items,
    columns: [
      column(COL.type, "Type", "STATUS", ["Task", "Summary", "Milestone"]),
      column(COL.priority, "Priority", "STATUS", ["NORMAL"]),
      column(COL.status, "Status", "STATUS", ["Planned"]),
      column(COL.resource, "Resource", "TEXT"),
      column(COL.pred, "Pred", "TEXT"),
      column(COL.link, "Link", "STATUS", ["FS", "SS"]),
      column(COL.lag, "Lag", "NUMBER"),
      column(COL.comment, "Comment", "TEXT"),
      column(COL.start, "Start", "DATE"),
      column(COL.days, "Days", "NUMBER"),
      column(COL.finish, "Finish", "DATE"),
      column(COL.startSet, "start(set)", "DATE"),
      column(COL.progress, "% Done", "NUMBER"),
    ],
    progressColumnId: COL.progress,
    ganttStartColumnId: COL.start,
    ganttDurationColumnId: COL.days,
    ganttEndColumnId: COL.finish,
    manualStartColumnId: COL.startSet,
    manualDurationColumnId: null,
    ganttDurationMode: "BUSINESS",
    predColumnId: COL.pred,
    linkColumnId: COL.link,
    lagColumnId: COL.lag,
  } as unknown as BoardWithData;
}

/** A → B, where B may name several predecessors or carry a constraint. */
function chainBoard(predValue: string, extra: Partial<ItemData> = {}): BoardWithData {
  return board([
    item(
      "a",
      "A 前置",
      [
        [COL.type, TASK],
        [COL.start, "2026-01-05"],
        [COL.days, 5],
        [COL.finish, "2026-01-09"],
      ],
      {},
      1
    ),
    item(
      "c",
      "C 另一個前置",
      [
        [COL.type, TASK],
        [COL.start, "2026-01-05"],
        [COL.days, 3],
        [COL.finish, "2026-01-07"],
      ],
      {},
      2
    ),
    // Starts the next business day after A finishes — no slack anywhere on
    // A→B, which is what makes it the critical path.
    item(
      "b",
      "B 後續",
      [
        [COL.type, TASK],
        [COL.pred, predValue],
        [COL.link, FS],
        [COL.start, "2026-01-12"],
        [COL.days, 3],
        [COL.finish, "2026-01-14"],
      ],
      extra,
      3
    ),
  ]);
}

async function load(wb: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(wb as unknown as ArrayBuffer);
  return workbook;
}

function formulaOf(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  const value = sheet.getCell(row, col).value as { formula?: string } | null;
  return value && typeof value === "object" && "formula" in value ? (value.formula ?? "") : "";
}

describe("buildGanttWorkbook", () => {
  it("writes every sheet the export promises", async () => {
    const workbook = await load(await buildGanttWorkbook(chainBoard("a"), group));
    expect(workbook.worksheets.map((s) => s.name)).toEqual([
      "Settings",
      "Lists",
      "Holidays",
      "Gantt (Day)",
      "Gantt (Week)",
      "Gantt (Month)",
      "預算 (Budget)",
      "燃盡圖 (Burn-down)",
      "延遲追因 (Delay)",
    ]);
  });

  it("points the Resource dropdown at the Lists sheet, and seeds it with everyone", async () => {
    const buffer = await buildGanttWorkbook(chainBoard("a"), group, {
      users: [
        { id: "u1", name: "王小明" },
        { id: "u2", name: "陳大文" },
      ],
    });
    const workbook = await load(buffer);

    // The whole roster, not just names already used on a row.
    const lists = workbook.getWorksheet("Lists")!;
    expect([lists.getCell("A2").value, lists.getCell("A3").value].sort()).toEqual(["王小明", "陳大文"]);

    const day = workbook.getWorksheet("Gantt (Day)")!;
    const validation = day.getCell(7, 7).dataValidation;
    expect(validation?.formulae?.[0]).toContain("Lists!");
    // A suggestion, not a rule — the bundled script writes "Amy, Ben" by
    // design, and a rejecting list would refuse every one of them.
    expect(validation?.showErrorMessage).toBeFalsy();
  });

  it("translates a Pred that carries its own relationship and lag", async () => {
    // Stored as "<id>:SS+2" — the id must not reach the sheet raw, and the
    // per-edge settings belong in the Link/Lag columns.
    const workbook = await load(await buildGanttWorkbook(chainBoard("a:SS+2"), group));
    const day = workbook.getWorksheet("Gantt (Day)")!;

    expect(day.getCell(9, 8).value).toBe("1"); // Pred → A's WBS code
    expect(day.getCell(9, 9).value).toBe("SS");
    expect(day.getCell(9, 10).value).toBe(2);
  });

  it("takes the latest of several predecessors instead of falling back to today", async () => {
    const workbook = await load(await buildGanttWorkbook(chainBoard("a,c"), group));
    const day = workbook.getWorksheet("Gantt (Day)")!;
    const baseCol = BASE_DETAIL_HEADERS.length + 6;

    const formula = formulaOf(day, 9, baseCol);
    expect(formula).toContain("MAX(");
    // Both predecessors named by WBS code — a single cell reference cannot
    // express a list, which is why the single-pred case is the only one that
    // reads $H.
    expect(formula).toContain('"1"');
    expect(formula).toContain('"2"');
  });

  it("reads a single Pred out of the cell, so the column stays editable", async () => {
    const workbook = await load(await buildGanttWorkbook(chainBoard("a"), group));
    const day = workbook.getWorksheet("Gantt (Day)")!;
    const formula = formulaOf(day, 9, BASE_DETAIL_HEADERS.length + 6);

    expect(formula).toContain("$H9");
    expect(formula).not.toContain("MAX(IFERROR");
  });

  it("carries a date constraint into the sheet and into the Start formula", async () => {
    const workbook = await load(
      await buildGanttWorkbook(
        chainBoard("a", { constraintType: "START_NO_EARLIER_THAN", constraintDate: "2026-02-02" }),
        group
      )
    );
    const day = workbook.getWorksheet("Gantt (Day)")!;

    expect(day.getCell(9, 18).value).toBe("不得早於(開始)");
    expect((day.getCell(9, 19).value as Date).toISOString().slice(0, 10)).toBe("2026-02-02");

    // 不得早於 only ever pushes later — MAX against the scheduled date.
    const start = formulaOf(day, 9, 13);
    expect(start).toContain("MAX(");
    expect(start).toContain("不得早於(開始)");
    // 必須完成於 derives the start backwards from the pinned finish.
    expect(start).toContain("WORKDAY($S9");

    expect(day.getCell(7, 18).dataValidation?.formulae?.[0]).toContain("不得晚於(完成)");
  });

  it("marks the critical path so the bar rule can colour it", async () => {
    const workbook = await load(await buildGanttWorkbook(chainBoard("a"), group));
    const day = workbook.getWorksheet("Gantt (Day)")!;

    // C (10 days, nothing downstream) has float against B's chain; A→B is the
    // longest path, so both of those are critical.
    expect(day.getCell(7, 21).value).toBe("★"); // A
    expect(day.getCell(9, 21).value).toBe("★"); // B
    expect(day.getCell(7, 20).value).toBe(0); // A's float
    expect(day.getCell(8, 20).value).toBeGreaterThan(0); // C has slack
  });

  it("says so plainly when there is no budget and no baseline", async () => {
    const workbook = await load(await buildGanttWorkbook(chainBoard("a"), group));
    expect(workbook.getWorksheet("預算 (Budget)")!.getCell("A4").value).toContain("還沒有核准");
    expect(workbook.getWorksheet("延遲追因 (Delay)")!.getCell("A4").value).toContain("基準線");
  });

  it("lays out the budget and burn-down it was handed", async () => {
    const buffer = await buildGanttWorkbook(chainBoard("a"), group, {
      budgets: [
        {
          name: "EVT",
          kind: "階段",
          alert: "已超支",
          lines: [
            { label: "材料", budget: 1_000_000, actual: 900_000, committed: 300_000, remaining: -200_000, usedPct: 120 },
          ],
          total: { label: "合計", budget: 1_000_000, actual: 900_000, committed: 300_000, remaining: -200_000, usedPct: 120 },
          reserves: [{ label: "應變準備金", approved: 500_000, drawn: 100_000, remaining: 400_000 }],
          labourActual: 0,
          fractionDone: 0.4,
          engaged: 1_200_000,
          eacAtCurrentRate: 3_000_000,
          eacRemainingAtPlan: 1_800_000,
          varianceAtCompletion: -2_000_000,
          points: [
            { iso: "2026-01-05", planned: 100_000, actual: 90_000, committed: 90_000 },
            { iso: "2026-01-12", planned: 200_000, actual: null, committed: 1_200_000 },
          ],
        },
      ],
      delay: {
        projectDelay: 12,
        noBaseline: false,
        culprits: [
          {
            wbsCode: "1.2",
            name: "治具重做",
            startDelta: 3,
            endDelta: 12,
            daysDelta: 9,
            inheritedDelay: 3,
            ownDelay: 9,
            downstreamCount: 7,
          },
        ],
      },
    });
    const workbook = await load(buffer);

    const budget = workbook.getWorksheet("預算 (Budget)")!;
    expect(budget.getCell("A4").value).toContain("EVT");
    expect(budget.getCell("A4").value).toContain("已超支");
    expect(budget.getCell("E6").value).toBe(-200_000);

    // Title on 4, header on 5, the two weeks on 6 and 7.
    const burn = workbook.getWorksheet("燃盡圖 (Burn-down)")!;
    expect(burn.getCell("A4").value).toContain("EVT");
    expect(burn.getCell("A5").value).toBe("週結束日");
    expect(burn.getCell("B6").value).toBe(100_000);
    // 剩餘預算 = 核准 − 實際含已下單, and it has already gone negative.
    expect(burn.getCell("E7").value).toBe(-200_000);
    // A week with no actual yet is left empty, so a chart breaks the line
    // there rather than drawing it along the floor.
    expect(burn.getCell("C7").value).toBeNull();

    const delay = workbook.getWorksheet("延遲追因 (Delay)")!;
    expect(delay.getCell("B4").value).toBe(12);
    expect(delay.getCell("B7").value).toBe("治具重做");
    expect(delay.getCell("G7").value).toBe(9); // 自己的延遲
  });
});
