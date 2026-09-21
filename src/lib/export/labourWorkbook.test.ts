import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  buildLabourWorkbook,
  parseLabourWorkbook,
  SHEET_NAME,
  SUMMARY_SHEET_NAME,
} from "./labourWorkbook";
import type { PhaseRow, SlotRow } from "@/lib/labourSheet";

/**
 * 匯出再匯入要拿回同一張表。
 *
 * 這是這個檔案唯一真正要保證的事:中間那一趟 Excel 不能把資料弄丟或弄錯。
 * 所以測的是往返,不是「有沒有產生檔案」。
 */

const phases: PhaseRow[] = [
  { id: "p1", name: "EFS", startDate: "2026-03-01", endDate: "2026-05-31", itemId: "i1" },
  { id: "p2", name: "EVT", startDate: "2026-06-01", endDate: "2026-07-31", itemId: null },
];

const slots: SlotRow[] = [
  {
    id: "s1",
    discipline: "EE",
    label: "EE1 (DM)",
    func: "EEDM",
    userId: null,
    ownerName: "TBH",
    description: "",
    months: { "2026-03": 1, "2026-04": 0.8, "2026-06": 0.5 },
  },
  {
    id: "s2",
    discipline: "SW",
    label: "SW1",
    func: "driver",
    userId: "u1",
    ownerName: "王小明",
    description: "",
    months: { "2026-05": 0.25 },
  },
];

const units = [
  { code: "EE", label: "電子", order: 1 },
  { code: "SW", label: "軟體", order: 2 },
];

const rates = [
  { discipline: "EE", monthlySalary: 100000 },
  { discipline: "SW", monthlySalary: 90000 },
];

const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];

function build() {
  return buildLabourWorkbook({ boardName: "M3專案", months, phases, slots, units, rates });
}

async function open(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  // @ts-expect-error - exceljs 帶著自己那份舊的 @types/node
  await wb.xlsx.load(buffer);
  return wb.getWorksheet(SHEET_NAME)!;
}

describe("人力表 Excel 往返", () => {
  it("匯出再匯入,名額與逐月投入一模一樣", async () => {
    const parsed = await parseLabourWorkbook(await build());

    expect(parsed.months).toEqual(months);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.slots).toEqual([
      {
        id: "s1",
        label: "EE1 (DM)",
        discipline: "EE",
        func: "EEDM",
        ownerLabel: "TBH",
        fte: { "2026-03": 1, "2026-04": 0.8, "2026-06": 0.5 },
      },
      {
        id: "s2",
        label: "SW1",
        discipline: "SW",
        func: "driver",
        ownerLabel: "王小明",
        fte: { "2026-05": 0.25 },
      },
    ]);
  });

  it("沒填的月份不會變成 0,而是根本不出現", async () => {
    const parsed = await parseLabourWorkbook(await build());
    expect(Object.keys(parsed.slots[1].fte)).toEqual(["2026-05"]);
  });

  it("在 Excel 裡改過的值收得回來", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const ws = wb.getWorksheet(SHEET_NAME)!;
    // 第 4 列是第一個名額,第 6 欄是 2026-03。
    ws.getCell(4, 6).value = 0.5;
    // 清掉一格 = 那個月沒有了。
    ws.getCell(4, 7).value = null;
    // @ts-expect-error - 同上
    const parsed = await parseLabourWorkbook((await wb.xlsx.writeBuffer()) as Buffer);

    expect(parsed.slots[0].fte).toEqual({ "2026-03": 0.5, "2026-06": 0.5 });
  });

  it("自己加的一列沒有 ID,匯入時當新名額", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const ws = wb.getWorksheet(SHEET_NAME)!;
    const row = ws.getRow(6);
    row.getCell(2).value = "EE2";
    row.getCell(3).value = "EE";
    row.getCell(4).value = "layout";
    row.getCell(5).value = "TBH";
    row.getCell(6).value = 1;
    // @ts-expect-error - 同上
    const parsed = await parseLabourWorkbook((await wb.xlsx.writeBuffer()) as Buffer);

    expect(parsed.slots).toHaveLength(3);
    expect(parsed.slots[2]).toMatchObject({ id: "", label: "EE2", fte: { "2026-03": 1 } });
  });

  it("超過 1 的投入不收,而且講明是哪一格", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getCell(4, 6).value = 2;
    // @ts-expect-error - 同上
    const parsed = await parseLabourWorkbook((await wb.xlsx.writeBuffer()) as Buffer);

    expect(parsed.slots[0].fte["2026-03"]).toBeUndefined();
    expect(parsed.warnings.join()).toContain("2026-03");
  });

  it("填了文字的格子略過,整列其他月份照收", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const ws = wb.getWorksheet(SHEET_NAME)!;
    ws.getCell(4, 6).value = "半個人";
    // @ts-expect-error - 同上
    const parsed = await parseLabourWorkbook((await wb.xlsx.writeBuffer()) as Buffer);

    expect(parsed.slots[0].fte).toEqual({ "2026-04": 0.8, "2026-06": 0.5 });
    expect(parsed.warnings.join()).toContain("不是數字");
  });

  it("ID 重複的列當成新名額,不會蓋掉原本那一個", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const ws = wb.getWorksheet(SHEET_NAME)!;
    const row = ws.getRow(6);
    row.getCell(1).value = "s1";
    row.getCell(2).value = "EE1 複製";
    row.getCell(3).value = "EE";
    // @ts-expect-error - 同上
    const parsed = await parseLabourWorkbook((await wb.xlsx.writeBuffer()) as Buffer);

    expect(parsed.slots[0].id).toBe("s1");
    expect(parsed.slots[2].id).toBe("");
    expect(parsed.warnings.join()).toContain("重複");
  });

  it("中間留一列空白當分隔,後面的名額照樣讀得到", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const ws = wb.getWorksheet(SHEET_NAME)!;
    const row = ws.getRow(7);
    row.getCell(2).value = "QA1";
    row.getCell(3).value = "EE";
    row.getCell(6).value = 0.3;
    // @ts-expect-error - 同上
    const parsed = await parseLabourWorkbook((await wb.xlsx.writeBuffer()) as Buffer);

    expect(parsed.slots.map((s) => s.label)).toEqual(["EE1 (DM)", "SW1", "QA1"]);
  });

  it("小計在另一張表,不會被當成名額讀進來", async () => {
    const parsed = await parseLabourWorkbook(await build());
    expect(parsed.slots.map((s) => s.label)).toEqual(["EE1 (DM)", "SW1"]);
  });

  it("不是匯出來的檔案就明白拒絕,而不是收進一張空表", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("隨便一張表").getCell(1, 1).value = "hello";
    // @ts-expect-error - 同上
    const buffer = (await wb.xlsx.writeBuffer()) as Buffer;
    await expect(parseLabourWorkbook(buffer)).rejects.toThrow("月份欄位");
  });

  it("月份與階段寫在表頭上,看的人知道哪個月算哪一段", async () => {
    const ws = await open(await build());
    expect(ws.getCell(1, 6).value).toBe("2026-03");
    expect(ws.getCell(2, 6).value).toBe("EFS");
    expect(ws.getCell(2, 9).value).toBe("EVT");
  });

  it("小計是公式,不是算好的數字 —— 在 Excel 裡改一格就要跟著動", async () => {
    const ws = await open(await build());
    const total = ws.getCell(4, 11).value as { formula?: string };
    expect(total.formula).toContain("SUM");
    const headcount = ws.getCell(3, 6).value as { formula?: string };
    expect(headcount.formula).toContain("SUM");
  });

  it("合計表的人月跨表指回 manpower,金額 = 人月 × 月薪", async () => {
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - 同上
    await wb.xlsx.load(await build());
    const sum = wb.getWorksheet(SUMMARY_SHEET_NAME)!;
    expect((sum.getCell(2, 2).value as { formula?: string }).formula).toContain("manpower!");
    expect(sum.getCell(2, 3).value).toBe(100000);
    expect((sum.getCell(2, 4).value as { formula?: string }).formula).toBe("B2*C2");
  });
});
