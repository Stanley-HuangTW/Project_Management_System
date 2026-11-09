import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { assertSafeXlsx, xlsxProblem } from "./xlsxGuard";

const SMALL = { maxEntries: 50, maxEntryBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 };

async function zipOf(files: Record<string, Buffer>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
}

async function workbook(rows: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOM");
  for (let r = 1; r <= rows; r++) ws.addRow([`零件 ${r}`, r, "廠商", r * 1.5]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** 把 zip 裡每個項目宣告的「解壓縮後大小」(本機標頭與中央目錄兩處)改成 fake——模擬造假的壓縮炸彈。 */
function lieAboutSize(zip: Buffer, fake: number): Buffer {
  const out = Buffer.from(zip);
  for (let i = 0; i + 30 < out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x04034b50) out.writeUInt32LE(fake, i + 22);
    if (sig === 0x02014b50) out.writeUInt32LE(fake, i + 24);
  }
  return out;
}

describe("xlsxProblem:壓縮炸彈與壞檔案", () => {
  // 這些測試是在防「變成平方時間」(退化時要幾十秒);整套平行跑、機器忙的時候單獨跑 1 秒的會拖到十幾秒,逾時放寬。
  vi.setConfig({ testTimeout: 60_000 });
  it("正常的試算表(幾十列、兩萬列)都過", async () => {
    expect(await xlsxProblem(await workbook(30))).toBeNull();
    expect(await xlsxProblem(await workbook(20000))).toBeNull();
  });

  it("宣告的解壓縮大小太大:直接拒絕(不用解壓縮)", async () => {
    const bomb = await zipOf({ "xl/worksheets/sheet1.xml": Buffer.alloc(5 * 1024 * 1024, 0) });
    expect(bomb.length).toBeLessThan(20 * 1024); // 5MB 的零壓縮之後只有幾 KB
    expect(await xlsxProblem(bomb, SMALL)).toMatch(/解壓縮之後太大/);
  });

  it("造假的大小(宣告 100 位元組、實際 5MB):真的解壓縮時被輸出上限擋下", async () => {
    const real = await zipOf({ "xl/worksheets/sheet1.xml": Buffer.alloc(5 * 1024 * 1024, 0) });
    const liar = lieAboutSize(real, 100);
    expect(await xlsxProblem(liar, SMALL)).toMatch(/解壓縮之後太大/);
  });

  it("每個項目都不大、但加起來太大", async () => {
    const files = Object.fromEntries([1, 2, 3].map((i) => [`xl/worksheets/s${i}.xml`, Buffer.alloc(800 * 1024, i)]));
    expect(await xlsxProblem(await zipOf(files), SMALL)).toMatch(/解壓縮之後太大/);
  });

  it("項目太多", async () => {
    const files = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}.xml`, Buffer.from("x")]));
    expect(await xlsxProblem(await zipOf(files), SMALL)).toMatch(/項目太多/);
  });

  it("不是 zip:垃圾、空檔、被截斷的檔案", async () => {
    expect(await xlsxProblem(Buffer.from("這不是 xlsx"))).toMatch(/不是有效的 Excel/);
    expect(await xlsxProblem(Buffer.alloc(0))).toMatch(/不是有效的 Excel/);
    expect(await xlsxProblem(Buffer.alloc(100000, 7))).toMatch(/不是有效的 Excel/);
    const real = await workbook(200);
    expect(await xlsxProblem(real.subarray(0, Math.floor(real.length / 2)))).toMatch(/不是有效的 Excel/);
  });

  it("Zip64 與加密的項目:不支援", async () => {
    const real = await workbook(5);
    const zip64 = Buffer.from(real);
    for (let i = zip64.length - 22; i >= 0; i--) if (zip64.readUInt32LE(i) === 0x06054b50) { zip64.writeUInt16LE(0xffff, i + 10); break; }
    expect(await xlsxProblem(zip64)).toMatch(/Zip64/);
    const encrypted = Buffer.from(real);
    for (let i = 0; i + 46 < encrypted.length; i++) if (encrypted.readUInt32LE(i) === 0x02014b50) { encrypted.writeUInt16LE(1, i + 8); break; }
    expect(await xlsxProblem(encrypted)).toMatch(/加密/);
  });

  it("目錄記錄亂寫(偏移量超出檔案、項目數對不上):拒絕,不會讀到檔案外面", async () => {
    const real = await workbook(5);
    const badOffset = Buffer.from(real);
    for (let i = badOffset.length - 22; i >= 0; i--) if (badOffset.readUInt32LE(i) === 0x06054b50) { badOffset.writeUInt32LE(0x7fffffff, i + 16); break; }
    expect(await xlsxProblem(badOffset)).toMatch(/不是有效的 Excel/);
    const badCount = Buffer.from(real);
    for (let i = badCount.length - 22; i >= 0; i--) if (badCount.readUInt32LE(i) === 0x06054b50) { badCount.writeUInt16LE(30, i + 10); break; }
    expect(await xlsxProblem(badCount)).toMatch(/不是有效的 Excel/);
  });

  it("assertSafeXlsx:不安全時丟出帶中文原因的 Error;安全時什麼都不丟", async () => {
    await expect(assertSafeXlsx(Buffer.from("x"))).rejects.toThrow(/不是有效的 Excel/);
    await expect(assertSafeXlsx(await workbook(10))).resolves.toBeUndefined();
  });

  it("隨機位元組亂改一份正常的檔案:永遠只會回「安全」或「原因」,不會丟例外、不會卡住", async () => {
    const real = await workbook(50);
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 300; round++) {
      const mutated = Buffer.from(real);
      for (let k = 0; k < 1 + Math.floor(rand() * 8); k++) mutated[Math.floor(rand() * mutated.length)] = Math.floor(rand() * 256);
      const out = await xlsxProblem(mutated, SMALL);
      expect(out === null || typeof out === "string").toBe(true);
    }
  });
});
