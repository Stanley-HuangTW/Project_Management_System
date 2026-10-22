"use server";

import { randomUUID } from "node:crypto";
import { parse as parseCsvSync } from "csv-parse/sync";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { applyVisibility } from "@/lib/applyVisibility";
import { loadDmScopeSettings } from "@/lib/dmScopeServer";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { syncGroupRolesFromBoard } from "@/lib/boardRolesServer";
import { boardWithDataArgs, type ItemData, type ColumnData } from "@/types/board";
import {
  DEFAULT_STATUS_PALETTE,
  getStatusOptions,
  type ColumnType,
  type StatusOption,
} from "@/types/column";
import {
  buildBoardCsv,
  parseBoardCsv,
  reconstructDepthTree,
  cellValueToCsvText,
  cellTextToValue,
} from "@/lib/boardCsv";

/**
 * 看板的 CSV 備份/還原:每個看板一個檔案,涵蓋這個看板上所有工作項跟它們
 * 每個欄位的值,匯出再匯入是真的往返——既有工作項用同一個隱藏 ID 對回去
 * 更新,不是每次都當新的加進去。
 *
 * 跟人力表/樣機計畫/樣機 BOM 那三份 Excel 分開:那三份各自有自己的表格
 * 形狀(月份、產品×階段、樹狀 BOM),而且需要公式跟樹狀結構,CSV 這種
 * 純文字格式放不下。這裡管的是看板本身——工作項、它們的欄位值、屬於哪個
 * 分組——那三份規劃表已經各自處理好自己的那塊。
 *
 * 範圍不含:留言、附件(檔案)、稽核紀錄、使用者權限——這些不是「看板的
 * 資料」在試算表裡能自然表達的東西,硬塞進 CSV 只會做出一個看起來完整、
 * 用起來卻殘缺的備份。
 */

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

export type CsvBoardOption = { id: string; name: string };

/** 目前這個帳號看得到的看板,給「全部看板」那個清單用。 */
export async function listCsvBoards(): Promise<CsvBoardOption[]> {
  const session = await requireSession();
  return prisma.board.findMany({
    where: accessibleBoardWhere(session),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** 一個人或資源在 CSV 裡要顯示的名字——跟指派下拉選單看到的一樣,資源要
 *  帶上分類,不然「王小明」跟「王小明(供應商)」在還原時分不出是誰。 */
async function personNameMap(): Promise<Map<string, string>> {
  const [users, resources] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.resource.findMany({ select: { id: true, name: true, category: true } }),
  ]);
  const map = new Map<string, string>();
  for (const u of users) map.set(u.id, u.name);
  for (const r of resources) map.set(r.id, r.category ? `${r.name} (${r.category})` : r.name);
  return map;
}

/** 上面那份名字對照表反過來:小寫名字 → id,匯入比對用。 */
function reverseLowerNameMap(nameById: Map<string, string>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, name] of nameById) map.set(name.toLowerCase(), id);
  return map;
}

/** 這一格目前存的值,照欄位類型讀出來(形狀跟 CellValue.value 一致)。 */
function rawCellValue(item: ItemData, columnId: string): string | number | null {
  const cv = item.cellValues.find((c) => c.columnId === columnId);
  return cv === undefined ? null : (cv.value as string | number | null);
}

/** 由上而下,同一層按 order 排——跟畫面上看到的順序一樣,順便算出每一項
 *  的階層深度(0 = 最上層)。 */
function orderedWithDepth(items: ItemData[]): { item: ItemData; depth: number }[] {
  const byParent = new Map<string | null, ItemData[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const out: { item: ItemData; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const child of byParent.get(parentId) ?? []) {
      out.push({ item: child, depth });
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export async function exportBoardCsv(
  boardId: string
): Promise<{ filename: string; content: string } | { error: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const loaded = await prisma.board.findUnique({ where: { id: boardId }, ...boardWithDataArgs });
  if (!loaded) return { error: "找不到這個看板" };
  // 匯出的是這個人在畫面上看得到的:私人項目、DM 的可見範圍(系統設定)都照畫面。
  const board = applyVisibility(loaded, session, await loadDmScopeSettings());

  const personNameById = await personNameMap();
  const groupNameById = new Map(board.groups.map((g) => [g.id, g.name]));
  const ordered = orderedWithDepth(board.items);

  const content = buildBoardCsv({
    boardId: board.id,
    boardName: board.name,
    columns: board.columns.map((c) => ({ name: c.name })),
    rows: ordered.map(({ item, depth }) => ({
      id: item.id,
      depth,
      groupName: groupNameById.get(item.groupId) ?? "",
      name: item.name,
      cells: board.columns.map((col) =>
        cellValueToCsvText(rawCellValue(item, col.id), {
          type: col.type as ColumnType,
          statusOptions: col.type === "STATUS" ? getStatusOptions(col.options) : undefined,
          personNameById: col.type === "PERSON" ? personNameById : undefined,
        })
      ),
    })),
  });

  await logAudit("BOARD", session.userId, `匯出「${board.name}」的 CSV 備份`, boardId);
  return { filename: `${safeFilename(board.name)}.csv`, content };
}

export type CsvImportResult = {
  boardId: string;
  boardName: string;
  created: number;
  updated: number;
  /** 這個看板上有、但這份 CSV 完全沒提到的工作項。刻意不刪。 */
  untouched: string[];
  warnings: string[];
  error?: string;
};

/**
 * 收回一份改過的看板 CSV。
 *
 * CSV 裡每一列靠隱藏的 ID 對回既有工作項——有對到就更新,對不到(或整欄
 * 是空的)就當新工作項建立。跟人力表、樣機計畫、樣機 BOM 同一條規則:只
 * 新增與更新,不刪——這個看板上有、但 CSV 沒提到的工作項維持原樣。
 *
 * 只有管理者能做:這支一次可能改動一整個看板幾百個工作項,跟既有的匯入
 * 精靈(ImportWizard)是同一個權限門檻。
 */
export async function importBoardCsv(csvText: string): Promise<CsvImportResult> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const empty = { created: 0, updated: 0, untouched: [], warnings: [] };

  let matrix: (string | null)[][];
  try {
    matrix = parseCsvSync(csvText, { relax_column_count: true, skip_empty_lines: false }) as string[][];
  } catch (e) {
    return { ...empty, boardId: "", boardName: "", error: e instanceof Error ? e.message : "讀不懂這個檔案" };
  }

  let parsed;
  try {
    parsed = parseBoardCsv(matrix);
  } catch (e) {
    return { ...empty, boardId: "", boardName: "", error: e instanceof Error ? e.message : "讀不懂這個檔案" };
  }
  if (!parsed.boardId) {
    return {
      ...empty,
      boardId: "",
      boardName: "",
      error: "檔案裡找不到看板 id。請用程式匯出的檔案來改,不要自己新建一份。",
    };
  }

  const board = await prisma.board.findUnique({ where: { id: parsed.boardId }, ...boardWithDataArgs });
  if (!board) {
    return {
      ...empty,
      boardId: parsed.boardId,
      boardName: parsed.boardName ?? "",
      error: `找不到 id 是「${parsed.boardId}」的看板,可能已經被刪除。`,
    };
  }
  await requireBoardAccess(board.id, session);

  const personNameById = await personNameMap();
  const personIdByLowerName = reverseLowerNameMap(personNameById);
  const warnings = [...parsed.warnings];

  // CSV 表頭的欄位名稱對到看板上真的存在的欄位——對不到的欄位整欄略過,
  // 不會憑空生出一個新欄位(新增欄位是結構性的決定,不該由打錯字的表頭
  // 名稱悄悄觸發)。
  const columnByName = new Map(board.columns.map((c) => [c.name, c]));
  const matchedColumns: (ColumnData | null)[] = parsed.columnNames.map((name) => {
    const col = columnByName.get(name);
    if (!col) warnings.push(`欄位「${name}」在這個看板上找不到,整欄略過。`);
    return col ?? null;
  });

  const { rows: rootedRows, warnings: treeWarnings } = reconstructDepthTree(parsed.rows);
  warnings.push(...treeWarnings);

  // 分組先建好,工作項才有地方掛。
  const groupIdByName = new Map(board.groups.map((g) => [g.name, g.id]));
  let nextGroupOrder = board.groups.reduce((max, g) => Math.max(max, g.order), -1) + 1;
  for (const row of rootedRows) {
    if (!row.groupName || groupIdByName.has(row.groupName)) continue;
    const created = await prisma.group.create({
      data: { boardId: board.id, name: row.groupName, order: nextGroupOrder++ },
      select: { id: true },
    });
    // 匯入新建的分組沿用看板設定的角色。
    await syncGroupRolesFromBoard(board.id, { groupId: created.id });
    groupIdByName.set(row.groupName, created.id);
  }

  const itemById = new Map(board.items.map((i) => [i.id, i]));
  const idOf: (string | null)[] = [];
  const touched = new Set<string>();
  let created = 0;
  let updated = 0;
  const nextOrder = new Map<string | null, number>();
  for (const item of board.items) {
    const key = item.parentId;
    nextOrder.set(key, Math.max(nextOrder.get(key) ?? -1, item.order) + 1);
  }

  for (let i = 0; i < rootedRows.length; i++) {
    const row = rootedRows[i];
    const parentId = row.parentIndex !== null ? idOf[row.parentIndex] : null;

    if (!row.groupName) {
      warnings.push(`「${row.name}」沒有填分組,這一列略過。`);
      idOf[i] = null;
      continue;
    }
    const groupId = groupIdByName.get(row.groupName)!;

    // 同一個 ID 出現兩次,多半是使用者複製整列來加工作項卻忘了清掉 A 欄。
    // 當成新工作項處理——兩列都寫回同一個工作項的話,後面那列會蓋掉前面
    // 那列剛寫進去的內容。
    const duplicate = row.id !== "" && touched.has(itemById.get(row.id)?.id ?? "\0");
    const existing = row.id && !duplicate ? itemById.get(row.id) : undefined;
    if (row.id && !existing && !duplicate) {
      warnings.push(`「${row.name}」的 ID 在這個看板上找不到,當成新工作項新增。`);
    } else if (duplicate) {
      warnings.push(`「${row.name}」的 ID 跟前面重複了,當成新工作項處理。`);
    }

    let itemId: string;
    if (existing) {
      await prisma.item.update({
        where: { id: existing.id },
        data: { name: row.name, groupId, parentId, order: existing.order },
      });
      itemId = existing.id;
      touched.add(itemId);
      updated++;
    } else {
      const order = nextOrder.get(parentId) ?? 0;
      nextOrder.set(parentId, order + 1);
      const fresh = await prisma.item.create({
        data: { boardId: board.id, groupId, parentId, name: row.name, order },
        select: { id: true },
      });
      itemId = fresh.id;
      touched.add(itemId);
      created++;
    }
    idOf[i] = itemId;

    for (let c = 0; c < matchedColumns.length; c++) {
      const column = matchedColumns[c];
      if (!column) continue;
      const text = row.cells[c] ?? "";
      const result = cellTextToValue(text, {
        type: column.type as ColumnType,
        statusOptions: column.type === "STATUS" ? getStatusOptions(column.options) : undefined,
        personIdByLowerName: column.type === "PERSON" ? personIdByLowerName : undefined,
      });

      let value: string | number | null;
      if (result.kind === "warning") {
        warnings.push(`「${row.name}」的「${column.name}」${result.message},這一格略過。`);
        continue;
      } else if (result.kind === "newStatus") {
        const options = getStatusOptions(column.options);
        const newOption: StatusOption = {
          id: randomUUID().slice(0, 8),
          label: result.label,
          color: DEFAULT_STATUS_PALETTE[options.length % DEFAULT_STATUS_PALETTE.length],
        };
        const updatedOptions = [...options, newOption];
        await prisma.column.update({
          where: { id: column.id },
          data: { options: { statuses: updatedOptions } },
        });
        column.options = { statuses: updatedOptions };
        value = newOption.id;
      } else {
        value = result.value;
      }

      if (value === null) {
        await prisma.cellValue.deleteMany({ where: { itemId, columnId: column.id } });
      } else {
        await prisma.cellValue.upsert({
          where: { itemId_columnId: { itemId, columnId: column.id } },
          create: { itemId, columnId: column.id, value },
          update: { value },
        });
      }
    }
  }

  const untouched = board.items.filter((i) => !touched.has(i.id)).map((i) => i.name);

  await logAudit(
    "BOARD",
    session.userId,
    `匯入「${board.name}」的 CSV 備份:新增 ${created}、更新 ${updated}、未提及 ${untouched.length}`,
    board.id
  );
  revalidatePath(`/boards/${board.id}`);

  return { boardId: board.id, boardName: board.name, created, updated, untouched, warnings };
}
