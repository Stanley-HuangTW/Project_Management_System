"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBoardBudget } from "@/lib/boardBudgetRights";
import { resyncBomMaterial } from "@/lib/bomMaterial";
import { UserError } from "@/lib/userError";
import { asExtra, compactExtra, loadBomColumns } from "@/lib/bomColumnsServer";
import { parseClipboardTable } from "@/lib/clipboardTable";
import { isCustomColumn, type BomColumnDef, type ImportUser } from "@/lib/bomColumns";
import {
  buildRowUpdate,
  convertPastedCell,
  labelOfKey,
  placeBlock,
  type CellSelection,
  type FieldChange,
  type RowUpdate,
} from "@/lib/bomCellPaste";

/**
 * 從 Excel 複製一欄、一列或一塊,貼到 BOM 表格上更新現有的列(規則見 lib/bomCellPaste.ts)。
 * 預覽與套用走同一個算法:畫面送上來的只有「貼上的文字、框選(或起點)的位置、畫面上列與欄的順序」,
 * 每一格轉成什麼值、哪些列有子項目、幣別與匯率怎麼連動,都由這裡照資料庫現在的樣子重新算,不信任畫面算的。
 */

export type CellPasteRequest = {
  /** 畫面上看得到的列(已存的)的順序。 */
  rowOrder: string[];
  /** 畫面上看得到的資料欄的順序(欄位代號)。 */
  colOrder: string[];
  selection: CellSelection;
  text: string;
};

export type CellPastePreview = {
  /** 貼上的內容有幾列、幾欄。 */
  blockRows: number;
  blockCols: number;
  /** 貼上的第 1、2、3… 欄各對應到表格的哪一欄(第一列的對應)。 */
  mapping: string[];
  /** 會更新幾格、涉及幾列。 */
  applicable: number;
  rows: number;
  /** 前幾格的預覽(列名稱、欄、舊值 → 新值)。 */
  samples: { rowName: string; colLabel: string; before: string; after: string }[];
  /** 轉不過去、不能貼的格子(原因),這些格子不會動。 */
  problems: string[];
  notes: string[];
};

async function guard(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (!(await canEditBoardBudget(boardId, session))) {
    throw new UserError("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機 BOM");
  }
  return session;
}

const MAX_SAMPLES = 12;
const MAX_PROBLEMS = 40;

type Planned = {
  preview: CellPastePreview;
  updates: { id: string; name: string; update: RowUpdate; currentExtra: unknown }[];
  /** 實際會動到的格子數(幣別與匯率連動被擋下的不算)。 */
  appliedCells: number;
};

function describeValue(row: Record<string, unknown>, colKey: string, columns: BomColumnDef[], users: ImportUser[], isAssembly: boolean): string {
  switch (colKey) {
    case "name":
    case "vendor":
    case "partNumber":
    case "note":
      return String(row[colKey] ?? "");
    case "delivery":
      return String(row.deliveryDate ?? "");
    case "qty":
      return String(Number(row.qty));
    case "unitPrice":
      return isAssembly ? "(子項目加總)" : String(Number(row.unitPrice));
    case "currency":
      return isAssembly ? "" : String(row.currency ?? "");
    case "fxRate":
      return isAssembly ? "" : String(Number(row.fxRate));
  }
  const column = columns.find((c) => c.id === colKey && isCustomColumn(c));
  const value = asExtra(row.extra)[colKey];
  if (!column || value === null || value === undefined || value === false || value === "") return "";
  if (column.type === "PERSON") return users.find((u) => u.id === value)?.name ?? "(已刪除的使用者)";
  if (column.type === "CHECKBOX") return value === true ? "是" : "";
  return String(value);
}

async function plan(boardId: string, product: string, phaseId: string, req: CellPasteRequest): Promise<Planned | { error: string }> {
  if (
    !req ||
    !Array.isArray(req.rowOrder) ||
    !Array.isArray(req.colOrder) ||
    !req.selection ||
    !Array.isArray(req.selection.rowIds) ||
    !Array.isArray(req.selection.colKeys) ||
    req.selection.rowIds.length === 0 ||
    req.selection.colKeys.length === 0 ||
    typeof req.text !== "string"
  ) {
    return { error: "要貼上的位置或內容不完整,請重新操作" };
  }
  if (req.rowOrder.length > 5000 || req.colOrder.length > 100) return { error: "表格太大,無法貼上" };

  const grid = parseClipboardTable(req.text);
  const placed = placeBlock(grid, req.rowOrder, req.colOrder, req.selection);
  if ("error" in placed) return { error: placed.error };
  if (placed.cells.length === 0) return { error: "沒有可以貼上的格子" };

  const rowIds = [...new Set(placed.cells.map((c) => c.rowId))];
  const [rows, parentRows, columns] = await Promise.all([
    prisma.bomLine.findMany({ where: { id: { in: rowIds }, boardId, product, phaseId } }),
    prisma.bomLine.findMany({ where: { boardId, product, phaseId, parentId: { not: null } }, select: { parentId: true } }),
    loadBomColumns(boardId),
  ]);
  if (rows.length !== rowIds.length) return { error: "有的列找不到(可能已經被刪除),請重新整理後再試" };
  const rowById = new Map(rows.map((r) => [r.id, r]));
  const parents = new Set(parentRows.map((p) => p.parentId as string));

  const needUsers = placed.cells.some((c) => columns.some((col) => col.id === c.colKey && col.type === "PERSON"));
  const users = needUsers ? await prisma.user.findMany({ select: { id: true, name: true } }) : [];

  const changesOf = new Map<string, { change: FieldChange; colKey: string; text: string }[]>();
  const problems: string[] = [];
  const notes: string[] = [];
  const samples: CellPastePreview["samples"] = [];
  let blankSkipped = 0;

  for (const cell of placed.cells) {
    const row = rowById.get(cell.rowId)!;
    const isAssembly = parents.has(row.id);
    const converted = convertPastedCell(cell.colKey, cell.text, {
      columns,
      users,
      row: { isAssembly, currency: row.currency, fxRate: Number(row.fxRate) },
    });
    const colLabel = labelOfKey(cell.colKey, columns);
    if ("problem" in converted) {
      problems.push(`「${row.name}」的${colLabel}:${converted.problem}`);
      continue;
    }
    if ("skip" in converted) {
      blankSkipped++;
      continue;
    }
    (changesOf.get(row.id) ?? changesOf.set(row.id, []).get(row.id)!).push({ change: converted.change, colKey: cell.colKey, text: cell.text.trim() });
    if (samples.length < MAX_SAMPLES) {
      samples.push({
        rowName: row.name,
        colLabel,
        before: describeValue(row as unknown as Record<string, unknown>, cell.colKey, columns, users, isAssembly),
        after: cell.text.trim(),
      });
    }
  }

  const codes = [...new Set([...changesOf.values()].flat().flatMap((c) => (c.change.field === "currency" && c.change.value !== "TWD" ? [c.change.value] : [])))];
  const rateRows = codes.length ? await prisma.exchangeRate.findMany({ where: { code: { in: codes } }, select: { code: true, rate: true } }) : [];
  const rates = new Map(rateRows.map((r) => [r.code, Number(r.rate)]));

  const updates: Planned["updates"] = [];
  let appliedCells = 0;
  for (const [rowId, entries] of changesOf) {
    const row = rowById.get(rowId)!;
    const update = buildRowUpdate({ isAssembly: parents.has(rowId), currency: row.currency, fxRate: Number(row.fxRate) }, entries.map((e) => e.change), (code) => rates.get(code) ?? null);
    for (const p of update.problems) problems.push(`「${row.name}」:${p}`);
    // 實際會動的格子:幣別與匯率被擋下的不算。
    appliedCells += entries.filter((e) => e.change.field !== "currency" && e.change.field !== "fxRate").length;
    if (entries.some((e) => e.change.field === "currency") && update.data.currency !== undefined) appliedCells++;
    if (entries.some((e) => e.change.field === "fxRate") && update.data.fxRate !== undefined) appliedCells++;
    if (Object.keys(update.data).length > 0 || update.extra) updates.push({ id: rowId, name: row.name, update, currentExtra: row.extra });
  }

  if (blankSkipped > 0) notes.push(`${blankSkipped} 格是空白的名稱 / 數字格,維持原樣(沒有清空)。`);
  if (placed.clippedRows > 0) notes.push(`貼上的內容比表格多 ${placed.clippedRows} 列,超出的部分沒有貼(只更新現有的列,不會新增列)。`);
  if (placed.clippedCols > 0) notes.push(`貼上的內容比表格右邊的欄位多,最右邊 ${placed.clippedCols} 欄沒有貼。`);

  const firstRow = grid[0] ?? [];
  const col0 = req.colOrder.indexOf(req.selection.colKeys[0]);
  const mapping = firstRow.map((_, j) => (col0 + j < req.colOrder.length ? labelOfKey(req.colOrder[col0 + j], columns) : "(沒有這一欄)"));

  return {
    preview: {
      blockRows: grid.length,
      blockCols: Math.max(...grid.map((r) => r.length)),
      mapping,
      applicable: appliedCells,
      rows: updates.length,
      samples,
      problems: problems.slice(0, MAX_PROBLEMS),
      notes: problems.length > MAX_PROBLEMS ? [...notes, `還有 ${problems.length - MAX_PROBLEMS} 格的問題沒有列出。`] : notes,
    },
    updates,
    appliedCells,
  };
}

/** 貼上之前的預覽:每一欄對應到哪、前幾格從什麼換成什麼、哪些格子不會動。不會改任何資料。 */
export async function previewBomCellPaste(
  boardId: string,
  product: string,
  phaseId: string,
  req: CellPasteRequest
): Promise<CellPastePreview | { error: string }> {
  await guard(boardId);
  const planned = await plan(boardId, product, phaseId, req);
  return "error" in planned ? planned : planned.preview;
}

/** 套用貼上:照資料庫現在的樣子重新算一次再寫入(一個交易,全有或全無);不能用「上一步」還原。 */
export async function applyBomCellPaste(
  boardId: string,
  product: string,
  phaseId: string,
  req: CellPasteRequest
): Promise<{ error?: string; applied?: number; rows?: number; problems?: string[] }> {
  const session = await guard(boardId);
  const planned = await plan(boardId, product, phaseId, req);
  if ("error" in planned) return { error: planned.error };
  if (planned.updates.length === 0) {
    return { error: ["沒有任何一格可以貼上。", ...planned.preview.problems.slice(0, 8)].join("\n") };
  }

  await prisma.$transaction(
    planned.updates.map(({ id, update, currentExtra }) =>
      prisma.bomLine.update({
        where: { id },
        data: {
          ...update.data,
          ...(update.extra ? { extra: compactExtra({ ...asExtra(currentExtra), ...update.extra }) as Prisma.InputJsonValue } : {}),
        },
      })
    )
  );

  await logAudit("COST", session.userId, `貼上更新 BOM「${product}」${planned.appliedCells} 格(${planned.updates.length} 列,從「${planned.preview.mapping[0] ?? ""}」欄起)`, boardId);
  await resyncBomMaterial(boardId, phaseId);
  revalidatePath(`/boards/${boardId}`);
  return { applied: planned.appliedCells, rows: planned.updates.length, problems: planned.preview.problems };
}
