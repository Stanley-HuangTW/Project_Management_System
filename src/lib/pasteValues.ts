/**
 * 貼上(Ctrl+V)進表格:把試算表複製來的文字,依欄位類型轉成儲存值。純邏輯,不碰 React 與 server。
 *
 * - 整欄取代:框選同一欄的一段儲存格,貼上的每一行對應一格(planColumnReplace)
 * - 貼上新增項目:每一列一個項目,第一欄是名稱,其餘欄依序對應到表格的欄位(planNewItems)
 *
 * 轉不過去的格子不會寫,也不會中斷其他格:回報原因,讓人知道哪幾格沒貼成。
 */
import { getStatusOptions, type CellValueJson, type ColumnType } from "@/types/column";

export type PasteColumn = { id: string; name: string; type: ColumnType; options: unknown };
export type PasteUser = { id: string; name: string; email?: string | null };
export type PasteContext = {
  users: PasteUser[];
  /** 進度欄位:畫面上是百分比,存的是 0–1。貼「50」或「50%」都是 50%。 */
  progressColumnId: string | null;
};

export type ParsedCell = { ok: true; value: CellValueJson } | { ok: false; reason: string };

/** 一次貼上最多處理幾列/幾格——再多多半是貼錯了整份文件。 */
export const MAX_PASTE_ROWS = 300;

function validIsoDate(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 2026-10-08、2026/10/8、2026.10.8、20261008 都認得;只有月日、或西式的 10/8/2026 不猜(年或順序有歧義)。 */
export function parseDateText(text: string): string | null {
  const t = text.trim();
  const sep = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (sep) return validIsoDate(Number(sep[1]), Number(sep[2]), Number(sep[3]));
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (compact) return validIsoDate(Number(compact[1]), Number(compact[2]), Number(compact[3]));
  return null;
}

/** 把貼上的一格文字轉成這個欄位的儲存值。空白代表清空(null)。 */
export function parsePastedCell(column: PasteColumn, raw: string, ctx: PasteContext): ParsedCell {
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };

  switch (column.type) {
    case "TEXT":
      return { ok: true, value: text };

    case "NUMBER": {
      const hasPercent = text.endsWith("%");
      const body = (hasPercent ? text.slice(0, -1) : text).replace(/[,\s]/g, "");
      const num = body === "" ? NaN : Number(body);
      if (!Number.isFinite(num)) return { ok: false, reason: `「${text}」不是數字` };
      if (column.id === ctx.progressColumnId) {
        if (num < 0 || num > 100) return { ok: false, reason: `進度要在 0 到 100 之間(貼的是「${text}」)` };
        return { ok: true, value: num / 100 };
      }
      if (hasPercent) return { ok: false, reason: `「${text}」有百分比符號,這一欄是一般數字` };
      return { ok: true, value: num };
    }

    case "DATE": {
      const iso = parseDateText(text);
      return iso ? { ok: true, value: iso } : { ok: false, reason: `「${text}」不是日期(請用 2026-10-08 或 2026/10/8)` };
    }

    case "STATUS": {
      const options = getStatusOptions(column.options);
      const wanted = text.toLowerCase();
      const hit = options.find((o) => o.id === text) ?? options.find((o) => o.label.trim().toLowerCase() === wanted);
      if (hit) return { ok: true, value: hit.id };
      return { ok: false, reason: `沒有「${text}」這個選項(可選:${options.map((o) => o.label).join("、")})` };
    }

    case "PERSON": {
      const wanted = text.toLowerCase();
      const byId = ctx.users.find((u) => u.id === text);
      if (byId) return { ok: true, value: byId.id };
      const matches = ctx.users.filter(
        (u) => u.name.trim().toLowerCase() === wanted || (u.email ?? "").trim().toLowerCase() === wanted
      );
      if (matches.length === 1) return { ok: true, value: matches[0].id };
      if (matches.length > 1) return { ok: false, reason: `有 ${matches.length} 位叫「${text}」,分不出是誰(請改貼 Email)` };
      return { ok: false, reason: `找不到成員「${text}」` };
    }

    default:
      return { ok: false, reason: "這個欄位類型不能貼上" };
  }
}

/**
 * 這個欄位不能用貼上的——原因;可以貼就回傳 null。
 * Pred 存的是工作項關係(不是文字),要用欄位裡的選取器設;Lvl 是依項目位置自動維護的數字。
 */
export function columnPasteSkipReason(column: PasteColumn, board: { predColumnId: string | null }): string | null {
  if (column.id === board.predColumnId) return "前置依賴(Pred)要用欄位裡的選取器設定,不能貼文字";
  if (column.name === "Lvl" && column.type === "NUMBER") return "Lvl 會依項目的位置自動維護";
  return null;
}

export type ReplaceTarget = {
  itemId: string;
  name: string;
  /** 這一格不能貼(例如有子項目的進度是統計出來的)——原因。 */
  skipReason?: string | null;
};

export type ColumnReplacePlan = {
  entries: { itemId: string; value: CellValueJson }[];
  /** 逐格的原因:轉不過去、不能貼的格子。 */
  problems: string[];
  /** 貼上的行數跟框選的格數對不起來時的說明。 */
  note: string | null;
};

/**
 * 整欄取代:框選的格子(由上到下)對應貼上的每一行。
 * - 只貼一行 → 框選的每一格都填同樣的值(跟試算表一樣)。
 * - 行數跟格數不同 → 取兩者較少的,多的不貼也不動,並在 note 說明。
 */
export function planColumnReplace(opts: {
  column: PasteColumn;
  targets: ReplaceTarget[];
  lines: string[];
  ctx: PasteContext;
}): ColumnReplacePlan {
  const { column, targets, lines, ctx } = opts;
  const entries: ColumnReplacePlan["entries"] = [];
  const problems: string[] = [];
  let note: string | null = null;

  const fillAll = lines.length === 1 && targets.length > 1;
  const count = fillAll ? targets.length : Math.min(lines.length, targets.length);
  if (!fillAll && lines.length > targets.length) {
    note = `貼上了 ${lines.length} 行,但只框選了 ${targets.length} 格,多出的 ${lines.length - targets.length} 行沒有貼。`;
  } else if (!fillAll && lines.length < targets.length) {
    note = `框選了 ${targets.length} 格,但只貼上 ${lines.length} 行,其餘 ${targets.length - lines.length} 格沒有動。`;
  }

  for (let i = 0; i < count; i++) {
    const target = targets[i];
    if (target.skipReason) {
      problems.push(`「${target.name}」:${target.skipReason}`);
      continue;
    }
    const parsed = parsePastedCell(column, fillAll ? lines[0] : lines[i], ctx);
    if (parsed.ok) entries.push({ itemId: target.itemId, value: parsed.value });
    else problems.push(`「${target.name}」:${parsed.reason}`);
  }
  return { entries, problems, note };
}

export type NewItemsPlan = {
  rows: { name: string; cells: { columnId: string; value: CellValueJson }[] }[];
  /** 貼上的每一欄對應到哪裡,給確認視窗說明。 */
  mapping: { clipboardColumn: number; target: string; skipReason: string | null }[];
  problems: string[];
};

/**
 * 貼上新增項目:每一列一個項目。第一欄是名稱,第 2、3… 欄依序對應到表格由左到右的欄位
 * (`columns` 要照畫面上的順序給)。空白的格子不寫;不能貼的欄位整欄略過;名稱是空的那一列不建。
 */
export function planNewItems(opts: {
  table: string[][];
  columns: PasteColumn[];
  /** 這個欄位不能貼的原因;可以貼就回傳 null。 */
  skipReason: (column: PasteColumn) => string | null;
  ctx: PasteContext;
}): NewItemsPlan {
  const { table, columns, skipReason, ctx } = opts;
  const widest = table.reduce((max, r) => Math.max(max, r.length), 0);

  const mapping: NewItemsPlan["mapping"] = [{ clipboardColumn: 1, target: "項目名稱", skipReason: null }];
  for (let j = 1; j < widest; j++) {
    const column = columns[j - 1];
    mapping.push(
      column
        ? { clipboardColumn: j + 1, target: column.name, skipReason: skipReason(column) }
        : { clipboardColumn: j + 1, target: "(沒有對應的欄位)", skipReason: "表格已經沒有更多欄位了" }
    );
  }

  const rows: NewItemsPlan["rows"] = [];
  const problems: string[] = [];
  let unnamed = 0;
  for (const cells of table) {
    const name = (cells[0] ?? "").trim();
    if (name === "") {
      // 整列都空白(或只有一個空行)不值得提;有別的內容卻沒有名稱才要說。
      if (cells.some((c) => c.trim() !== "")) unnamed++;
      continue;
    }
    const written: { columnId: string; value: CellValueJson }[] = [];
    for (let j = 1; j < cells.length; j++) {
      const m = mapping[j];
      const column = columns[j - 1];
      if (!column || !m || m.skipReason || cells[j].trim() === "") continue;
      const parsed = parsePastedCell(column, cells[j], ctx);
      if (parsed.ok) written.push({ columnId: column.id, value: parsed.value });
      else problems.push(`「${name}」的「${column.name}」:${parsed.reason}`);
    }
    rows.push({ name, cells: written });
  }
  if (unnamed > 0) problems.push(`${unnamed} 列沒有名稱(第一欄是空的),沒有建立。`);
  return { rows, mapping, problems };
}
