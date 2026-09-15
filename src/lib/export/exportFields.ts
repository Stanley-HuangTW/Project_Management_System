import type { BoardWithData, ColumnData } from "@/types/board";

/** The fixed Gantt export template's own column headers (kept here, not in
 *  ganttWorkbookExport.ts, so this stays importable from a "use client"
 *  component without pulling exceljs into the client bundle). */
export const BASE_DETAIL_HEADERS = [
  "Lvl",
  "WBS",
  "Task Name",
  "Type",
  "Priority",
  "Status",
  "Resource",
  "Pred",
  "Link",
  "Lag",
  "Comment",
  "Start (set)",
  "Start",
  "Dur",
  "Days",
  "Finish",
  "% Done",
  "Constraint",
  "Constraint Date",
  "Float",
  "Critical",
];

/** Column names already claimed by the fixed Gantt export template —
 *  offering these again as "extra fields" would just duplicate what the
 *  export already writes under a different header. */
const RESERVED_COLUMN_NAMES = new Set(BASE_DETAIL_HEADERS.map((n) => n.toLowerCase()));

function getReservedColumnIds(board: BoardWithData): Set<string> {
  const reserved = new Set<string>();
  for (const c of board.columns) {
    if (RESERVED_COLUMN_NAMES.has(c.name.trim().toLowerCase())) reserved.add(c.id);
  }
  for (const id of [
    board.progressColumnId,
    board.ganttStartColumnId,
    board.ganttDurationColumnId,
    board.ganttEndColumnId,
    board.manualStartColumnId,
    board.manualDurationColumnId,
  ]) {
    if (id) reserved.add(id);
  }
  return reserved;
}

/** Columns not already part of the fixed Gantt export template — offered to
 *  the user in the export modal as optional extra fields (e.g. a board's own
 *  custom 負責人/測試工具 PERSON columns). */
export function getExtraExportColumns(board: BoardWithData): ColumnData[] {
  const reserved = getReservedColumnIds(board);
  return board.columns.filter((c) => !reserved.has(c.id));
}
