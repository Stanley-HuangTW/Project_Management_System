import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { summariseBom, type BomLineInput } from "../bom";
import { BUILT_IN_BOM_COLUMNS } from "../bomColumns";
import { diffBoms } from "../bomDiff";
import { buildBomDiffWorkbook, changeText, DIFF_SHEET_NAME } from "./bomDiffWorkbook";

const line = (id: string, parentId: string | null, name: string, over: Partial<BomLineInput> = {}, order = 0): BomLineInput => ({
  id,
  parentId,
  name,
  vendor: "",
  partNumber: "",
  qty: 1,
  unitPrice: 0,
  currency: "TWD",
  fxRate: 1,
  note: "",
  deliveryDate: null,
  extra: {},
  order,
  ...over,
});

async function read(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.getWorksheet(DIFF_SHEET_NAME)!;
}

describe("buildBomDiffWorkbook", () => {
  const base = summariseBom([
    line("p", null, "電池模組", {}, 0),
    line("c", "p", "電芯", { partNumber: "CELL", qty: 14, unitPrice: 95, vendor: "Samsung" }, 0),
    line("o", null, "舊外殼", { partNumber: "OLD", unitPrice: 300 }, 1),
    line("k", null, "主機板", { partNumber: "MB", unitPrice: 1200 }, 2),
  ]).nodes;
  const target = summariseBom([
    line("p", null, "電池模組", {}, 0),
    line("c", "p", "電芯", { partNumber: "CELL", qty: 14, unitPrice: 120, vendor: "LG" }, 0),
    line("n", null, "新外殼", { partNumber: "NEW", unitPrice: 450 }, 1),
    line("k", null, "主機板", { partNumber: "MB", unitPrice: 1200 }, 2),
  ]).nodes;
  const diff = diffBoms(base, target, BUILT_IN_BOM_COLUMNS);

  it("變動內容一項一行", () => {
    const cell = diff.rows.find((r) => r.name === "電芯")!;
    expect(changeText(cell)).toBe("廠商:Samsung → LG\n單價:95 TWD → 120 TWD");
  });

  it("只列有變動的列與它們的上層,沒變的主機板不列;摘要與差額都對", async () => {
    const ws = await read(await buildBomDiffWorkbook({ boardName: "M3 專案", baseLabel: "M-100 / EVT", targetLabel: "M-100 / DVT", diff }));
    const cell = (r: number, c: number) => String(ws.getCell(r, c).value ?? "");
    expect(cell(1, 2)).toBe("M3 專案");
    expect(cell(2, 2)).toBe("M-100 / EVT");
    expect(cell(3, 2)).toBe("M-100 / DVT");
    // 基準 1330 + 300 + 1200 = 2830;對象 1680 + 450 + 1200 = 3330
    expect(cell(4, 2)).toContain("2830 → 3330");
    expect(cell(4, 2)).toContain("+500");
    expect(cell(5, 2)).toBe("新增 1、移除 1、修改 1");

    const headerRow = 7;
    expect(cell(headerRow, 1)).toBe("狀態");
    const rows: string[][] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) rows.push([cell(r, 1), cell(r, 3)]);
    expect(rows).toEqual([
      ["子項有變動", "電池模組"],
      ["修改", "電芯"],
      ["新增", "新外殼"],
      ["移除", "舊外殼"],
    ]);
    const cellRow = headerRow + 2;
    expect(ws.getCell(cellRow, 6).value).toBe(1330);
    expect(ws.getCell(cellRow, 7).value).toBe(1680);
    expect(ws.getCell(cellRow, 8).value).toBe(350);
    const added = headerRow + 3;
    expect(ws.getCell(added, 6).value).toBeNull();
    expect(ws.getCell(added, 8).value).toBe(450);
    const removed = headerRow + 4;
    expect(ws.getCell(removed, 7).value).toBeNull();
    expect(ws.getCell(removed, 8).value).toBe(-300);
  });

  it("沒有差異:寫一句話,不是空表", async () => {
    const same = diffBoms(base, base, BUILT_IN_BOM_COLUMNS);
    const ws = await read(await buildBomDiffWorkbook({ boardName: "B", baseLabel: "A", targetLabel: "A", diff: same }));
    expect(String(ws.getCell(8, 1).value)).toBe("兩份 BOM 沒有差異。");
  });
});
