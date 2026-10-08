"use server";

import { requireSession } from "@/lib/session";
import type { CellValueJson } from "@/types/column";
import { upsertCellValue } from "./cell";
import { createItem } from "./item";

/**
 * 貼上(Ctrl+V)進表格的兩個動作。
 *
 * 每一格都走 upsertCellValue、每一個項目都走 createItem——跟一格一格手動改完全同一條路,
 * 權限、排程鎖定、摘要時間窗、連動排程、通知、自動化規則、活動紀錄都照原本的規則,不另寫一份。
 * 一格失敗(沒權限、被鎖、值不合規則)只記下那一格,不會中斷其他格。
 *
 * 伺服器動作丟出的訊息在正式環境會被遮掉,所以錯誤一律用回傳值帶回去。
 */

/** 一次呼叫最多處理的格數/項目數——前端自己分批,這裡是防呆,也避免一個請求跑太久。 */
const MAX_CELLS_PER_CALL = 400;
const MAX_ROWS_PER_CALL = 40;

export type PasteCellEntry = { itemId: string; columnId: string; value: CellValueJson };
export type PasteCellFailure = { itemId: string; columnId: string; error: string };

async function writeCell(boardId: string, entry: PasteCellEntry): Promise<string | null> {
  try {
    const result = await upsertCellValue(boardId, entry.itemId, entry.columnId, entry.value);
    return result?.error ?? null;
  } catch {
    return "儲存失敗";
  }
}

/** 整欄取代(或一次改多格):依序寫入,回報哪些成功、哪些失敗與原因。 */
export async function pasteCellValues(
  boardId: string,
  entries: PasteCellEntry[]
): Promise<{ applied: PasteCellEntry[]; failed: PasteCellFailure[]; error?: string }> {
  await requireSession();
  if (entries.length > MAX_CELLS_PER_CALL) {
    return { applied: [], failed: [], error: `一次最多處理 ${MAX_CELLS_PER_CALL} 格` };
  }
  const applied: PasteCellEntry[] = [];
  const failed: PasteCellFailure[] = [];
  for (const entry of entries) {
    const error = await writeCell(boardId, entry);
    if (error) failed.push({ itemId: entry.itemId, columnId: entry.columnId, error });
    else applied.push(entry);
  }
  return { applied, failed };
}

export type PasteNewItemRow = { name: string; cells: { columnId: string; value: CellValueJson }[] };

/**
 * 貼上新增項目:一列建一個項目(放在分組最上層),再把那一列的各欄寫進去。
 * 建立項目本身失敗(多半是沒有這個分組的結構權限)就停下來,不再試後面的列。
 */
export async function pasteNewItems(
  boardId: string,
  groupId: string,
  rows: PasteNewItemRow[]
): Promise<{
  created: { itemId: string; name: string }[];
  failed: (PasteCellFailure & { name: string })[];
  error?: string;
}> {
  await requireSession();
  if (rows.length > MAX_ROWS_PER_CALL) return { created: [], failed: [], error: `一次最多建立 ${MAX_ROWS_PER_CALL} 個項目` };

  const created: { itemId: string; name: string }[] = [];
  const failed: (PasteCellFailure & { name: string })[] = [];
  for (const row of rows) {
    let itemId: string;
    try {
      itemId = (await createItem(boardId, groupId, row.name)).id;
    } catch (err) {
      return { created, failed, error: err instanceof Error ? err.message : "建立項目失敗" };
    }
    created.push({ itemId, name: row.name });
    for (const cell of row.cells) {
      const error = await writeCell(boardId, { itemId, columnId: cell.columnId, value: cell.value });
      if (error) failed.push({ itemId, columnId: cell.columnId, error, name: row.name });
    }
  }
  return { created, failed };
}
