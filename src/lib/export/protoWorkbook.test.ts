import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildProtoWorkbook, parseProtoWorkbook, SHEET_NAME } from "./protoWorkbook";
import { summariseProtoPlan, type ProtoCell } from "@/lib/protoPlan";

/**
 * 匯出再匯入要拿回同一張表。跟人力表那份 Excel 一樣,測的是往返,不是
 * 「有沒有產生檔案」。
 */

const phases = [
  { id: "p1", name: "EVT" },
  { id: "p2", name: "DVT1" },
  { id: "p3", name: "DVT2" },
];

const m3Cells: ProtoCell[] = [
  { product: "M3", unit: "HW-EE", phaseId: "p2", qty: 1, note: "" },
  { product: "M3", unit: "HW-ME", phaseId: "p1", qty: 1, note: "mock up" },
  { product: "M3", unit: "HW-ME", phaseId: "p2", qty: 1, note: "" },
  { product: "M3", unit: "SW", phaseId: "p1", qty: 2, note: "mock up" },
  { product: "M3", unit: "SW", phaseId: "p3", qty: 4, note: "" },
];

const chargerCells: ProtoCell[] = [
  { product: "充電站", unit: "HW-EE", phaseId: "p3", qty: 1, note: "" },
];

function build(cells: ProtoCell[]) {
  const summary = summariseProtoPlan(
    phases.map((p) => p.id),
    cells
  );
  return buildProtoWorkbook({ boardName: "M3專案", phases, summary });
}

async function open(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error - exceljs 帶著自己那份舊的 @types/node
  await wb.xlsx.load(buffer);
  return wb.getWorksheet(SHEET_NAME)!;
}

describe("樣機計畫 Excel 往返", () => {
  it("匯出再匯入,每一格的台數與備註都一樣", async () => {
    const parsed = await parseProtoWorkbook(await build(m3Cells));
    expect(parsed.warnings).toEqual([]);

    const key = (c: { product: string; unit: string; phaseName: string }) =>
      `${c.product}/${c.unit}/${c.phaseName}`;
    const byKey = new Map(parsed.cells.map((c) => [key(c), c]));

    expect(byKey.get("M3/HW-EE/DVT1")).toMatchObject({ qty: 1, note: "" });
    expect(byKey.get("M3/HW-ME/EVT")).toMatchObject({ qty: 1, note: "mock up" });
    expect(byKey.get("M3/SW/EVT")).toMatchObject({ qty: 2, note: "mock up" });
    expect(byKey.get("M3/SW/DVT2")).toMatchObject({ qty: 4, note: "" });
  });

  it("沒填的格子也讀得到,值是 0——0 是存起來的答案,不是沒填", async () => {
    const parsed = await parseProtoWorkbook(await build(m3Cells));
    const cell = parsed.cells.find((c) => c.product === "M3" && c.unit === "HW-EE" && c.phaseName === "EVT");
    expect(cell).toMatchObject({ qty: 0 });
  });

  it("兩個產品各自一個區塊", async () => {
    const parsed = await parseProtoWorkbook(await build([...m3Cells, ...chargerCells]));
    const products = new Set(parsed.cells.map((c) => c.product));
    expect(products).toEqual(new Set(["M3", "充電站"]));
    const charger = parsed.cells.find((c) => c.product === "充電站" && c.phaseName === "DVT2");
    expect(charger).toMatchObject({ qty: 1 });
  });

  it("區塊之間的空白列只是排版,不會被讀成資料或搞混區塊", async () => {
    const ws = await open(await build([...m3Cells, ...chargerCells]));
    // 找到第二個區塊表頭,確認它上面確實有一列完全空白。
    let secondHeaderRow = -1;
    for (let r = 1; r <= ws.rowCount; r++) {
      if (String(ws.getCell(r, 1).value ?? "").startsWith("充電站")) {
        secondHeaderRow = r;
        break;
      }
    }
    expect(secondHeaderRow).toBeGreaterThan(1);
    const blank = ws.getRow(secondHeaderRow - 1);
    expect(String(blank.getCell(1).value ?? "")).toBe("");
  });

  it("同一區塊裡欄位順序打亂,靠表頭文字認,不是靠位置", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build(m3Cells));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    // 第 1 列是 M3 的表頭:A1="M3 Proto Plan", B1=EVT, C1=DVT1, D1=DVT2。
    // 把 DVT1 跟 DVT2 對調欄位。
    const b1 = ws.getCell(1, 3).value;
    ws.getCell(1, 3).value = ws.getCell(1, 4).value;
    ws.getCell(1, 4).value = b1;
    const c = ws.getCell(2, 3).value;
    ws.getCell(2, 3).value = ws.getCell(2, 4).value;
    ws.getCell(2, 4).value = c;
    // @ts-expect-error - 同上
    const parsed = await parseProtoWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    const cell = parsed.cells.find((x) => x.product === "M3" && x.unit === "HW-EE" && x.phaseName === "DVT1");
    expect(cell?.qty).toBe(1);
  });

  it("小計是公式,讀進來的時候會被跳過,不會混進資料", async () => {
    const parsed = await parseProtoWorkbook(await build(m3Cells));
    expect(parsed.cells.some((c) => c.unit === "小計")).toBe(false);
  });

  it("小計公式的範圍只涵蓋這個產品自己的用途單位列", async () => {
    const ws = await open(await build([...m3Cells, ...chargerCells]));
    // M3 有 3 個用途單位(HW-EE、HW-ME、SW),表頭在第 1 列,小計理應在第 5 列。
    const sub = ws.getCell(5, 2).value as { formula?: string };
    expect(sub.formula).toBe("SUM(B2:B4)");
  });

  it("表頭列出現在任何區塊之前的雜訊列,講清楚是哪一列並略過", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAME);
    ws.getCell(1, 1).value = "亂打的一列";
    ws.getCell(2, 1).value = "M3 Proto Plan";
    ws.getCell(2, 2).value = "EVT";
    ws.getCell(3, 1).value = "HW-EE";
    ws.getCell(3, 2).value = 1;
    // @ts-expect-error - 同上
    const parsed = await parseProtoWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    expect(parsed.warnings.join()).toContain("亂打的一列");
    expect(parsed.cells).toEqual([{ product: "M3", unit: "HW-EE", phaseName: "EVT", qty: 1, note: "" }]);
  });

  it("填了文字的格子略過,並且講明是哪一格", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build(m3Cells));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getCell(2, 2).value = "兩台"; // HW-EE 的 EVT 欄
    // @ts-expect-error - 同上
    const parsed = await parseProtoWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    expect(parsed.warnings.join()).toContain("不是數字");
    expect(parsed.cells.some((c) => c.unit === "HW-EE" && c.phaseName === "EVT")).toBe(false);
  });

  it("超出 0~9999 或不是整數的台數不收,講明是哪一格", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build(m3Cells));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getCell(2, 2).value = 1.5;
    // @ts-expect-error - 同上
    const parsed = await parseProtoWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    expect(parsed.warnings.join()).toContain("0~9999 的整數");
  });

  it("完全沒有樣機計畫時,匯出的檔案有格式範例可以照著填", async () => {
    const summary = summariseProtoPlan(
      phases.map((p) => p.id),
      []
    );
    const ws = await open(await buildProtoWorkbook({ boardName: "M3專案", phases, summary }));
    expect(String(ws.getCell(1, 1).value)).toContain("Proto Plan");
  });

  it("不是匯出來的檔案就明白拒絕,而不是收進一張空表", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("隨便一張表").getCell(1, 1).value = "hello";
    // @ts-expect-error - 同上
    const buffer = (await wb.xlsx.writeBuffer()) as Buffer;
    await expect(parseProtoWorkbook(buffer)).rejects.toThrow("Proto Plan");
  });
});
