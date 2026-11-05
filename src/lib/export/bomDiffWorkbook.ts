import ExcelJS from "exceljs";
import { DIFF_STATUS_LABELS, type BomDiff, type BomDiffRow } from "@/lib/bomDiff";

/**
 * 兩份 BOM 的差異報表(Excel)。給人看的,不是匯入用的檔案——匯入請用「匯出 Excel」那份。
 *
 * 只列有變動的列,以及它們的上層(讓人看得出在哪個子集底下);完全沒變的列不列。
 * 小計都是台幣,跟畫面一致;差額 = 對象 − 基準,正的是變貴。
 */

export type BomDiffWorkbookInput = {
  boardName: string;
  /** 例如「M-100 / EVT」。 */
  baseLabel: string;
  targetLabel: string;
  diff: BomDiff;
};

export const DIFF_SHEET_NAME = "BOM 差異";

const HEADERS = ["狀態", "階層", "名稱", "型號/料號", "變動內容", "基準小計(台幣)", "對象小計(台幣)", "差額(台幣)"];

const FILL: Record<BomDiffRow["status"], string | null> = {
  added: "FFE3F4E1",
  removed: "FFFBE3E1",
  changed: "FFFFF3CD",
  same: null,
};

/** 一列的變動內容,一項一行:「單價:95 TWD → 120 TWD」。 */
export function changeText(row: Pick<BomDiffRow, "changes">): string {
  return row.changes.map((c) => `${c.label}:${c.before} → ${c.after}`).join("\n");
}

export async function buildBomDiffWorkbook(input: BomDiffWorkbookInput): Promise<Buffer> {
  const { diff } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "工作管理平台";
  wb.created = new Date();
  const ws = wb.addWorksheet(DIFF_SHEET_NAME);

  [10, 6, 28, 18, 46, 16, 16, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  const delta = Math.round((diff.targetUnitCostTwd - diff.baseUnitCostTwd) * 100) / 100;
  const percent = diff.baseUnitCostTwd === 0 ? null : (delta / diff.baseUnitCostTwd) * 100;
  const summary: [string, string | number][] = [
    ["看板", input.boardName],
    ["基準", input.baseLabel],
    ["對象", input.targetLabel],
    ["單台成本(台幣)", `${diff.baseUnitCostTwd} → ${diff.targetUnitCostTwd}(差額 ${delta > 0 ? "+" : ""}${delta}${percent === null ? "" : `,${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`})`],
    ["變動", `新增 ${diff.counts.added}、移除 ${diff.counts.removed}、修改 ${diff.counts.changed}`],
  ];
  let r = 1;
  for (const [label, value] of summary) {
    ws.getCell(r, 1).value = label;
    ws.getCell(r, 1).font = { bold: true };
    ws.getCell(r, 2).value = value;
    r++;
  }
  r++;

  const header = ws.getRow(r);
  header.values = HEADERS;
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
  });
  ws.views = [{ state: "frozen", ySplit: r }];
  r++;

  const shown = diff.rows.filter((row) => row.dirty);
  if (shown.length === 0) {
    ws.getCell(r, 1).value = "兩份 BOM 沒有差異。";
    r++;
  }
  for (const row of shown) {
    const line = ws.getRow(r);
    line.getCell(1).value = DIFF_STATUS_LABELS[row.status];
    line.getCell(2).value = row.depth;
    line.getCell(3).value = row.name;
    line.getCell(4).value = row.partNumber;
    line.getCell(5).value = changeText(row);
    line.getCell(5).alignment = { wrapText: true, vertical: "top" };
    if (row.beforeTotalTwd !== null) line.getCell(6).value = row.beforeTotalTwd;
    if (row.afterTotalTwd !== null) line.getCell(7).value = row.afterTotalTwd;
    line.getCell(8).value = Math.round(((row.afterTotalTwd ?? 0) - (row.beforeTotalTwd ?? 0)) * 100) / 100;
    for (const col of [6, 7, 8]) line.getCell(col).numFmt = "#,##0.00";
    const argb = FILL[row.status];
    if (argb) {
      line.eachCell({ includeEmpty: true }, (cell, col) => {
        if (col <= HEADERS.length) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
      });
    }
    r++;
  }

  // exceljs 帶著自己那份舊的 @types/node,型別上的 Buffer 跟專案的對不起來;
  // 執行期拿到的是真的 Buffer。
  // @ts-expect-error - see comment above
  return (await wb.xlsx.writeBuffer()) as Buffer;
}
