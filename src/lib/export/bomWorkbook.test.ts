import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildBomWorkbook, parseBomWorkbook, SHEET_NAME, type BomWorkbookBlock } from "./bomWorkbook";
import { summariseBom, type BomLineInput } from "@/lib/bom";

/**
 * 匯出再匯入要拿回同一棵樹。跟人力表、樣機計畫那兩份 Excel 一樣,測的是
 * 往返,不是「有沒有產生檔案」。
 */

function block(product: string, phaseName: string, lines: BomLineInput[]): BomWorkbookBlock {
  return { product, phaseName, nodes: summariseBom(lines).nodes };
}

const m3EfsLines: BomLineInput[] = [
  {
    id: "mod",
    parentId: null,
    name: "主機板",
    vendor: "佳士達",
    partNumber: "PCB-001",
    qty: 1,
    unitPrice: 0,
    currency: "TWD",
    fxRate: 1,
    note: "",
    deliveryDate: null,
    order: 1,
  },
  {
    id: "mcu",
    parentId: "mod",
    name: "MCU 晶片",
    vendor: "TI",
    partNumber: "MSP430",
    qty: 2,
    unitPrice: 5,
    currency: "USD",
    fxRate: 32,
    note: "長供期",
    deliveryDate: "2026-11-01",
    order: 1,
  },
  {
    id: "screw",
    parentId: null,
    name: "螺絲 M3x8",
    vendor: "",
    partNumber: "",
    qty: 4,
    unitPrice: 0.5,
    currency: "TWD",
    fxRate: 1,
    note: "",
    deliveryDate: null,
    order: 2,
  },
];

function build(blocks: BomWorkbookBlock[]) {
  return buildBomWorkbook({ boardName: "M3專案", blocks });
}

async function open(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error - exceljs 帶著自己那份舊的 @types/node
  await wb.xlsx.load(buffer);
  return wb.getWorksheet(SHEET_NAME)!;
}

describe("樣機 BOM Excel 往返", () => {
  it("匯出再匯入,樹狀結構、單價、備註都一樣", async () => {
    const parsed = await parseBomWorkbook(await build([block("M3", "EFS", m3EfsLines)]));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.blocks).toHaveLength(1);

    const { product, phaseName, rows } = parsed.blocks[0];
    expect(product).toBe("M3");
    expect(phaseName).toBe("EFS");
    expect(rows.map((r) => r.name)).toEqual(["主機板", "MCU 晶片", "螺絲 M3x8"]);
    expect(rows[0].parentIndex).toBeNull();
    expect(rows[1]).toMatchObject({
      parentIndex: 0,
      vendor: "TI",
      partNumber: "MSP430",
      qty: 2,
      unitPrice: 5,
      currency: "USD",
      fxRate: 32,
      note: "長供期",
      deliveryDate: "2026-11-01",
    });
    expect(rows[2].parentIndex).toBeNull();
  });

  it("最後一行的操作說明不會被讀成一筆多出來的資料", async () => {
    // 迴歸測試:樣機計畫的 Excel 曾經因為小計/空白列沒有真的結束區塊,把
    // 最後那行操作說明讀成一筆假資料。這裡確認 BOM 的匯出檔案不會重蹈
    // 覆轍——匯出檔案最下面一定有這行說明,只有 1 個區塊、1 列才是對的。
    const parsed = await parseBomWorkbook(await build([block("M3", "EFS", m3EfsLines)]));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].rows).toHaveLength(3);
  });

  it("還原出來的樹算出跟原本一樣的單台價格", async () => {
    const parsed = await parseBomWorkbook(await build([block("M3", "EFS", m3EfsLines)]));
    const rows = parsed.blocks[0].rows;
    const asInput: BomLineInput[] = rows.map((r, i) => ({
      id: String(i),
      parentId: r.parentIndex === null ? null : String(r.parentIndex),
      name: r.name,
      vendor: r.vendor,
      partNumber: r.partNumber,
      qty: r.qty,
      unitPrice: r.unitPrice,
      currency: r.currency,
      fxRate: r.fxRate,
      note: r.note,
      deliveryDate: r.deliveryDate,
      order: i,
    }));
    // 原本:MCU 2*5*32=320,主機板(子集)=320;螺絲 4*0.5=2。單台 = 322。
    expect(summariseBom(asInput).unitCostTwd).toBe(322);
  });

  it("兩個(產品,階段)各自一個區塊", async () => {
    const parsed = await parseBomWorkbook(
      await build([
        block("M3", "EFS", m3EfsLines),
        block("充電站", "EVT", [
          {
            id: "a",
            parentId: null,
            name: "外殼",
            vendor: "",
            partNumber: "",
            qty: 1,
            unitPrice: 200,
            currency: "TWD",
            fxRate: 1,
            note: "",
            deliveryDate: null,
            order: 1,
          },
        ]),
      ])
    );
    expect(parsed.blocks.map((b) => `${b.product}/${b.phaseName}`)).toEqual(["M3/EFS", "充電站/EVT"]);
  });

  it("子集的單價欄位是公式,指到子項目的小計", async () => {
    const ws = await open(await build([block("M3", "EFS", m3EfsLines)]));
    // 第 1 列表頭,第 2 列欄位標題,第 3 列主機板,第 4 列 MCU 晶片。
    const priceFormula = ws.getCell(3, 9).value as { formula?: string };
    expect(priceFormula.formula).toBe("J4");
    const subtotalFormula = ws.getCell(3, 10).value as { formula?: string };
    expect(subtotalFormula.formula).toBe("I3*E3");
  });

  it("零件的單價欄位是公式,單價 × 匯率", async () => {
    const ws = await open(await build([block("M3", "EFS", m3EfsLines)]));
    const priceFormula = ws.getCell(4, 9).value as { formula?: string };
    expect(priceFormula.formula).toBe("F4*H4");
  });

  it("區塊表頭寫「BOM: 產品」,階段名稱在 B 欄", async () => {
    const ws = await open(await build([block("M3", "EFS", m3EfsLines)]));
    expect(ws.getCell(1, 1).value).toBe("BOM: M3");
    expect(ws.getCell(1, 2).value).toBe("EFS");
  });

  it("在 Excel 裡改階層,退回上一層再往下,重新對回正確的上層", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build([block("M3", "EFS", m3EfsLines)]));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    // 把螺絲(原本第 5 列,最上層)改成主機板的子項目(階層 1)。
    ws.getCell(5, 1).value = 1;
    // @ts-expect-error - 同上
    const parsed = await parseBomWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    const rows = parsed.blocks[0].rows;
    expect(rows[2].name).toBe("螺絲 M3x8");
    expect(rows[2].parentIndex).toBe(0);
  });

  it("數量不是正數的那一列略過,其他列照收", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build([block("M3", "EFS", m3EfsLines)]));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getCell(5, 5).value = 0; // 螺絲的數量
    // @ts-expect-error - 同上
    const parsed = await parseBomWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    expect(parsed.blocks[0].rows.map((r) => r.name)).toEqual(["主機板", "MCU 晶片"]);
    expect(parsed.warnings.join()).toContain("螺絲 M3x8");
  });

  it("幣別看不懂的那一列略過,並且講明是哪一筆", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build([block("M3", "EFS", m3EfsLines)]));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getCell(4, 7).value = "美金"; // MCU 晶片的幣別
    // @ts-expect-error - 同上
    const parsed = await parseBomWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    expect(parsed.blocks[0].rows.map((r) => r.name)).toEqual(["主機板", "螺絲 M3x8"]);
    expect(parsed.warnings.join()).toContain("MCU 晶片");
  });

  it("完全空白的一列結束這個區塊,不會把後面的雜訊讀成同一棵樹", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build([block("M3", "EFS", m3EfsLines)]));
    const ws = wb.getWorksheet(SHEET_NAME)!;
    // 在區塊中間(第 4 列, MCU 晶片)插入一列完全空白。
    ws.spliceRows(4, 0, []);
    // @ts-expect-error - 同上
    const parsed = await parseBomWorkbook((await wb.xlsx.writeBuffer()) as Buffer);
    // 區塊在空白列那裡就結束了,只收到「主機板」。
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].rows.map((r) => r.name)).toEqual(["主機板"]);
  });

  it("不是匯出來的檔案就明白拒絕,而不是收進一張空表", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("隨便一張表").getCell(1, 1).value = "hello";
    // @ts-expect-error - 同上
    const buffer = (await wb.xlsx.writeBuffer()) as Buffer;
    await expect(parseBomWorkbook(buffer)).rejects.toThrow("BOM: ");
  });

  it("沒有任何 BOM 時,匯出的檔案有格式範例可以照著填", async () => {
    const ws = await open(await build([]));
    const text = String(ws.getCell(1, 1).value ?? "");
    expect(text).toContain("BOM: 產品名稱");
  });
});

describe("自訂欄位(第 13 欄起)", () => {
  const custom = [
    { id: "c_status01", name: "驗證狀態", type: "SELECT" as const },
    { id: "c_buyer001", name: "採購負責人", type: "PERSON" as const },
    { id: "c_qty00001", name: "採購量", type: "NUMBER" as const },
    { id: "c_ok000001", name: "已簽核", type: "CHECKBOX" as const },
  ];
  const lines: BomLineInput[] = m3EfsLines.map((l) =>
    l.id === "mod"
      ? { ...l, extra: { c_status01: "已送樣", c_buyer001: "u1", c_qty00001: 500, c_ok000001: true } }
      : l.id === "mcu"
        ? { ...l, extra: { c_status01: "通過" } }
        : l
  );

  it("匯出:固定 12 欄後面接自訂欄位,標題是欄位名稱;人員寫姓名、勾選寫「是」、數字還是數字", async () => {
    const ws = await open(await buildBomWorkbook({ boardName: "M3專案", blocks: [block("M3", "EFS", lines)], customColumns: custom, userNames: new Map([["u1", "王小明"]]) }));
    const titles = ws.getRow(2).values as unknown[];
    expect(titles.slice(13)).toEqual(["驗證狀態", "採購負責人", "採購量", "已簽核"]);
    // 主機板是第一個資料列(第 3 列)
    const mod = ws.getRow(3);
    expect(mod.getCell(13).value).toBe("已送樣");
    expect(mod.getCell(14).value).toBe("王小明");
    expect(mod.getCell(15).value).toBe(500);
    expect(mod.getCell(16).value).toBe("是");
    expect(ws.getRow(4).getCell(13).value).toBe("通過"); // 子項目 MCU
    expect(ws.getRow(4).getCell(14).value).toBe(""); // 沒填的是空白
    expect(ws.getRow(4).getCell(16).value).toBe("");
  });

  it("匯出再匯入:標題與每一列的文字都帶回來(欄位代號對應由呼叫端依標題做)", async () => {
    const buffer = await buildBomWorkbook({ boardName: "M3專案", blocks: [block("M3", "EFS", lines)], customColumns: custom, userNames: new Map([["u1", "王小明"]]) });
    const parsed = await parseBomWorkbook(buffer);
    expect(parsed.blocks[0].extraHeaders).toEqual(["驗證狀態", "採購負責人", "採購量", "已簽核"]);
    const [mod, mcu, screw] = parsed.blocks[0].rows;
    expect(mod.extra).toEqual({ 驗證狀態: "已送樣", 採購負責人: "王小明", 採購量: "500", 已簽核: "是" });
    expect(mcu.extra).toEqual({ 驗證狀態: "通過", 採購負責人: "", 採購量: "", 已簽核: "" });
    expect(screw.extra).toEqual({ 驗證狀態: "", 採購負責人: "", 採購量: "", 已簽核: "" });
    // 固定欄位沒被動到
    expect(mcu).toMatchObject({ name: "MCU 晶片", vendor: "TI", qty: 2, unitPrice: 5, currency: "USD", fxRate: 32, deliveryDate: "2026-11-01" });
  });

  it("以前匯出的檔案(只有固定 12 欄)照樣匯得進來:沒有自訂欄位標題、列上也沒有 extra", async () => {
    const parsed = await parseBomWorkbook(await buildBomWorkbook({ boardName: "M3專案", blocks: [block("M3", "EFS", m3EfsLines)] }));
    expect(parsed.blocks[0].extraHeaders).toEqual([]);
    expect(parsed.blocks[0].rows.every((r) => r.extra === undefined)).toBe(true);
  });

  it("沒有自訂欄位的看板匯出:跟以前一樣只有 12 欄標題", async () => {
    const ws = await open(await buildBomWorkbook({ boardName: "M3專案", blocks: [block("M3", "EFS", m3EfsLines)] }));
    expect((ws.getRow(2).values as unknown[]).slice(1)).toHaveLength(12);
  });

  it("在 Excel 裡手打的日期(儲存格是日期型態)也讀得到", async () => {
    const buffer = await buildBomWorkbook({ boardName: "M3專案", blocks: [block("M3", "EFS", lines)], customColumns: [{ id: "c_due00001", name: "到貨日", type: "DATE" }] });
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - exceljs 帶著自己那份舊的 @types/node
    await wb.xlsx.load(buffer);
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getRow(3).getCell(13).value = new Date(Date.UTC(2026, 10, 30)); // 儲存格是真的日期,不是文字
    const parsed = await parseBomWorkbook((await wb.xlsx.writeBuffer()) as unknown as Buffer);
    expect(parsed.blocks[0].rows[0].extra).toEqual({ 到貨日: "2026-11-30" });
  });
});
