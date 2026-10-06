import ExcelJS from "exceljs";
import type { BoardWithData, ColumnData, GroupData, ItemData, UserOption } from "@/types/board";
import { computeWbsCodes } from "@/lib/wbs";
import { getStatusOptions, getPersonIds } from "@/types/column";
import { computeRolledUpDateRange } from "@/lib/gantt";
import { computeCriticalPath } from "@/lib/criticalPath";
import { toHolidaySet } from "@/lib/holidays";
import { BASE_DETAIL_HEADERS } from "@/lib/export/exportFields";
import { CONSTRAINT_LABELS } from "@/lib/constraints";
import { splitPredEntry } from "@/lib/predecessorLink";
import type { BudgetScopeExport, DelayExport } from "@/lib/export/exportData";

const BASE_DETAIL_COL_COUNT = BASE_DETAIL_HEADERS.length; // 21 — the fixed template columns
const COLUMN_WIDTHS = [6, 12, 40, 12, 10, 12, 24, 10, 8, 8, 30, 12, 12, 8, 8, 12, 10, 16, 14, 8, 8];
const DEFAULT_EXTRA_COLUMN_WIDTH = 16;

// Hidden helper columns, placed exactly where the reference template puts
// them: right after the visible detail area (fixed columns + any selected
// extra fields) — type-code + WBS level 1-4 running counters — and two more
// (level 5-6 counters) tacked on after the entire timeline ends — WBS only
// needs to look past 4 levels deep in the rare case a board nests that far,
// so keeping them out of the main block avoids widening every row's
// "visible" columns for a rare case.
// type-code, level1-4, and the un-constrained start the Start column then
// applies the row's date constraint to (kept in its own cell so both formulas
// stay short enough to read).
const HELPER_PREFIX_COUNT = 6;
function timelineStartCol(detailColCount: number): number {
  return detailColCount + HELPER_PREFIX_COUNT + 1;
}

// A generous, fixed-size range so WORKDAY/NETWORKDAYS keep working if the
// user adds more rows to the Holidays sheet after opening the export —
// blank cells within the range are simply ignored by both functions.
const HOLIDAYS_RANGE = "Holidays!$A$6:$A$1005";

// Same idea for the Resource dropdown: a range with room to grow, so names
// added to the Lists sheet appear in the dropdown without re-exporting.
const LISTS_MEMBER_RANGE = "Lists!$A$2:$A$501";

// Colours reverse-engineered from the reference sheet's conditional-format
// rules (Excel's Interior.Color is BGR-packed, not RGB — converted here).
const BAR_COLORS = {
  milestone: "FFC0392B",
  completed: "FF27AE60",
  summary: "FF2E5395",
  task: "FF4C86C6",
  /** 要徑 — deliberately the loudest colour on the sheet. */
  critical: "FFE74C3C",
};
const TODAY_COLOR = "FFFDEBD8";
// The dependency connector: light enough that it reads as a link between two
// bars rather than as a bar of its own.
const LINK_COLOR = "FFD6DBDF";
const LINK_EDGE_COLOR = "FF7F8C8D";
const DEFAULT_LEVEL_COLORS = ["#4F81BD", "#9BBB59", "#EAF1DD", "#E5DFEC", "#E6D3B3", "#CFE2F3"];

const DEFAULT_TYPE_OPTIONS = ["Task", "Summary", "Milestone"];
const DEFAULT_PRIORITY_OPTIONS = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const DEFAULT_STATUS_OPTIONS = ["Planned", "In Progress", "Completed", "On Hold"];

function findColumn(columns: ColumnData[], name: string): ColumnData | undefined {
  const target = name.trim().toLowerCase();
  return columns.find((c) => c.name.trim().toLowerCase() === target);
}

function getRawValue(item: ItemData, column: ColumnData | undefined): string | number | null {
  if (!column) return null;
  const value = item.cellValues.find((cv) => cv.columnId === column.id)?.value;
  return value === undefined ? null : (value as string | number | null);
}

function getRawValueByColumnId(item: ItemData, columnId: string | null): string | number | null {
  if (!columnId) return null;
  const value = item.cellValues.find((cv) => cv.columnId === columnId)?.value;
  return value === undefined ? null : (value as string | number | null);
}

function getStatusLabel(item: ItemData, column: ColumnData | undefined): string {
  if (!column) return "";
  const value = getRawValue(item, column);
  if (value == null) return "";
  const options = getStatusOptions(column.options);
  return options.find((o) => o.id === value)?.label ?? "";
}

function getStatusOptionLabels(column: ColumnData | undefined, fallback: string[]): string[] {
  if (!column) return fallback;
  const labels = getStatusOptions(column.options).map((o) => o.label);
  return labels.length > 0 ? labels : fallback;
}

/** The board's "% Done" values mix a 0-1 fraction and a raw 0-100 number —
 *  the same ambiguity the reference .gs script's own norm() works around. */
function normalizePercent(raw: number): number {
  return raw > 1 ? raw / 100 : raw;
}

function parseDate(raw: string | number | null): Date | null {
  if (typeof raw !== "string") return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Reads an optional extra field's cell value into the form it should be
 *  written to the sheet — most notably resolving a PERSON column's stored
 *  user/resource id(s) into the display name(s), since the raw id would be
 *  meaningless outside the app. */
function resolveExtraValue(
  item: ItemData,
  column: ColumnData,
  users: UserOption[]
): string | number | Date | null {
  const raw = getRawValue(item, column);
  switch (column.type) {
    case "PERSON": {
      const names = getPersonIds(raw).map((id) => users.find((u) => u.id === id)?.name ?? id);
      return names.length > 0 ? names.join(", ") : null;
    }
    case "STATUS":
      return getStatusLabel(item, column) || null;
    case "DATE":
      return parseDate(raw);
    case "NUMBER":
      return typeof raw === "number" ? raw : null;
    default:
      return typeof raw === "string" ? raw : null;
  }
}

function orderedItems(items: ItemData[]): {
  ordered: ItemData[];
  childrenOf: Map<string | null, ItemData[]>;
} {
  const byParent = new Map<string | null, ItemData[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const ordered: ItemData[] = [];
  function walk(parentId: string | null) {
    for (const child of byParent.get(parentId) ?? []) {
      ordered.push(child);
      walk(child.id);
    }
  }
  walk(null);

  return { ordered, childrenOf: byParent };
}

function colLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Formulas below reproduce the reference template's own — a running
 * COUNTIF-based WBS numbering scheme (see the level-counter helper columns
 * below) plus a Pred/Link/Lag-driven Start/Finish, all expressed as plain
 * (non-shared) per-cell formulas so the exported workbook keeps recomputing
 * itself in Excel/Sheets after rows are added, removed, or reordered —
 * exactly like the reference — instead of the static values this export
 * used to bake in.
 */

/** A level-N running counter: how many times Lvl=N has occurred since the
 *  last row whose Lvl was shallower than N — i.e. this row's position
 *  among its level-N siblings under the current parent. Position-independent
 *  (only ever reads column A), so it doesn't need to know where the extra
 *  fields or helper columns actually landed. */
function levelCounterFormula(row: number, level: number): string {
  const a = `$A$7:$A${row}`;
  if (level === 1) {
    return `IF($A${row}="","",COUNTIF(${a},1))`;
  }
  return (
    `IF($A${row}="","",IF($A${row}<${level},0,COUNTIF(INDEX(${a},` +
    `MAX(1,SUMPRODUCT(MAX((${a}<${level})*(${a}<>"")*ROW(${a})))-6)):$A${row},${level})))`
  );
}

function typeCodeFormula(row: number): string {
  return `IF($D${row}="Summary","S",IF($D${row}="Milestone","M",IF($D${row}="Task","T","")))`;
}

/** WBS text built from the level counters, e.g. lvl1&"."&lvl2&"."&lvl3 for a
 *  level-3 row — only appends a segment while $A (Lvl) reaches that deep.
 *  levelCols[i] is the column letter holding the level-(i+1) counter — these
 *  shift depending on how many extra fields were selected for export, so
 *  they're passed in rather than hardcoded. */
function wbsFormula(row: number, levelCols: string[]): string {
  return (
    `IF($A${row}="","",${levelCols[0]}${row}` +
    `&IF($A${row}>=2,"."&${levelCols[1]}${row},"")` +
    `&IF($A${row}>=3,"."&${levelCols[2]}${row},"")` +
    `&IF($A${row}>=4,"."&${levelCols[3]}${row},"")` +
    `&IF($A${row}>=5,"."&${levelCols[4]}${row},"")` +
    `&IF($A${row}>=6,"."&${levelCols[5]}${row},""))`
  );
}

/** The date one predecessor pushes this row to, per the FS/SS/FF/SF rules the
 *  app's own scheduler uses. `ref` is the expression naming the predecessor —
 *  `$H{row}` when the row has exactly one, so editing the Pred cell in the
 *  sheet still re-derives the date; a quoted WBS code for one entry of a
 *  multi-predecessor list, which no single cell reference can express.
 *  A blank Link means FS, matching the app, rather than falling to today. */
function predStartExpr(row: number, ref: string, lastDataRow: number): string {
  const match = `MATCH(${ref}&"",$B$7:$B${lastDataRow},0)`;
  const predFinish = `INDEX($P$7:$P${lastDataRow},${match})`;
  const predStart = `INDEX($M$7:$M${lastDataRow},${match})`;
  const lag = `IF($J${row}="",0,$J${row})`;
  // FF/SF anchor the row's FINISH, so its start is one duration earlier.
  const back = `-(MAX(N($N${row}),1)-1)`;
  return (
    `IF($I${row}="SS",WORKDAY(${predStart},${lag},${HOLIDAYS_RANGE}),` +
    `IF($I${row}="FF",WORKDAY(${predFinish},${lag}${back},${HOLIDAYS_RANGE}),` +
    `IF($I${row}="SF",WORKDAY(${predStart},${lag}${back},${HOLIDAYS_RANGE}),` +
    `WORKDAY(${predFinish},1+${lag},${HOLIDAYS_RANGE}))))`
  );
}

/** Start before this row's own date constraint is applied — see startFormula,
 *  which reads this. A Summary rolls up to the earliest of its descendants
 *  (matched by WBS-text prefix); a Task/Milestone with resolvable predecessors
 *  takes the latest date any of them pushes it to (the binding one, exactly as
 *  the scheduler treats them); otherwise it falls back to the manual
 *  Start (set) column, or today.
 *
 *  `predCodes` is the row's predecessor list as it stands at export time. It is
 *  only consulted when there is more than one — a single predecessor is read
 *  live out of the Pred cell instead, so that column stays editable in the
 *  sheet. */
function baseStartFormula(row: number, lastDataRow: number, predCodes: string[]): string {
  const b = `$B$7:$B${lastDataRow}`;
  const descendants = `COUNTIF(${b},$B${row}&".*")`;
  const summary = `IF(${descendants}>0,MIN(OFFSET($M${row},1,0,${descendants},1)),TODAY())`;
  const fallback = `IF($L${row}<>"",$L${row},TODAY())`;

  let chain: string;
  if (predCodes.length > 1) {
    // N() around each turns an unresolvable predecessor into 0 rather than an
    // error that would take the whole MAX with it.
    const latest = `MAX(${predCodes
      .map((code) => `IFERROR(${predStartExpr(row, `"${code}"`, lastDataRow)},0)`)
      .join(",")})`;
    chain = `IF(${latest}=0,${fallback},${latest})`;
  } else {
    chain =
      `IF(AND($H${row}<>"",ISNUMBER(MATCH($H${row}&"",${b},0))),` +
      `${predStartExpr(row, `$H${row}`, lastDataRow)},${fallback})`;
  }

  return `IF($A${row}="","",IF($D${row}="Summary",${summary},${chain}))`;
}

/** Start: the scheduled date above, with the row's date constraint applied —
 *  the same three rules as the app's own applyConstraint. 必須完成於 pins the
 *  finish and derives the start backwards; 不得早於(開始) only ever pushes the
 *  row later; 不得晚於(完成) moves nothing at all — a deadline does not make
 *  work go faster, so it is reported (the Constraint Date cell turns red) and
 *  never silently rewrites the schedule. */
function startFormula(row: number, baseCol: string): string {
  const back = `-(MAX(N($N${row}),1)-1)`;
  return (
    `IF($A${row}="","",` +
    `IF(AND($R${row}="${CONSTRAINT_LABELS.MUST_FINISH_ON}",$S${row}<>""),` +
    `WORKDAY($S${row},${back},${HOLIDAYS_RANGE}),` +
    `IF(AND($R${row}="${CONSTRAINT_LABELS.START_NO_EARLIER_THAN}",$S${row}<>""),` +
    `MAX(${baseCol}${row},$S${row}),${baseCol}${row})))`
  );
}

/** Days: NETWORKDAYS(Start,Finish) for a Summary (excluding the Holidays
 *  sheet's dates as well as weekends), 0 for a Milestone, otherwise a plain
 *  mirror of the manual Dur input (N). */
function daysFormula(row: number): string {
  return `IF($A${row}="","",IF($D${row}="Summary",NETWORKDAYS($M${row},$P${row},${HOLIDAYS_RANGE}),IF($D${row}="Milestone",0,IF($N${row}="","",$N${row}))))`;
}

/** Finish: for a Summary, the latest of its descendants' own Finish; for a
 *  Milestone, same day as Start; otherwise Start + Dur (WORKDAY-based,
 *  skipping the Holidays sheet's dates). */
function finishFormula(row: number, lastDataRow: number): string {
  const b = `$B$7:$B${lastDataRow}`;
  return (
    `IF($A${row}="","",IF($D${row}="Summary",` +
    `MAX(OFFSET($P${row},1,0,MAX(COUNTIF(${b},$B${row}&".*"),1),1)),` +
    `IF($D${row}="Milestone",$M${row},WORKDAY($M${row},MAX(N($N${row}),1)-1,${HOLIDAYS_RANGE}))))`
  );
}

type RowMeta = {
  item: ItemData;
  wbs: string;
  lvl: number;
  hasChildren: boolean;
  type: string;
  priority: string;
  status: string;
  resource: string;
  pred: string;
  /** The same predecessors as `pred`, split out — the Start formula needs them
   *  individually once there is more than one. */
  predCodes: string[];
  link: string;
  lag: number | null;
  comment: string;
  startSet: Date | null;
  start: Date | null;
  dur: number | null;
  finish: Date | null;
  pctDone: number | null;
  /** 日期約束 — the label the sheet's dropdown offers, and its date. */
  constraint: string;
  constraintDate: Date | null;
  /** 總浮時 (working days) and whether that float is zero — 要徑. Null on a
   *  row the CPM pass left out (a Summary, or a board with no Pred column). */
  totalFloat: number | null;
  isCritical: boolean;
  extra: Record<string, string | number | Date | null>;
  /** Set only for a Summary row kept by a Lvl-depth export filter whose own
   *  children were cut — the live spreadsheet rollup formula would find no
   *  matching child rows in that case, so this static value (computed here
   *  from the full, unfiltered item tree) is written instead. */
  startOverride: Date | null;
  finishOverride: Date | null;
};

/** Builds one row per exported item, in display order, including any
 *  selected extra fields. When maxLevel is set, items deeper than it are
 *  dropped from the export — always trimming from the bottom (never
 *  creating a gap in the kept Lvl sequence) so the WBS numbering formulas
 *  stay correct; a kept Summary whose own children got trimmed this way
 *  gets its Start/Finish computed here instead, from the full tree. */
function buildRowMeta(
  board: BoardWithData,
  group: GroupData,
  extraColumns: ColumnData[],
  users: UserOption[],
  holidaySet: Set<string>,
  maxLevel: number | null
): RowMeta[] {
  const items = board.items.filter((i) => i.groupId === group.id);
  const wbsCodes = computeWbsCodes(items);
  const { ordered, childrenOf } = orderedItems(items);

  // 要徑 — the same backward pass the board's own Gantt shades red, so the
  // exported workbook marks exactly the tasks the app does.
  const linkColumnOptions = board.columns.find((c) => c.id === board.linkColumnId)?.options;
  const floats = computeCriticalPath(
    items,
    {
      predColumnId: board.predColumnId,
      linkColumnId: board.linkColumnId,
      linkColumnOptions,
      lagColumnId: board.lagColumnId,
      startColumnId: board.ganttStartColumnId,
      durationColumnId: board.ganttDurationColumnId,
      durationMode: board.ganttDurationMode,
    },
    holidaySet
  );

  const typeColumn = findColumn(board.columns, "Type");
  const priorityColumn = findColumn(board.columns, "Priority");
  const statusColumn = findColumn(board.columns, "Status");
  const resourceColumn = findColumn(board.columns, "Resource");
  const predColumn = findColumn(board.columns, "Pred");
  const linkColumn = findColumn(board.columns, "Link");
  const lagColumn = findColumn(board.columns, "Lag");
  const commentColumn = findColumn(board.columns, "Comment");

  const basics = ordered.map((item) => {
    const wbs = wbsCodes.get(item.id) ?? "";
    const hasChildren = (childrenOf.get(item.id) ?? []).length > 0;
    const type = getStatusLabel(item, typeColumn) || (hasChildren ? "Summary" : "Task");
    return { item, wbs, hasChildren, type };
  });

  /** The sheet's Pred column is WBS notation, but the cell stores the target
   *  item's id (a code is positional — see resolvePredValue), so translate on
   *  the way out. A value that is already a code is passed through, which is
   *  what an un-backfilled board or a re-export of a fresh import holds.
   *
   *  An entry may carry its own relationship and lag ("<id>:SS+2"). That part
   *  has to come off before the lookup, or the id never matches and lands in
   *  the sheet raw; where the row has a single predecessor the relationship
   *  and lag are moved into the Link/Lag columns, which is exactly what they
   *  mean and the only place the sheet can act on them. */
  function predEdges(item: ItemData): {
    codes: string[];
    relationship: string | null;
    lag: number | null;
  } {
    const raw = getRawValue(item, predColumn);
    if (typeof raw !== "string" || !raw) return { codes: [], relationship: null, lag: null };
    const parts = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => splitPredEntry(part));
    return {
      codes: parts.map((p) => wbsCodes.get(p.ref) ?? p.ref),
      // Only meaningful for a single edge — with several, the sheet has one
      // Link/Lag cell and they may disagree, so the item's own columns stand.
      relationship: parts.length === 1 ? parts[0].relationship : null,
      lag: parts.length === 1 ? parts[0].lag : null,
    };
  }

  function leafPercent(item: ItemData): number | null {
    if (!board.progressColumnId) return null;
    const cv = item.cellValues.find((c) => c.columnId === board.progressColumnId);
    return typeof cv?.value === "number" ? normalizePercent(cv.value) : null;
  }

  /** Flat average of every descendant leaf's % Done, matching the reference
   *  sheet's own RollupSummaries() (excludes nested Summary rows). */
  function rollupPercent(wbs: string): number | null {
    if (!board.progressColumnId) return null;
    const prefix = `${wbs}.`;
    let sum = 0;
    let count = 0;
    for (const b of basics) {
      if (!b.wbs.startsWith(prefix) || b.type === "Summary") continue;
      sum += leafPercent(b.item) ?? 0;
      count++;
    }
    return count > 0 ? sum / count : null;
  }

  const allRows: RowMeta[] = basics.map(({ item, wbs, hasChildren, type }) => {
    const startRaw = getRawValueByColumnId(item, board.ganttStartColumnId);
    const finishRaw = getRawValueByColumnId(item, board.ganttEndColumnId);
    const durRaw = getRawValueByColumnId(item, board.ganttDurationColumnId);
    const startSetRaw = getRawValueByColumnId(item, board.manualStartColumnId);
    const lagRaw = getRawValue(item, lagColumn);
    const edges = predEdges(item);
    const float = floats.get(item.id);

    return {
      item,
      wbs,
      lvl: wbs ? wbs.split(".").length : 1,
      hasChildren,
      type,
      priority: getStatusLabel(item, priorityColumn),
      status: getStatusLabel(item, statusColumn),
      resource: (getRawValue(item, resourceColumn) as string | null) ?? "",
      pred: edges.codes.join(","),
      predCodes: edges.codes,
      link: edges.relationship ?? getStatusLabel(item, linkColumn),
      lag: edges.lag ?? (typeof lagRaw === "number" ? lagRaw : null),
      comment: (getRawValue(item, commentColumn) as string | null) ?? "",
      startSet: parseDate(startSetRaw),
      start: parseDate(startRaw),
      dur: typeof durRaw === "number" ? durRaw : null,
      finish: parseDate(finishRaw),
      pctDone: hasChildren ? rollupPercent(wbs) : leafPercent(item),
      constraint: item.constraintType ? CONSTRAINT_LABELS[item.constraintType] : "",
      constraintDate: parseDate(item.constraintDate),
      totalFloat: float?.totalFloat ?? null,
      isCritical: float?.isCritical ?? false,
      extra: Object.fromEntries(extraColumns.map((c) => [c.id, resolveExtraValue(item, c, users)])),
      startOverride: null,
      finishOverride: null,
    };
  });

  if (maxLevel == null) return allRows;

  const kept = allRows.filter((r) => r.lvl <= maxLevel);
  if (board.ganttStartColumnId && board.ganttDurationColumnId) {
    for (const r of kept) {
      if (!r.hasChildren || r.lvl !== maxLevel) continue;
      const rolled = computeRolledUpDateRange(
        r.item,
        items,
        board.ganttStartColumnId,
        board.ganttDurationColumnId,
        board.ganttDurationMode,
        holidaySet,
        { predColumnId: board.predColumnId }
      );
      if (rolled) {
        r.startOverride = rolled.start;
        r.finishOverride = rolled.end;
      }
    }
  }
  return kept;
}

// All timeline date math below uses UTC components exclusively. DATE
// columns are stored as "yyyy-mm-dd" strings, which `new Date(...)` parses
// as UTC midnight per the ECMAScript date-only string spec — mixing that
// with local getDate()/setDate() (as this file briefly did) can shift the
// displayed calendar day depending on the server's timezone.
function utcMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day));
}

function addUtcDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 86_400_000);
}

function addUtcMonths(d: Date, months: number): Date {
  return utcMidnight(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

function firstOfUtcMonth(d: Date): Date {
  return utcMidnight(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function lastOfUtcMonth(d: Date): Date {
  return utcMidnight(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
}

function mondayOf(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = day === 0 ? -6 : 1 - day;
  return addUtcDays(d, diff);
}

/** [start, end] the timeline needs to cover: the data's own date range,
 *  padded so near-term slippage and "today" both stay visible. */
function computeDateRange(rows: RowMeta[]): { start: Date; end: Date } {
  const now = new Date();
  const today = utcMidnight(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let start = today;
  let end = today;
  for (const r of rows) {
    if (r.start && r.start < start) start = r.start;
    if (r.finish && r.finish > end) end = r.finish;
  }
  return { start: addUtcDays(start, -7), end: addUtcDays(end, 60) };
}

function writeBanner(sheet: ExcelJS.Worksheet, title: string, instructions: string, headers: string[]) {
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A3").value = instructions;
  sheet.getCell("A3").font = { italic: true, color: { argb: "FF666666" } };
  const lastCol = colLetter(headers.length);
  sheet.mergeCells(`A5:${lastCol}5`);
  sheet.getCell("A5").value = "TASK DETAILS";
  sheet.getCell("A5").font = { bold: true };
  sheet.getCell("A5").fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFDDEBF7" },
  };

  const headerRow = sheet.getRow(6);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  headerRow.font = { bold: true };
  headers.forEach((_, i) => {
    sheet.getColumn(i + 1).width = COLUMN_WIDTHS[i] ?? DEFAULT_EXTRA_COLUMN_WIDTH;
  });
}

function applyDetailValidation(sheet: ExcelJS.Worksheet, lastRow: number, board: BoardWithData) {
  const typeOptions = getStatusOptionLabels(findColumn(board.columns, "Type"), DEFAULT_TYPE_OPTIONS);
  const priorityOptions = getStatusOptionLabels(
    findColumn(board.columns, "Priority"),
    DEFAULT_PRIORITY_OPTIONS
  );
  const statusOptions = getStatusOptionLabels(
    findColumn(board.columns, "Status"),
    DEFAULT_STATUS_OPTIONS
  );

  const lists: [number, string[]][] = [
    [4, typeOptions],
    [5, priorityOptions],
    [6, statusOptions],
    [18, Object.values(CONSTRAINT_LABELS)],
  ];
  for (const [col, options] of lists) {
    for (let row = 7; row <= lastRow; row++) {
      sheet.getCell(row, col).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [`"${options.join(",")}"`],
      };
    }
  }

  // Resource reads the Lists sheet rather than a frozen inline list, so adding
  // a person there makes them pickable everywhere without re-exporting.
  // Like the lists above it does not reject a typed value — which matters more
  // here, because the bundled Apps Script builds multi-person values
  // ("Amy, Ben") by design and a strict list would reject every one of them.
  for (let row = 7; row <= lastRow; row++) {
    sheet.getCell(row, 7).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [LISTS_MEMBER_RANGE],
    };
  }
}

function writeDetailRow(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  m: RowMeta,
  lastDataRow: number,
  detailColCount: number,
  extraColumns: ColumnData[],
  blfCol: string,
  blgCol: string
) {
  const row = sheet.getRow(rowIndex);
  row.getCell(1).value = m.lvl;
  const levelCols = [
    colLetter(detailColCount + 2),
    colLetter(detailColCount + 3),
    colLetter(detailColCount + 4),
    colLetter(detailColCount + 5),
    blfCol,
    blgCol,
  ];
  row.getCell(2).value = { formula: wbsFormula(rowIndex, levelCols) };
  row.getCell(3).value = m.item.name;
  row.getCell(4).value = m.type;
  row.getCell(5).value = m.priority;
  row.getCell(6).value = m.status;
  row.getCell(7).value = m.resource;
  row.getCell(8).value = m.pred;
  row.getCell(9).value = m.link;
  row.getCell(10).value = m.lag ?? "";
  row.getCell(11).value = m.comment;
  if (m.startSet) {
    row.getCell(12).value = m.startSet;
    row.getCell(12).numFmt = "yyyy-mm-dd";
  }
  const baseCol = colLetter(detailColCount + 6);
  row.getCell(13).value = m.startOverride ?? { formula: startFormula(rowIndex, `$${baseCol}`) };
  row.getCell(13).numFmt = "yyyy-mm-dd";
  if (m.dur !== null) {
    row.getCell(14).value = m.dur;
  }
  row.getCell(15).value = { formula: daysFormula(rowIndex) };
  row.getCell(16).value = m.finishOverride ?? { formula: finishFormula(rowIndex, lastDataRow) };
  row.getCell(16).numFmt = "yyyy-mm-dd";
  if (m.pctDone !== null) {
    row.getCell(17).value = m.pctDone;
    row.getCell(17).numFmt = "0%";
  }
  row.getCell(18).value = m.constraint;
  if (m.constraintDate) {
    row.getCell(19).value = m.constraintDate;
    row.getCell(19).numFmt = "yyyy-mm-dd";
  }
  if (m.totalFloat !== null) row.getCell(20).value = m.totalFloat;
  // A mark rather than TRUE/FALSE: the column is read at a glance, and the
  // bar-colour rule keys on it.
  if (m.isCritical) row.getCell(21).value = "★";

  extraColumns.forEach((col, i) => {
    const value = m.extra[col.id];
    if (value === null || value === undefined) return;
    const cell = row.getCell(BASE_DETAIL_COL_COUNT + 1 + i);
    cell.value = value;
    if (value instanceof Date) cell.numFmt = "yyyy-mm-dd";
  });

  row.getCell(detailColCount + 1).value = { formula: typeCodeFormula(rowIndex) };
  row.getCell(detailColCount + 2).value = { formula: levelCounterFormula(rowIndex, 1) };
  row.getCell(detailColCount + 3).value = { formula: levelCounterFormula(rowIndex, 2) };
  row.getCell(detailColCount + 4).value = { formula: levelCounterFormula(rowIndex, 3) };
  row.getCell(detailColCount + 5).value = { formula: levelCounterFormula(rowIndex, 4) };
  row.getCell(detailColCount + 6).value = {
    formula: baseStartFormula(rowIndex, lastDataRow, m.predCodes),
  };
  row.getCell(detailColCount + 6).numFmt = "yyyy-mm-dd";
}

function writeMirrorRow(
  sheet: ExcelJS.Worksheet,
  rowIndex: number,
  detailColCount: number,
  extraColumns: ColumnData[]
) {
  const row = sheet.getRow(rowIndex);
  for (let col = 1; col <= detailColCount; col++) {
    const c = colLetter(col);
    row.getCell(col).value = {
      formula: `IF(INDEX('Gantt (Day)'!$${c}:$${c},ROW())="","",INDEX('Gantt (Day)'!$${c}:$${c},ROW()))`,
    };
  }
  row.getCell(13).numFmt = "yyyy-mm-dd";
  row.getCell(16).numFmt = "yyyy-mm-dd";
  row.getCell(17).numFmt = "0%";
  row.getCell(19).numFmt = "yyyy-mm-dd";
  extraColumns.forEach((col, i) => {
    if (col.type === "DATE") row.getCell(BASE_DETAIL_COL_COUNT + 1 + i).numFmt = "yyyy-mm-dd";
  });
}

/** Merged month/year label blocks on row 5 above the timeline, matching the
 *  reference sheet's own header banner (e.g. "May 2026" spanning that
 *  month's day columns on Day/Week, "2026" spanning a year's columns on
 *  Month). */
function writePeriodLabels(
  sheet: ExcelJS.Worksheet,
  colDates: { col: number; date: Date }[],
  groupBy: "month" | "year"
) {
  if (colDates.length === 0) return;
  const keyOf = (d: Date) =>
    groupBy === "year" ? d.getUTCFullYear() : d.getUTCFullYear() * 12 + d.getUTCMonth();

  let blockStart = 0;
  for (let i = 1; i <= colDates.length; i++) {
    const atEnd = i === colDates.length;
    if (atEnd || keyOf(colDates[i].date) !== keyOf(colDates[blockStart].date)) {
      const startCol = colDates[blockStart].col;
      const endCol = colDates[i - 1].col;
      const cell = sheet.getCell(5, startCol);
      cell.value = colDates[blockStart].date;
      cell.numFmt = groupBy === "year" ? "yyyy" : "mmm yyyy";
      cell.font = { bold: true };
      cell.alignment = { horizontal: "center" };
      if (endCol > startCol) sheet.mergeCells(5, startCol, 5, endCol);
      blockStart = i;
    }
  }
}

/** Bar/level-colour/today-marker conditional formatting, identical formulas
 *  across Day/Week/Month since all three share the same detail-column
 *  layout — Week/Month's cells resolve through their own INDEX-formula
 *  mirrors. */
function applyConditionalFormatting(
  sheet: ExcelJS.Worksheet,
  tlStartCol: number,
  tlEndCol: number,
  lastDataRow: number,
  levelColors: string[],
  isDaySheet: boolean,
  detailColCount: number
) {
  const startLetter = colLetter(tlStartCol);
  const endLetter = colLetter(tlEndCol);
  const barRef = `${startLetter}7:${endLetter}${lastDataRow}`;

  sheet.addConditionalFormatting({
    ref: barRef,
    rules: [
      {
        type: "expression",
        priority: 1,
        formulae: [`AND($M7<=${startLetter}$4,$P7>=${startLetter}$6,$D7="Milestone")`],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: BAR_COLORS.milestone } } },
      },
      {
        type: "expression",
        priority: 2,
        formulae: [
          `AND($M7<=${startLetter}$4,$P7>=${startLetter}$6,$D7<>"Milestone",$Q7>0,${startLetter}$6<=$M7+$Q7*($P7-$M7))`,
        ],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: BAR_COLORS.completed } } },
      },
      // 要徑 outranks the ordinary Task/Summary colours but not "completed":
      // a critical task that is already done is not the thing to look at.
      {
        type: "expression",
        priority: 3,
        formulae: [`AND($M7<=${startLetter}$4,$P7>=${startLetter}$6,$U7="★")`],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: BAR_COLORS.critical } } },
      },
      {
        type: "expression",
        priority: 4,
        formulae: [`AND($M7<=${startLetter}$4,$P7>=${startLetter}$6,$D7="Summary")`],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: BAR_COLORS.summary } } },
      },
      {
        type: "expression",
        priority: 5,
        formulae: [`AND($M7<=${startLetter}$4,$P7>=${startLetter}$6,$D7="Task")`],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: BAR_COLORS.task } } },
      },
      // The dependency link: the run of cells between the predecessor's finish
      // and this row's own start, tinted so the gap reads as a connector
      // rather than as empty space. A spreadsheet cannot draw a real arrow —
      // .xlsx has no way to express one — so the lag itself is what gets
      // drawn, which is the part worth seeing anyway.
      {
        type: "expression",
        priority: 6,
        formulae: [
          `AND($H7<>"",ISNUMBER(MATCH($H7&"",$B$7:$B$${lastDataRow},0)),` +
            `${startLetter}$6>INDEX($P$7:$P$${lastDataRow},MATCH($H7&"",$B$7:$B$${lastDataRow},0)),` +
            `${startLetter}$6<$M7)`,
        ],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: LINK_COLOR } } },
      },
    ],
  });

  // …and a hard left edge on the driven bar's first cell, so an FS link with
  // no lag — where there are no gap cells to tint — still shows that this bar
  // is held in place by something upstream.
  sheet.addConditionalFormatting({
    ref: barRef,
    rules: [
      {
        type: "expression",
        priority: 7,
        formulae: [
          `AND($H7<>"",ISNUMBER(MATCH($H7&"",$B$7:$B$${lastDataRow},0)),${startLetter}$6=$M7)`,
        ],
        style: { border: { left: { style: "medium", color: { argb: LINK_EDGE_COLOR } } } },
      },
    ],
  });

  // Today marker + level-colour row highlighting reuse the same $A7=N
  // pattern the reference sheet's ApplyLevelColours() rewrites in place.
  const todayFormula = isDaySheet
    ? `${startLetter}$6=TODAY()`
    : `AND(${startLetter}$6<=TODAY(),${startLetter}$4>=TODAY())`;
  sheet.addConditionalFormatting({
    ref: barRef,
    rules: [
      {
        type: "expression",
        priority: 8,
        formulae: [todayFormula],
        style: { fill: { type: "pattern", pattern: "solid", fgColor: { argb: TODAY_COLOR } } },
      },
    ],
  });

  // 不得晚於(完成) never moves the schedule — it reports. This is the report:
  // the deadline turns red the moment the work runs past it.
  sheet.addConditionalFormatting({
    ref: `R7:S${lastDataRow}`,
    rules: [
      {
        type: "expression",
        priority: 9,
        formulae: [
          `AND($R7="${CONSTRAINT_LABELS.FINISH_NO_LATER_THAN}",$S7<>"",$P7>$S7)`,
        ],
        style: {
          font: { bold: true, color: { argb: "FFFFFFFF" } },
          fill: { type: "pattern", pattern: "solid", fgColor: { argb: BAR_COLORS.critical } },
        },
      },
    ],
  });

  const detailRef = `A7:${colLetter(detailColCount)}${lastDataRow}`;
  sheet.addConditionalFormatting({
    ref: detailRef,
    rules: levelColors.slice(0, 6).map((color, i) => ({
      type: "expression" as const,
      priority: 10 + i,
      formulae: [`$A7=${i + 1}`],
      style: { fill: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${color.replace("#", "").toUpperCase()}` } } },
    })),
  });
}

function buildDaySheet(
  workbook: ExcelJS.Workbook,
  board: BoardWithData,
  group: GroupData,
  rows: RowMeta[],
  range: { start: Date; end: Date },
  levelColors: string[],
  headers: string[],
  detailColCount: number,
  extraColumns: ColumnData[]
): number {
  const sheet = workbook.addWorksheet("Gantt (Day)");
  writeBanner(
    sheet,
    `${board.name} - ${group.name}`,
    "EDIT blue cells. Type dropdown: Summary rolls up its children. No Start set -> today.",
    headers
  );

  const lastDataRow = Math.max(7, 6 + rows.length);

  // Timeline first — its width (and so the two far-right WBS level-5/6
  // helper columns' position, right after it) doesn't depend on row
  // content, only on the date range.
  const tl0 = timelineStartCol(detailColCount);
  let col = tl0;
  let cursor = range.start;
  const colDates: { col: number; date: Date }[] = [];
  while (cursor <= range.end) {
    sheet.getCell(4, col).value = cursor;
    sheet.getCell(4, col).numFmt = "yyyy-mm-dd";
    sheet.getRow(4).hidden = true;
    sheet.getCell(6, col).value = cursor;
    sheet.getCell(6, col).numFmt = "d";
    sheet.getColumn(col).width = 3;
    colDates.push({ col, date: cursor });
    cursor = addUtcDays(cursor, 1);
    col++;
  }
  const tlEnd = col - 1;
  const blfColNum = tlEnd + 1;
  const blgColNum = tlEnd + 2;
  const blfCol = colLetter(blfColNum);
  const blgCol = colLetter(blgColNum);
  writePeriodLabels(sheet, colDates, "month");

  rows.forEach((m, i) => {
    const rowIndex = 7 + i;
    writeDetailRow(sheet, rowIndex, m, lastDataRow, detailColCount, extraColumns, blfCol, blgCol);
    sheet.getCell(rowIndex, blfColNum).value = { formula: levelCounterFormula(rowIndex, 5) };
    sheet.getCell(rowIndex, blgColNum).value = { formula: levelCounterFormula(rowIndex, 6) };
  });
  applyDetailValidation(sheet, lastDataRow, board);

  // Type-code + level 1-4 counters and the level 5-6 counters past the
  // timeline are working columns for the WBS formula, not meant to be read
  // directly.
  for (let c = detailColCount + 1; c <= detailColCount + HELPER_PREFIX_COUNT; c++) {
    sheet.getColumn(c).hidden = true;
  }
  sheet.getColumn(blfColNum).hidden = true;
  sheet.getColumn(blgColNum).hidden = true;

  applyConditionalFormatting(sheet, tl0, tlEnd, lastDataRow, levelColors, true, detailColCount);
  sheet.autoFilter = `A6:${colLetter(detailColCount)}${lastDataRow}`;
  sheet.views = [{ state: "frozen", xSplit: detailColCount, ySplit: 6 }];

  return lastDataRow;
}

function buildMirrorSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  board: BoardWithData,
  group: GroupData,
  rowCount: number,
  range: { start: Date; end: Date },
  levelColors: string[],
  granularity: "week" | "month",
  headers: string[],
  detailColCount: number,
  extraColumns: ColumnData[]
) {
  const sheet = workbook.addWorksheet(name);
  writeBanner(
    sheet,
    `${board.name} - ${group.name}`,
    `View only - edit on 'Gantt (Day)'. Scale: ${granularity === "week" ? "Week" : "Month"}.`,
    headers
  );

  const lastDataRow = Math.max(7, 6 + rowCount);
  for (let r = 7; r <= lastDataRow; r++) writeMirrorRow(sheet, r, detailColCount, extraColumns);

  const tl0 = detailColCount + 1;
  let col = tl0;
  const colDates: { col: number; date: Date }[] = [];
  if (granularity === "week") {
    let cursor = mondayOf(range.start);
    while (cursor <= range.end) {
      const periodEnd = addUtcDays(cursor, 6);
      sheet.getCell(4, col).value = periodEnd;
      sheet.getCell(4, col).numFmt = "yyyy-mm-dd";
      sheet.getRow(4).hidden = true;
      sheet.getCell(6, col).value = cursor;
      sheet.getCell(6, col).numFmt = "m/d";
      sheet.getColumn(col).width = 6;
      colDates.push({ col, date: cursor });
      cursor = addUtcDays(cursor, 7);
      col++;
    }
  } else {
    let cursor = addUtcMonths(firstOfUtcMonth(range.start), -1);
    while (cursor <= range.end) {
      const periodEnd = lastOfUtcMonth(cursor);
      sheet.getCell(4, col).value = periodEnd;
      sheet.getCell(4, col).numFmt = "yyyy-mm-dd";
      sheet.getRow(4).hidden = true;
      sheet.getCell(6, col).value = cursor;
      sheet.getCell(6, col).numFmt = "mmm";
      sheet.getColumn(col).width = 6;
      colDates.push({ col, date: cursor });
      cursor = addUtcMonths(cursor, 1);
      col++;
    }
  }
  const tlEnd = Math.max(tl0, col - 1);
  writePeriodLabels(sheet, colDates, granularity === "week" ? "month" : "year");

  applyConditionalFormatting(sheet, tl0, tlEnd, lastDataRow, levelColors, false, detailColCount);
  sheet.autoFilter = `A6:${colLetter(detailColCount)}${lastDataRow}`;
  sheet.views = [{ state: "frozen", xSplit: detailColCount, ySplit: 6 }];
}

function buildSettingsSheet(workbook: ExcelJS.Workbook, levelColors: string[]) {
  const sheet = workbook.addWorksheet("Settings");
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 12;
  sheet.getCell("A1").value = "Level colours";
  sheet.getCell("A1").font = { bold: true };
  sheet.getCell("A3").value = "Level";
  sheet.getCell("B3").value = "Colour";
  sheet.getRow(3).font = { bold: true };

  const colors = levelColors.length === 6 ? levelColors : DEFAULT_LEVEL_COLORS;
  for (let i = 0; i < 6; i++) {
    sheet.getCell(4 + i, 1).value = `Level ${i + 1}`;
    sheet.getCell(4 + i, 2).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${colors[i].replace("#", "").toUpperCase()}` },
    };
  }
  sheet.getCell("A11").value =
    "顏色來自看板的「階層顏色」設定；要調整請改用看板工具列的階層顏色,或直接編輯上方 Conditional Format 規則。";
  sheet.getCell("A11").font = { italic: true, color: { argb: "FF999999" } };
}

/** The roster the Resource dropdown on every Gantt sheet reads (see
 *  LISTS_MEMBER_RANGE). Everyone the app knows about goes in, not just the
 *  names already used on this group's rows — the whole point of the dropdown
 *  is to assign somebody who is not on the board yet. */
function buildListsSheet(workbook: ExcelJS.Workbook, rows: RowMeta[], users: UserOption[]) {
  const sheet = workbook.addWorksheet("Lists");
  sheet.getColumn(1).width = 28;
  sheet.getCell("A1").value = "Members (add rows below; appear in Resource dropdown)";
  sheet.getCell("A1").font = { bold: true };

  const names = new Set<string>(users.map((u) => u.name).filter(Boolean));
  // Anything already written on a row stays selectable even if that person has
  // since left — otherwise the existing value reads as invalid.
  for (const r of rows) {
    for (const part of r.resource.split(",")) {
      const trimmed = part.trim();
      if (trimmed) names.add(trimmed);
    }
  }
  [...names].sort().forEach((name, i) => {
    sheet.getCell(2 + i, 1).value = name;
  });
}

/** Seeds the workbook's own Holidays sheet from the app's company-wide
 *  holiday list — the Start/Days/Finish formulas on every Gantt sheet
 *  reference this sheet's date column (see HOLIDAYS_RANGE) so business-day
 *  math keeps skipping these dates even after the file leaves the app,
 *  and editing/adding rows here (within the reserved range) recalculates
 *  those formulas live. */
function buildHolidaysSheet(workbook: ExcelJS.Workbook, holidays: { date: string; name: string }[]) {
  const sheet = workbook.addWorksheet("Holidays");
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 24;
  sheet.getCell("A1").value = "國定假日 (Holidays)";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A3").value =
    "在下方新增/修改/刪除日期(最多 1000 筆),Gantt 各分頁的 Start/Days/Finish 公式會自動避開這些日期,不會排入工作天。";
  sheet.getCell("A3").font = { italic: true, color: { argb: "FF666666" } };
  sheet.getCell("A5").value = "Date";
  sheet.getCell("B5").value = "Name";
  sheet.getRow(5).font = { bold: true };

  holidays.forEach((h, i) => {
    const row = 6 + i;
    const date = parseDate(h.date);
    const cell = sheet.getCell(row, 1);
    cell.value = date ?? h.date;
    if (date) cell.numFmt = "yyyy-mm-dd";
    sheet.getCell(row, 2).value = h.name;
  });
}

const MONEY_FMT = "#,##0";

function sectionTitle(sheet: ExcelJS.Worksheet, row: number, text: string) {
  const cell = sheet.getCell(row, 1);
  cell.value = text;
  cell.font = { bold: true, size: 12 };
}

function headerRow(sheet: ExcelJS.Worksheet, row: number, labels: string[]) {
  labels.forEach((label, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = label;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
  });
}

/**
 * 專案預算 — 核准了多少、花掉多少、已下單多少、還剩多少,每個核准範圍一塊。
 *
 * Static figures, not formulas: unlike the schedule, a budget is not something
 * anyone should re-derive by editing a cell here. The ledger lives in the app;
 * this is the statement of it.
 */
function buildBudgetSheet(workbook: ExcelJS.Workbook, scopes: BudgetScopeExport[]) {
  const sheet = workbook.addWorksheet("預算 (Budget)");
  [28, 16, 16, 16, 16, 12].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  sheet.getCell("A1").value = "專案預算";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value =
    "數字來自 App 的預算管控頁,與該頁一致。人力實際成本來自已核准的工時,不是手動記帳。";
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  if (scopes.length === 0) {
    sheet.getCell("A4").value = "這個看板底下還沒有核准任何預算。";
    return;
  }

  let row = 4;
  for (const scope of scopes) {
    sectionTitle(sheet, row, `${scope.kind}:${scope.name}　—　${scope.alert}`);
    row += 1;

    headerRow(sheet, row, ["類別", "核准預算", "實際支出", "已下單未入帳", "剩餘", "已用 %"]);
    row += 1;

    const writeLine = (line: BudgetLine, bold: boolean) => {
      sheet.getCell(row, 1).value = line.label;
      ([line.budget, line.actual, line.committed, line.remaining] as number[]).forEach((n, i) => {
        const cell = sheet.getCell(row, i + 2);
        cell.value = n;
        cell.numFmt = MONEY_FMT;
      });
      const pct = sheet.getCell(row, 6);
      pct.value = line.usedPct === null ? "—" : line.usedPct / 100;
      if (line.usedPct !== null) pct.numFmt = "0%";
      if (bold) sheet.getRow(row).font = { bold: true };
      // 剩餘 is the cell people look for; red when the money is already spent.
      if (line.remaining < 0) {
        sheet.getCell(row, 5).font = { bold: true, color: { argb: "FFC0392B" } };
      }
      row += 1;
    };

    for (const line of scope.lines) writeLine(line, false);
    writeLine(scope.total, true);
    row += 1;

    if (scope.reserves.length > 0) {
      headerRow(sheet, row, ["準備金", "核准額度", "已動支", "可動支餘額"]);
      row += 1;
      for (const reserve of scope.reserves) {
        sheet.getCell(row, 1).value = reserve.label;
        [reserve.approved, reserve.drawn, reserve.remaining].forEach((n, i) => {
          const cell = sheet.getCell(row, i + 2);
          cell.value = n;
          cell.numFmt = MONEY_FMT;
        });
        row += 1;
      }
      row += 1;
    }

    headerRow(sheet, row, ["預估完工成本 (EAC)", "金額"]);
    row += 1;
    const forecastRows: [string, number | null][] = [
      ["已投入(已花費 + 已承諾)", scope.engaged],
      ["人力實際成本(已核准工時)", scope.labourActual],
      ["照目前效率的完工成本", scope.eacAtCurrentRate],
      ["剩餘照原預算的完工成本", scope.eacRemainingAtPlan],
      ["對核准預算的差異(負值 = 預計超支)", scope.varianceAtCompletion],
    ];
    for (const [label, value] of forecastRows) {
      sheet.getCell(row, 1).value = label;
      const cell = sheet.getCell(row, 2);
      cell.value = value === null ? "—" : Math.round(value);
      if (value !== null) cell.numFmt = MONEY_FMT;
      if (value !== null && value < 0) cell.font = { bold: true, color: { argb: "FFC0392B" } };
      row += 1;
    }
    sheet.getCell(row, 1).value = "完成比例(依工期加權)";
    const done = sheet.getCell(row, 2);
    done.value = scope.fractionDone === null ? "—" : scope.fractionDone;
    if (scope.fractionDone !== null) done.numFmt = "0%";
    row += 3;
  }
}

type BudgetLine = BudgetScopeExport["total"];

/**
 * 燃盡圖 — 計畫 vs 實際 vs 含已下單,逐週累積。
 *
 * The committed line is the one that matters: it crosses the budget before the
 * money is actually spent, which is the only point at which anything can still
 * be done about it. The 剩餘預算 column is what "burn-down" literally means —
 * how much is left, week by week, until it hits zero.
 */
function buildBurndownSheet(workbook: ExcelJS.Workbook, scopes: BudgetScopeExport[]) {
  const sheet = workbook.addWorksheet("燃盡圖 (Burn-down)");
  [14, 16, 16, 16, 16, 30].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  sheet.getCell("A1").value = "預算燃盡";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value =
    "在 Google 試算表可用「Gantt → 產生燃盡圖」直接畫成折線圖;在 Excel 選取表格後「插入 → 折線圖」即可。";
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  const withPoints = scopes.filter((s) => s.points.length > 0);
  if (withPoints.length === 0) {
    sheet.getCell("A4").value = "還沒有支出或訂單,畫不出燃盡曲線。";
    return;
  }

  let row = 4;
  for (const scope of withPoints) {
    sectionTitle(sheet, row, `${scope.kind}:${scope.name}(核准 ${scope.total.budget.toLocaleString()})`);
    row += 1;
    headerRow(sheet, row, [
      "週結束日",
      "計畫累積",
      "實際累積",
      "實際 + 已下單",
      "剩餘預算",
      "已用比例",
    ]);
    row += 1;

    const budget = scope.total.budget;
    for (const point of scope.points) {
      sheet.getCell(row, 1).value = new Date(point.iso);
      sheet.getCell(row, 1).numFmt = "yyyy-mm-dd";
      const values: (number | null)[] = [
        point.planned === null ? null : Math.round(point.planned),
        point.actual === null ? null : Math.round(point.actual),
        Math.round(point.committed),
        budget > 0 ? Math.round(budget - point.committed) : null,
      ];
      values.forEach((value, i) => {
        const cell = sheet.getCell(row, i + 2);
        // Left genuinely empty, not zero: a chart should break the line where
        // there is no data, not draw it along the floor.
        if (value === null) return;
        cell.value = value;
        cell.numFmt = MONEY_FMT;
        if (i === 3 && value < 0) cell.font = { bold: true, color: { argb: "FFC0392B" } };
      });
      // A bar that needs no chart — 20 blocks is the full approved budget.
      if (budget > 0) {
        sheet.getCell(row, 6).value = {
          formula: `IF($D${row}="","",REPT("█",MIN(20,ROUND($D${row}/${budget}*20,0)))&" "&TEXT($D${row}/${budget},"0%"))`,
        };
      }
      row += 1;
    }
    row += 2;
  }
}

/**
 * 延遲追因 — 誰把時程拖掉的。
 *
 * Only the tasks that slipped further than the chain pushed them. Everything
 * else on a late project is late too, and none of it is to blame: listing all
 * of it is how a delay report becomes something nobody reads.
 */
function buildDelaySheet(workbook: ExcelJS.Workbook, delay: DelayExport) {
  const sheet = workbook.addWorksheet("延遲追因 (Delay)");
  [12, 40, 12, 12, 12, 12, 12, 14].forEach((w, i) => (sheet.getColumn(i + 1).width = w));

  sheet.getCell("A1").value = "延遲追因";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A2").value =
    "與基準線比對。「自己的延遲」才是戰犯——其餘工作項只是被前置推的。";
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF666666" } };

  if (delay.noBaseline) {
    sheet.getCell("A4").value = "還沒有建立基準線,沒有可以比對的計畫。";
    return;
  }

  sheet.getCell("A4").value = "專案最大延遲(日曆天)";
  sheet.getCell("B4").value = delay.projectDelay;
  sheet.getCell("B4").font = {
    bold: true,
    color: { argb: delay.projectDelay > 0 ? "FFC0392B" : "FF27AE60" },
  };

  if (delay.culprits.length === 0) {
    sheet.getCell("A6").value = "沒有工作項自己造成延遲。";
    return;
  }

  headerRow(sheet, 6, [
    "WBS",
    "工作項",
    "開始延遲",
    "完成延遲",
    "工期增加",
    "繼承的延遲",
    "自己的延遲",
    "往下拖累幾項",
  ]);
  delay.culprits.forEach((culprit, i) => {
    const row = 7 + i;
    sheet.getCell(row, 1).value = culprit.wbsCode;
    sheet.getCell(row, 2).value = culprit.name;
    sheet.getCell(row, 3).value = culprit.startDelta;
    sheet.getCell(row, 4).value = culprit.endDelta;
    sheet.getCell(row, 5).value = culprit.daysDelta;
    sheet.getCell(row, 6).value = culprit.inheritedDelay;
    const own = sheet.getCell(row, 7);
    own.value = culprit.ownDelay;
    own.font = { bold: true, color: { argb: "FFC0392B" } };
    sheet.getCell(row, 8).value = culprit.downstreamCount;
  });
  sheet.autoFilter = `A6:H${6 + delay.culprits.length}`;
}

export type GanttExportOptions = {
  /** Board column ids beyond the fixed template to include, e.g. custom
   *  PERSON columns like 負責人/測試工具. */
  extraColumnIds?: string[];
  /** Only export items at this Lvl depth or shallower; null/undefined
   *  exports the full hierarchy (unchanged default behaviour). */
  maxLevel?: number | null;
  /** Users + Resources, for resolving PERSON-type extra fields to names. */
  users?: UserOption[];
  /** Company-wide holiday list, seeded into the workbook's own Holidays
   *  sheet and referenced by the Start/Days/Finish formulas. */
  holidays?: { date: string; name: string }[];
  /** 每個核准範圍的預算與燃盡曲線 — one 預算 sheet section and one 燃盡圖
   *  section each. Empty when nothing has a budget. */
  budgets?: BudgetScopeExport[];
  /** 延遲追因. Omitted when the caller has no baseline to compare against. */
  delay?: DelayExport;
};

/**
 * Builds a full workbook (Settings / Lists / Holidays / Gantt Day / Week /
 * Month) matching the reference Google Sheet's own layout and conditional
 * formatting, so it can be opened directly as a Google Sheet ("Open with
 * Google Sheets") rather than pasted piecemeal into an existing one.
 */
export async function buildGanttWorkbook(
  board: BoardWithData,
  group: GroupData,
  options: GanttExportOptions = {}
): Promise<Buffer> {
  const users = options.users ?? [];
  const holidays = options.holidays ?? [];
  const holidaySet = toHolidaySet(holidays);
  const maxLevel = options.maxLevel ?? null;

  const selectedIds = new Set(options.extraColumnIds ?? []);
  const extraColumns = board.columns.filter((c) => selectedIds.has(c.id));
  const headers = [...BASE_DETAIL_HEADERS, ...extraColumns.map((c) => c.name)];
  const detailColCount = headers.length;

  const rows = buildRowMeta(board, group, extraColumns, users, holidaySet, maxLevel);
  const range = computeDateRange(rows);
  const levelColors = board.levelColors.length === 6 ? board.levelColors : DEFAULT_LEVEL_COLORS;

  const workbook = new ExcelJS.Workbook();
  buildSettingsSheet(workbook, levelColors);
  buildListsSheet(workbook, rows, users);
  buildHolidaysSheet(workbook, holidays);
  buildDaySheet(workbook, board, group, rows, range, levelColors, headers, detailColCount, extraColumns);
  buildMirrorSheet(
    workbook,
    "Gantt (Week)",
    board,
    group,
    rows.length,
    range,
    levelColors,
    "week",
    headers,
    detailColCount,
    extraColumns
  );
  buildMirrorSheet(
    workbook,
    "Gantt (Month)",
    board,
    group,
    rows.length,
    range,
    levelColors,
    "month",
    headers,
    detailColCount,
    extraColumns
  );
  buildBudgetSheet(workbook, options.budgets ?? []);
  buildBurndownSheet(workbook, options.budgets ?? []);
  buildDelaySheet(workbook, options.delay ?? { projectDelay: 0, noBaseline: true, culprits: [] });

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
