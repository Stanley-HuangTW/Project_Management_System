import { prisma } from "@/lib/prisma";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { initialColumnValues, isCustomColumn, resolveBomColumns, type BomCellValue, type BomColumnDef } from "@/lib/bomColumns";

/**
 * BOM 欄位設定在伺服器端用的小工具,BOM 的幾支 server action(畫面編輯、貼上、Excel 匯入匯出)共用。
 * 不在 "use server" 檔案裡:那裡面的匯出都會變成對外的 Server Action,必須是 async。
 */

/** 這個看板現在實際用的欄位(看板自己的 → 系統預設 → 內建)。 */
export async function loadBomColumns(boardId: string): Promise<BomColumnDef[]> {
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { bomColumns: true } });
  return resolveBomColumns(board?.bomColumns, (await getSystemSettings()).bomDefaultColumns).columns;
}

/** 資料庫裡的 BomLine.extra 讀成一般物件(格式不對就當沒有)。 */
export function asExtra(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

/** 自訂欄位的預設值(新增一列時自動帶,沒有預設值的欄位不放)。 */
export function customDefaults(columns: BomColumnDef[]): Record<string, BomCellValue> {
  const initial = initialColumnValues(columns);
  return Object.fromEntries(columns.filter(isCustomColumn).flatMap((c) => (c.id in initial ? [[c.id, initial[c.id]]] : [])));
}

/** 要存的自訂欄位的值:沒填的(null、沒勾的勾選)不存,讀出來沒有就是沒填。 */
export function compactExtra(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined && v !== false));
}
