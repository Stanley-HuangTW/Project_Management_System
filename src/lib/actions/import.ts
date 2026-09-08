"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { parseNumberInput } from "@/lib/cellValue";
import {
  parseWorkbookBuffer,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_COLS,
  type ParsedWorkbook,
  type ParsedSheet,
} from "@/lib/import/parseFile";
import { GOOGLE_TOKEN_COOKIE } from "@/lib/googleAuth";
import { normalizePredReferences } from "@/lib/predecessorLink";
import {
  DEFAULT_STATUS_PALETTE,
  getStatusOptions,
  type ColumnType,
  type StatusOption,
} from "@/types/column";
import type { ImportRowsInput, ImportResult } from "@/types/import";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];

export async function parseImportFile(
  formData: FormData
): Promise<ParsedWorkbook> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new Error("請選擇檔案");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("檔案大小不可超過 10MB");
  }
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error("僅支援 .csv、.xlsx、.xls 檔案");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  return parseWorkbookBuffer(buffer, file.name);
}

type SheetsApiResponse = {
  sheets?: {
    properties?: { title?: string };
    data?: { rowData?: { values?: { formattedValue?: string }[] }[] }[];
  }[];
};

// The docs.google.com export URL only accepts a logged-in browser session,
// not an OAuth bearer token — a private sheet the user just signed in for
// has to go through the actual Sheets API instead.
async function fetchViaSheetsApi(spreadsheetId: string, token: string): Promise<ParsedWorkbook> {
  const fields = "sheets(properties.title,data.rowData.values.formattedValue)";
  const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?includeGridData=true&fields=${encodeURIComponent(fields)}`;

  const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "無法存取此 Google Sheet(此 Google 帳號沒有這份試算表的檢視權限)。請確認登入的帳號有權檢視此表單,或改用「上傳檔案」方式匯入。"
      );
    }
    throw new Error(`無法讀取此 Google Sheet(HTTP ${res.status})`);
  }

  const data = (await res.json()) as SheetsApiResponse;
  const sheets: ParsedSheet[] = (data.sheets ?? []).map((sheet) => {
    const rowData = sheet.data?.[0]?.rowData ?? [];
    const rows = rowData
      .slice(0, MAX_IMPORT_ROWS)
      .map((row) =>
        (row.values ?? [])
          .slice(0, MAX_IMPORT_COLS)
          .map((cell) => cell.formattedValue ?? null)
      );
    return { name: sheet.properties?.title ?? "Sheet1", rows };
  });
  return { sheets };
}

export async function parseImportFromUrl(url: string): Promise<ParsedWorkbook> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("請輸入有效的網址");
  }

  if (parsed.hostname !== "docs.google.com") {
    throw new Error("僅支援 docs.google.com 的 Google Sheet 連結");
  }

  const match = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error("無法從網址取得 Google Sheet ID,請確認網址格式");
  }
  const spreadsheetId = match[1];

  const cookieStore = await cookies();
  const googleToken = cookieStore.get(GOOGLE_TOKEN_COOKIE)?.value;

  if (googleToken) {
    const result = await fetchViaSheetsApi(spreadsheetId, googleToken);
    cookieStore.delete(GOOGLE_TOKEN_COOKIE);
    return result;
  }

  const exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`;
  const res = await fetch(exportUrl);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "無法存取此 Google Sheet(需要登入)。請將分享設定改為「知道連結的使用者」皆可檢視,點擊下方「使用 Google 帳號登入」以你自己的帳號讀取,或改用「上傳檔案」方式匯入。"
      );
    }
    throw new Error(`無法讀取此 Google Sheet(HTTP ${res.status})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return parseWorkbookBuffer(buffer, "sheet.xlsx");
}

const LEVEL_NAME_PATTERN = /^(lvl|level|層級|階層)$/i;

/** Accepts either a plain depth number ("3") or dotted WBS notation
 *  ("1.1.2.3") — for WBS notation, depth is the count of dot-separated
 *  segments (so "1" is depth 1, "1.1" is depth 2, "1.1.1.1" is depth 4). */
function parseLevel(raw: string | null, useWbsSegments: boolean): number {
  if (!raw) return 1;
  const trimmed = raw.trim();
  if (!trimmed) return 1;

  if (useWbsSegments) {
    const segments = trimmed.split(".").filter((s) => s.length > 0);
    return segments.length > 0 ? segments.length : 1;
  }

  const parsed = parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

function normalizeDateInput(raw: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, "0");
  const d = String(parsed.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type ImportStats = {
  personMismatchCount: number;
  numberParseFailCount: number;
};

async function coerceValue(
  tx: Prisma.TransactionClient,
  columnId: string,
  columnType: ColumnType | undefined,
  rawValue: string | null,
  statusOptionsById: Map<string, StatusOption[]>,
  usersByName: Map<string, string>,
  stats: ImportStats
): Promise<string | number | undefined> {
  if (rawValue === null || rawValue.trim() === "") return undefined;
  const trimmed = rawValue.trim();

  switch (columnType) {
    case "NUMBER": {
      const isPercent = trimmed.endsWith("%");
      const parsed = parseNumberInput(isPercent ? trimmed.slice(0, -1).trim() : trimmed);
      if (parsed === null) stats.numberParseFailCount++;
      return parsed === null ? undefined : isPercent ? parsed / 100 : parsed;
    }
    case "DATE":
      return normalizeDateInput(trimmed);
    case "PERSON": {
      const userId = usersByName.get(trimmed.toLowerCase());
      if (!userId) stats.personMismatchCount++;
      return userId;
    }
    case "STATUS": {
      const options = statusOptionsById.get(columnId) ?? [];
      const match = options.find(
        (o) => o.label.toLowerCase() === trimmed.toLowerCase()
      );
      if (match) return match.id;

      const newOption: StatusOption = {
        id: randomUUID().slice(0, 8),
        label: trimmed,
        color:
          DEFAULT_STATUS_PALETTE[options.length % DEFAULT_STATUS_PALETTE.length],
      };
      const updated = [...options, newOption];
      statusOptionsById.set(columnId, updated);
      await tx.column.update({
        where: { id: columnId },
        data: { options: { statuses: updated } },
      });
      return newOption.id;
    }
    case "TEXT":
    default:
      return trimmed;
  }
}

export async function importRows(
  input: ImportRowsInput
): Promise<ImportResult> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const { boardId, groupId, dataRows, mappings } = input;

  const nameMappings = mappings.filter((m) => m.target.kind === "name");
  if (nameMappings.length !== 1) {
    throw new Error("請指定剛好一欄作為「項目名稱」");
  }
  const nameColIndex = nameMappings[0].sourceColIndex;

  const explicitLevelColIndex = mappings.find((m) => m.target.kind === "level")?.sourceColIndex;

  const valueMappings = mappings.filter(
    (m) => m.target.kind === "existingColumn" || m.target.kind === "newColumn"
  );

  return prisma.$transaction(
    async (tx) => {
      const existingColumns = await tx.column.findMany({ where: { boardId } });
      let columnOrderCounter = existingColumns.length;

      const columnTypeById = new Map<string, ColumnType>();
      const statusOptionsById = new Map<string, StatusOption[]>();
      for (const c of existingColumns) {
        columnTypeById.set(c.id, c.type as ColumnType);
        if (c.type === "STATUS") {
          statusOptionsById.set(c.id, getStatusOptions(c.options));
        }
      }

      const columnIdByColIndex = new Map<number, string>();
      let newColumnCount = 0;

      for (const mapping of valueMappings) {
        if (mapping.target.kind === "existingColumn") {
          columnIdByColIndex.set(mapping.sourceColIndex, mapping.target.columnId);
        } else if (mapping.target.kind === "newColumn") {
          const options =
            mapping.target.columnType === "STATUS" ? { statuses: [] } : {};
          const created = await tx.column.create({
            data: {
              boardId,
              name: mapping.target.name.trim() || "匯入欄位",
              type: mapping.target.columnType,
              order: columnOrderCounter++,
              options,
            },
          });
          columnIdByColIndex.set(mapping.sourceColIndex, created.id);
          columnTypeById.set(created.id, mapping.target.columnType);
          if (mapping.target.columnType === "STATUS") {
            statusOptionsById.set(created.id, []);
          }
          newColumnCount++;
        }
      }

      const users = await tx.user.findMany({ select: { id: true, name: true } });
      const usersByName = new Map(
        users.map((u) => [u.name.toLowerCase(), u.id] as const)
      );

      const topLevelCount = await tx.item.count({
        where: { groupId, parentId: null },
      });
      const orderCounters = new Map<string | null, number>();
      orderCounters.set(null, topLevelCount);

      // A dedicated NUMBER value column named like "Lvl" is a more reliable
      // depth signal than a "level"-kind mapping sourced from a WBS-notation
      // column: dot-segment counting only reflects true depth when the
      // sheet's own WBS numbering nests strictly, which real sheets don't
      // always do (a whole subtree can be numbered flatly, e.g. "2.1".."2.21",
      // while mixing items that are actually two and three levels deep).
      const lvlNumberMapping = valueMappings.find((m) => {
        if (m.target.kind === "existingColumn") {
          const columnId = m.target.columnId;
          const col = existingColumns.find((c) => c.id === columnId);
          return col?.type === "NUMBER" && LEVEL_NAME_PATTERN.test(col.name.trim());
        }
        if (m.target.kind === "newColumn") {
          return (
            m.target.columnType === "NUMBER" &&
            LEVEL_NAME_PATTERN.test(m.target.name.trim())
          );
        }
        return false;
      });
      const levelColIndex = lvlNumberMapping?.sourceColIndex ?? explicitLevelColIndex;
      const useWbsSegments =
        !lvlNumberMapping &&
        levelColIndex !== undefined &&
        dataRows.some((row) => row[levelColIndex]?.includes("."));

      const stack: { level: number; itemId: string }[] = [];
      const cellValuesToCreate: {
        itemId: string;
        columnId: string;
        value: string | number;
      }[] = [];
      let itemCount = 0;
      const stats: ImportStats = { personMismatchCount: 0, numberParseFailCount: 0 };

      for (const row of dataRows) {
        const rawName = row[nameColIndex];
        const name = rawName?.trim();
        if (!name) continue;

        const rawLevel = levelColIndex !== undefined ? row[levelColIndex] : null;
        const level = parseLevel(rawLevel, useWbsSegments);

        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }
        const parentId = stack.length > 0 ? stack[stack.length - 1].itemId : null;

        const order = orderCounters.get(parentId) ?? 0;
        orderCounters.set(parentId, order + 1);

        const item = await tx.item.create({
          data: { boardId, groupId, parentId, name, order, createdById: session.userId },
        });
        itemCount++;
        stack.push({ level, itemId: item.id });

        for (const mapping of valueMappings) {
          const columnId = columnIdByColIndex.get(mapping.sourceColIndex);
          if (!columnId) continue;
          const value = await coerceValue(
            tx,
            columnId,
            columnTypeById.get(columnId),
            row[mapping.sourceColIndex] ?? null,
            statusOptionsById,
            usersByName,
            stats
          );
          if (value === undefined) continue;
          cellValuesToCreate.push({ itemId: item.id, columnId, value });
        }
      }

      if (cellValuesToCreate.length > 0) {
        await tx.cellValue.createMany({ data: cellValuesToCreate });
      }

      // The sheet's Pred column is WBS notation, which only means the right
      // task while the numbering still matches the sheet — pin each reference
      // to the item it resolves to now, before anything gets inserted.
      await normalizePredReferences(boardId, groupId, tx);

      revalidatePath(`/boards/${boardId}`);
      return { itemCount, newColumnCount, ...stats };
    },
    { timeout: 20000 }
  );
}
