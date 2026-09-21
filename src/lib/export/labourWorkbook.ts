import ExcelJS from "exceljs";
import type { MonthKey, PhaseRow, SlotRow } from "@/lib/labourSheet";
import { MAX_FTE, phaseOfMonth } from "@/lib/labourSheet";
import type { OrgUnit } from "@/lib/orgUnits";

/**
 * 人力表的 Excel 往返。
 *
 * 這張表在 Excel 裡本來就有人在維護(那份「M3專案費用預估」的 manpower
 * 分頁),談人力的會議也是開著 Excel 在談。所以不是把資料倒出去看一眼就
 * 算了 —— 匯出去改完要能原封不動地收回來。
 *
 * 能收回來靠的是第一欄那個隱藏的 ID:改名額代號、插一列、調順序都不會讓
 * 程式認錯人。沒有 ID 的列就是使用者自己加的,匯入時當新名額建。
 *
 * 表上的小計都是公式而不是算好的數字 —— 在 Excel 裡把某個人的投入從 0.8
 * 改成 1,當下就要看得到總人月跟著動,不然改的人得自己心算。
 */

/** 名額欄位:ID(隱藏)、名額、單位、職能、負責人。月份從第 6 欄開始。 */
export const FIRST_MONTH_COL = 6;
export const SHEET_NAME = "manpower";
/** 每月人數那一列的標籤。表頭列數會因為里程碑類型多少而變動,匯入時就是
 *  靠找這個字串認出「名額從下一列開始」,不是靠固定的列號。 */
const HEADCOUNT_LABEL = "每月人數";
/** 第 1 列是月份,第 2 列是階段,每個里程碑類型各一列,最後是每月人數
 *  —— 名額從再下一列開始。沒有里程碑類型時就是舊有的第 4 列。 */
function firstSlotRow(milestoneTypeCount: number): number {
  return 4 + milestoneTypeCount;
}
/**
 * 小計放在另一張表。
 *
 * 放在名額下面的話,「名額那一段到哪裡結束」就得靠一列空白來判斷,而使用者
 * 在最後一列後面接著打字是再自然不過的事 —— 一接上去,小計那幾列就會被當成
 * 名額讀回來。分成兩張表之後,manpower 從第 4 列到最後一列都是名額,沒有
 * 需要猜的地方。
 */
export const SUMMARY_SHEET_NAME = "合計";

export type MilestoneRow = { typeId: string; name: string; startDate: string; endDate: string };
export type MilestoneTypeRow = { id: string; name: string };

export type LabourWorkbookInput = {
  boardName: string;
  months: MonthKey[];
  phases: PhaseRow[];
  slots: SlotRow[];
  units: OrgUnit[];
  /** 單位標準月薪,元/月。用來在表尾算金額。 */
  rates: { discipline: string; monthlySalary: number }[];
  /** 里程碑類型,照排序 —— 一個類型一列,列在階段列下面。 */
  milestoneTypes?: MilestoneTypeRow[];
  milestones?: MilestoneRow[];
};

/** 匯入讀出來的一列。fte 只放使用者真的填了的月份。 */
export type ParsedSlot = {
  /** 隱藏 ID 欄。空字串 = 這是使用者新加的列。 */
  id: string;
  label: string;
  discipline: string;
  func: string;
  ownerLabel: string;
  fte: Record<MonthKey, number>;
};

export type ParsedLabourWorkbook = {
  months: MonthKey[];
  slots: ParsedSlot[];
  /** 讀不懂而略過的格子,逐格說明 —— 匯入完要讓人知道哪裡沒收進去。 */
  warnings: string[];
};

const MONTH_KEY = /^\d{4}-\d{2}$/;

/** 使用者填的是數字,但小計欄是公式 —— 兩種都要讀得出來。 */
function numberOf(value: ExcelJS.CellValue): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === "object" && "result" in value) {
    return numberOf((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
  }
  return null;
}

function textOf(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as { text: string }[]).map((t) => t.text).join("").trim();
    }
    if ("result" in v) return textOf(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text).trim();
  }
  return "";
}

export async function buildLabourWorkbook(input: LabourWorkbookInput): Promise<Buffer> {
  const { months, phases, slots, units, rates, milestoneTypes = [], milestones = [] } = input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "工作管理平台";
  wb.created = new Date();
  const firstSlot = firstSlotRow(milestoneTypes.length);
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", xSplit: 5, ySplit: firstSlot - 1 }],
  });

  const lastMonthCol = FIRST_MONTH_COL + months.length - 1;
  const totalCol = lastMonthCol + 1;
  const letter = (col: number) => ws.getColumn(col).letter;
  const lastSlotRow = firstSlot + Math.max(slots.length, 1) - 1;

  ws.getColumn(1).width = 26;
  ws.getColumn(1).hidden = true;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 10;
  ws.getColumn(4).width = 16;
  ws.getColumn(5).width = 16;
  for (let c = FIRST_MONTH_COL; c <= totalCol; c++) ws.getColumn(c).width = 9;

  // 第 1 列:月份。匯入時靠這一列認欄位,所以寫的是 "YYYY-MM" 原字串,
  // 不是給人看的格式 —— 不然換個地區設定就對不起來了。
  const head = ws.getRow(1);
  head.values = ["ID(請勿更動)", "名額", "單位", "職能", "負責人", ...months, "合計(人月)"];
  head.font = { bold: true };

  // 第 2 列:這個月落在哪個階段。唯讀的參考資訊 —— 階段是在程式裡畫的。
  const phaseRow = ws.getRow(2);
  phaseRow.getCell(2).value = "階段";
  months.forEach((month, i) => {
    phaseRow.getCell(FIRST_MONTH_COL + i).value = phaseOfMonth(phases, month)?.name ?? "";
  });
  phaseRow.font = { italic: true, color: { argb: "FF808080" } };

  // 一個里程碑類型一列,列在階段列下面 —— 跟畫面上的排法一樣:同一類型
  // 排在同一排。哪個月要顯示哪個里程碑,用「這個月落在里程碑的起訖區間
  // 內」判斷,一個月裡有好幾個同類型的里程碑就用「/」接起來。
  milestoneTypes.forEach((type, typeIdx) => {
    const row = ws.getRow(3 + typeIdx);
    row.getCell(2).value = type.name;
    months.forEach((month, m) => {
      const names = milestones
        .filter((ms) => ms.typeId === type.id && ms.startDate.slice(0, 7) <= month && month <= ms.endDate.slice(0, 7))
        .map((ms) => ms.name);
      if (names.length > 0) row.getCell(FIRST_MONTH_COL + m).value = names.join(" / ");
    });
    row.font = { italic: true, color: { argb: "FF808080" } };
  });

  // 每月人數:每個月全部人加起來幾個人。公式,所以在 Excel 裡改一格就會動。
  const headcountRow = 3 + milestoneTypes.length;
  const headcount = ws.getRow(headcountRow);
  headcount.getCell(2).value = HEADCOUNT_LABEL;
  for (let c = FIRST_MONTH_COL; c <= totalCol; c++) {
    headcount.getCell(c).value = {
      formula: `SUM(${letter(c)}${firstSlot}:${letter(c)}${lastSlotRow})`,
    };
  }
  headcount.font = { bold: true };

  slots.forEach((slot, i) => {
    const row = ws.getRow(firstSlot + i);
    row.getCell(1).value = slot.id;
    row.getCell(2).value = slot.label;
    row.getCell(3).value = slot.discipline;
    row.getCell(4).value = slot.func;
    row.getCell(5).value = slot.ownerName;
    months.forEach((month, m) => {
      const fte = slot.months[month];
      if (fte !== undefined && fte !== 0) row.getCell(FIRST_MONTH_COL + m).value = fte;
    });
    row.getCell(totalCol).value = {
      formula: `SUM(${letter(FIRST_MONTH_COL)}${row.number}:${letter(lastMonthCol)}${row.number})`,
    };
  });

  // 一格最多 1 —— 程式裡擋得住,Excel 裡也要擋得住,不然改完才在匯入時
  // 被退回,人已經填了一整排。
  if (months.length > 0 && slots.length > 0) {
    for (let r = firstSlot; r <= lastSlotRow; r++) {
      for (let c = FIRST_MONTH_COL; c <= lastMonthCol; c++) {
        ws.getCell(r, c).dataValidation = {
          type: "decimal",
          operator: "between",
          formulae: [0, MAX_FTE],
          allowBlank: true,
          showErrorMessage: true,
          errorTitle: "投入超過 1",
          error: `一個名額一個月最多 ${MAX_FTE}(全職)。需要兩個人請開兩個名額。`,
        };
      }
    }
  }

  // 各單位人月與金額。公式而且跨表指回 manpower 的名額列 —— 在那邊改投入,
  // 這裡的錢當下就跟著變,那是拿這張表開會的人真正在看的數字。
  const rateOf = new Map(rates.map((r) => [r.discipline, r.monthlySalary]));
  const sum = wb.addWorksheet(SUMMARY_SHEET_NAME);
  sum.getColumn(1).width = 18;
  for (let c = 2; c <= 4; c++) sum.getColumn(c).width = 14;

  sum.getRow(1).values = ["單位", "人月", "月薪(元/月)", "金額(元)"];
  sum.getRow(1).font = { bold: true };

  units.forEach((unit, i) => {
    const row = sum.getRow(2 + i);
    const slotRows = slots
      .map((s, n) => (s.discipline === unit.code ? firstSlot + n : null))
      .filter((n): n is number => n !== null);
    row.getCell(1).value = unit.label ? `${unit.code}(${unit.label})` : unit.code;
    row.getCell(2).value =
      slotRows.length > 0
        ? { formula: slotRows.map((n) => `${SHEET_NAME}!${letter(totalCol)}${n}`).join("+") }
        : 0;
    row.getCell(3).value = rateOf.get(unit.code) ?? 0;
    row.getCell(4).value = { formula: `B${row.number}*C${row.number}` };
  });

  const totalRow = sum.getRow(2 + units.length);
  totalRow.getCell(1).value = "總計";
  totalRow.getCell(2).value = { formula: `SUM(B2:B${1 + units.length})` };
  totalRow.getCell(4).value = { formula: `SUM(D2:D${1 + units.length})` };
  totalRow.font = { bold: true };

  const note = sum.getRow(totalRow.number + 2);
  note.getCell(1).value =
    "改完存檔,回程式按「匯入 Excel」。manpower 第 A 欄的 ID 請勿更動或刪除 —— 沒有它就認不出是哪個名額。這張「合計」表只是算給人看的,匯入時不讀。";
  note.getCell(1).font = { italic: true, color: { argb: "FF808080" } };

  // exceljs 帶著自己那份舊的 @types/node,型別上的 Buffer 跟專案的對不起來;
  // 執行期拿到的是真的 Buffer。
  // @ts-expect-error - see comment above
  return (await wb.xlsx.writeBuffer()) as Buffer;
}

/**
 * 讀回一份匯出去改過的人力表。
 *
 * 只讀 manpower 的第 4 列起,一路讀到最後一列。名額空白的列跳過而不是停 ——
 * 使用者在中間留一列空白來分組是常見的排版習慣,遇到就停的話後面整段會
 * 無聲無息地掉光。「合計」那張表是算給人看的,不讀。
 */
export async function parseLabourWorkbook(buffer: Buffer): Promise<ParsedLabourWorkbook> {
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error - 同上,exceljs 的 Buffer 型別衝突
  await wb.xlsx.load(buffer);

  const ws = wb.getWorksheet(SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) throw new Error("這個檔案裡沒有工作表");

  const warnings: string[] = [];

  // 月份欄位照第 1 列的標題認,不照位置 —— 使用者在中間插一欄也還讀得對。
  const months: MonthKey[] = [];
  const monthCol = new Map<MonthKey, number>();
  const head = ws.getRow(1);
  for (let c = FIRST_MONTH_COL; c <= ws.columnCount; c++) {
    const text = textOf(head.getCell(c).value);
    if (!MONTH_KEY.test(text)) continue;
    if (monthCol.has(text)) {
      warnings.push(`月份 ${text} 出現不只一次,只收第一欄。`);
      continue;
    }
    months.push(text);
    monthCol.set(text, c);
  }
  if (months.length === 0) {
    throw new Error(
      "第 1 列找不到任何 YYYY-MM 的月份欄位。請用程式匯出的檔案來改,不要自己新建一份。"
    );
  }

  // 名額從「每月人數」那一列的下一列開始 —— 不是靠固定的列號,因為上面
  // 里程碑類型有幾排是可以變的。找不到就假設整張表都被改過表頭,不猜著讀。
  let headcountRow: number | null = null;
  for (let r = 2; r <= Math.min(ws.rowCount, 200); r++) {
    if (textOf(ws.getRow(r).getCell(2).value) === HEADCOUNT_LABEL) {
      headcountRow = r;
      break;
    }
  }
  if (headcountRow === null) {
    throw new Error(
      `第 B 欄找不到「${HEADCOUNT_LABEL}」那一列。請用程式匯出的檔案來改,不要自己新建一份。`
    );
  }

  const slots: ParsedSlot[] = [];
  const seenId = new Set<string>();
  for (let r = headcountRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const label = textOf(row.getCell(2).value);
    // 空白的一列就是排版用的空行,跳過。
    if (label === "") continue;

    const id = textOf(row.getCell(1).value);
    // 同一個 ID 出現兩次,多半是使用者複製整列來加名額而忘了清掉 A 欄。
    // 當成新名額處理 —— 兩列都寫回同一個名額的話,後面那列會蓋掉前面那列。
    const duplicate = id !== "" && seenId.has(id);
    if (duplicate) warnings.push(`第 ${r} 列的 ID 跟前面重複了,當成新名額處理。`);
    if (id !== "") seenId.add(id);

    const fte: Record<MonthKey, number> = {};
    for (const month of months) {
      const cell = row.getCell(monthCol.get(month)!);
      const raw = cell.value;
      if (raw === null || raw === undefined || raw === "") continue;
      const n = numberOf(raw);
      if (n === null) {
        warnings.push(`第 ${r} 列(${label})的 ${month} 填的不是數字,略過這一格。`);
        continue;
      }
      if (n < 0 || n > MAX_FTE) {
        warnings.push(
          `第 ${r} 列(${label})的 ${month} 是 ${n},超出 0~${MAX_FTE},略過這一格。`
        );
        continue;
      }
      if (n !== 0) fte[month] = Math.round(n * 100) / 100;
    }

    slots.push({
      id: duplicate ? "" : id,
      label,
      discipline: textOf(row.getCell(3).value),
      func: textOf(row.getCell(4).value),
      ownerLabel: textOf(row.getCell(5).value),
      fte,
    });
  }

  return { months, slots, warnings };
}
