import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { NRE_SHEET_NAME, buildNreWorkbook, type NreWorkbookLine } from "./nreWorkbook";

const line = (overrides: Partial<NreWorkbookLine> = {}): NreWorkbookLine => ({
  category: "TOOLING",
  description: "外殼塑膠射出鋼模",
  basis: "",
  vendor: "",
  quantity: null,
  unitPrice: null,
  amount: 550000,
  note: "",
  ...overrides,
});

async function build(lines: NreWorkbookLine[]) {
  const buffer = await buildNreWorkbook({ boardName: "示範專案 M-100", phaseName: "POC", exportedOn: "2026-10-08", lines });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet(NRE_SHEET_NAME)!;
}

/** 標題兩列(合併儲存格)以下,每一列第 1 欄與第 2 欄的文字,方便看出版面順序。 */
function outline(ws: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return;
    const a = String(row.getCell(1).text ?? "");
    const b = String(row.getCell(2).text ?? "");
    if (a || b) out.push(`${a}|${b}`);
  });
  return out;
}

describe("buildNreWorkbook", () => {
  const sample: NreWorkbookLine[] = [
    line({ category: "LABOUR", description: "機構 / 電路設計", basis: "3 位工程師 × 3 個月", vendor: "弘泰工程", quantity: 500, unitPrice: 800, amount: 400000, note: "依專案複雜度調整" }),
    line({ category: "TOOLING", description: "外殼塑膠射出鋼模", amount: 550000 }),
    line({ category: "TOOLING", description: "組裝治具與電測夾具", quantity: 2, unitPrice: 30000, amount: 60000 }),
    line({ category: "CERTIFICATION", description: "法規安規認證(CE / FCC)", amount: 140000 }),
  ];

  it("標題、匯出日期與幣別說明", async () => {
    const ws = await build(sample);
    expect(ws.getCell(1, 1).text).toBe("示範專案 M-100 POC NRE 報價單");
    expect(ws.getCell(2, 1).text).toContain("2026-10-08");
    expect(ws.getCell(2, 1).text).toContain("新台幣");
  });

  it("每一類一個區塊:表頭、明細、小計;最後是總計;沒有項目的類別整塊省略", async () => {
    const ws = await build(sample);
    expect(outline(ws)).toEqual([
      "研發人力工時|細項說明",
      "|機構 / 電路設計",
      "小計|",
      "模具與治具|細項說明",
      "|外殼塑膠射出鋼模",
      "|組裝治具與電測夾具",
      "小計|",
      "驗證與認證|細項說明",
      "|法規安規認證(CE / FCC)",
      "小計|",
      "NRE 總計|",
    ]);
    expect(outline(ws).some((l) => l.startsWith("打樣與樣品"))).toBe(false);
  });

  it("研發人力的表頭是外部單位 / 人員、工時、時薪", async () => {
    const ws = await build(sample);
    // 區塊表頭在第 4 列。
    const header = [1, 2, 3, 4, 5, 6, 7, 8].map((c) => ws.getCell(4, c).text);
    expect(header).toEqual(["研發人力工時", "細項說明", "估算基礎", "外部單位 / 人員", "工時(小時)", "時薪(元)", "金額(元)", "備註"]);
  });

  it("數量 × 單價的金額是公式(附算好的值);直接填的金額就是數字", async () => {
    const ws = await build(sample);
    const labour = ws.getCell(5, 7).value as ExcelJS.CellFormulaValue;
    expect(labour.formula).toBe("ROUND(E5*F5,0)");
    expect(labour.result).toBe(400000);
    expect(ws.getCell(5, 5).value).toBe(500);
    expect(ws.getCell(5, 6).value).toBe(800);
    expect(ws.getCell(5, 3).text).toBe("3 位工程師 × 3 個月");
    expect(ws.getCell(5, 4).text).toBe("弘泰工程");
    expect(ws.getCell(5, 8).text).toBe("依專案複雜度調整");
    // 模具那兩列:第一列直接填的金額(7 欄是數字),第二列是 2 × 30,000 的公式。
    expect(typeof ws.getCell(9, 7).value).toBe("number");
    expect((ws.getCell(10, 7).value as ExcelJS.CellFormulaValue).result).toBe(60000);
  });

  it("每類小計與總計是公式,結果對得上(你貼的範例的算法)", async () => {
    const ws = await build(sample);
    const subtotalOf = (row: number) => ws.getCell(row, 7).value as ExcelJS.CellFormulaValue;
    expect(subtotalOf(6).result).toBe(400000);
    expect(subtotalOf(6).formula).toBe("SUM(G5:G5)");
    expect(subtotalOf(11).result).toBe(610000);
    expect(subtotalOf(11).formula).toBe("SUM(G9:G10)");
    let total: ExcelJS.CellFormulaValue | undefined;
    ws.eachRow((row) => {
      if (row.getCell(1).text === "NRE 總計") total = row.getCell(7).value as ExcelJS.CellFormulaValue;
    });
    expect(total?.result).toBe(1150000);
    expect(total?.formula).toMatch(/^SUM\(G6,G11,G\d+\)$/);
  });

  it("沒有任何項目:只有標題與總計 0,不會壞掉", async () => {
    const ws = await build([]);
    expect(outline(ws).some((l) => l.startsWith("NRE 總計"))).toBe(true);
    let total: ExcelJS.CellValue = null;
    ws.eachRow((row) => {
      if (row.getCell(1).text === "NRE 總計") total = row.getCell(7).value;
    });
    expect(total).toBe(0);
  });

  it("數量是 0 或單價缺一個時,金額就是填的數字,不寫公式", async () => {
    const ws = await build([
      line({ description: "數量 0", quantity: 0, unitPrice: 30000, amount: 1234 }),
      line({ description: "沒單價", quantity: 2, unitPrice: null, amount: 5678 }),
    ]);
    expect(ws.getCell(5, 7).value).toBe(1234);
    expect(ws.getCell(6, 7).value).toBe(5678);
  });
});
