import { describe, expect, it } from "vitest";
import { MAX_PASTED_BOM_ROWS, parseBomPaste } from "./bomPaste";

const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n") + "\n";

describe("parseBomPaste:沒有表頭,照畫面的欄位順序", () => {
  it("名稱、廠商、型號、數量、單價、幣別、匯率、交期、備註", () => {
    const out = parseBomPaste(tsv([["主控板", "華創", "MB-01", "2", "5,000", "TWD", "", "2026/10/8", "急件"]]));
    expect(out.hadHeader).toBe(false);
    expect(out.warnings).toEqual([]);
    expect(out.rows).toEqual([
      { depth: 0, name: "主控板", vendor: "華創", partNumber: "MB-01", qty: 2, unitPrice: 5000, currency: "TWD", fxRate: 1, deliveryDate: "2026-10-08", note: "急件", sourceRow: 1 },
    ]);
  });

  it("只貼名稱、數量、單價也可以,其餘用預設(數量 1、單價 0、幣別 TWD)", () => {
    const out = parseBomPaste("電池\t\t\t\t\n外殼\n");
    expect(out.rows.map((r) => [r.name, r.qty, r.unitPrice, r.currency])).toEqual([["電池", 1, 0, "TWD"], ["外殼", 1, 0, "TWD"]]);
  });

  it("金額寫法:NT$1,250、$ 12.5、300 元", () => {
    const out = parseBomPaste(tsv([["a", "", "", "1", "NT$1,250"], ["b", "", "", "1", "$ 12.5", "USD", "31.5"], ["c", "", "", "1", "300 元"]]));
    expect(out.rows.map((r) => r.unitPrice)).toEqual([1250, 12.5, 300]);
    expect(out.rows[1]).toMatchObject({ currency: "USD", fxRate: 31.5 });
  });

  it("外幣沒填匯率:fxRate 是 null(伺服器用目前的匯率補);台幣一律 1", () => {
    const out = parseBomPaste(tsv([["a", "", "", "1", "10", "USD"], ["b", "", "", "1", "10", "TWD", "99"]]));
    expect(out.rows[0].fxRate).toBeNull();
    expect(out.rows[1].fxRate).toBe(1);
  });

  it("名稱前面縮排(每兩個空白一層)就是子項目", () => {
    const out = parseBomPaste("電池模組\n  電芯\n  保護板\n    晶片\n外殼\n");
    expect(out.rows.map((r) => [r.name, r.depth])).toEqual([["電池模組", 0], ["電芯", 1], ["保護板", 1], ["晶片", 2], ["外殼", 0]]);
  });

  it("縮排跳太多也只會比上一列深一層,不會冒出沒有上層的子項目", () => {
    const out = parseBomPaste("      孤兒\n");
    expect(out.rows[0].depth).toBe(0);
    expect(parseBomPaste("a\n        b\n").rows.map((r) => r.depth)).toEqual([0, 1]);
  });
});

describe("parseBomPaste:有表頭,照表頭的字找欄位", () => {
  it("順序不拘、多的欄位(小計)忽略", () => {
    const out = parseBomPaste(tsv([["單價", "名稱", "小計", "數量", "廠商"], ["100", "螺絲", "300", "3", "五金行"]]));
    expect(out.hadHeader).toBe(true);
    expect(out.rows).toEqual([
      { depth: 0, name: "螺絲", vendor: "五金行", partNumber: "", qty: 3, unitPrice: 100, currency: "TWD", fxRate: 1, deliveryDate: null, note: "", sourceRow: 2 },
    ]);
  });

  it("英文表頭也認得", () => {
    const out = parseBomPaste(tsv([["Name", "Vendor", "P/N", "Qty", "Unit Price", "Currency"], ["PCB", "ACME", "P-1", "5", "2.5", "usd"]]));
    expect(out.rows[0]).toMatchObject({ name: "PCB", vendor: "ACME", partNumber: "P-1", qty: 5, unitPrice: 2.5, currency: "USD" });
  });

  it("「階層」欄決定上下層;從 1 起算的表整體往上提", () => {
    const out = parseBomPaste(tsv([["階層", "名稱"], ["1", "電池模組"], ["2", "電芯"], ["1", "外殼"]]));
    expect(out.rows.map((r) => [r.name, r.depth])).toEqual([["電池模組", 0], ["電芯", 1], ["外殼", 0]]);
  });

  it("表頭裡沒有名稱:說明錯誤", () => {
    expect(parseBomPaste(tsv([["廠商", "單價"], ["a", "1"]])).error).toContain("名稱");
  });
});

describe("parseBomPaste:有問題的列整列略過並說明,其他列照貼", () => {
  it("沒有名稱、數量不是正數、單價是負的、幣別不對、匯率是 0", () => {
    const out = parseBomPaste(
      tsv([
        ["好的", "", "", "1", "10"],
        ["", "廠商", "", "1", "10"],
        ["數量零", "", "", "0", "10"],
        ["數量字", "", "", "abc", "10"],
        ["負價", "", "", "1", "-5"],
        ["壞幣別", "", "", "1", "10", "美金"],
        ["零匯率", "", "", "1", "10", "USD", "0"],
      ])
    );
    expect(out.rows.map((r) => r.name)).toEqual(["好的"]);
    expect(out.warnings).toHaveLength(6);
    expect(out.warnings[0]).toContain("第 2 列沒有名稱");
    expect(out.warnings[1]).toContain("「數量零」的數量");
    expect(out.warnings[3]).toContain("「負價」的單價");
    expect(out.warnings[4]).toContain("幣別");
    expect(out.warnings[5]).toContain("匯率");
  });

  it("交期格式不對:這一欄留空,整列仍貼", () => {
    const out = parseBomPaste(tsv([["a", "", "", "1", "10", "TWD", "", "下個月"]]));
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].deliveryDate).toBeNull();
    expect(out.warnings[0]).toContain("交期");
  });

  it("空白列與底下的小計 / 合計列不算", () => {
    const out = parseBomPaste("a\t\t\t1\t10\n\n單台成本\t\t\t\t10\n合計\n");
    expect(out.rows.map((r) => r.name)).toEqual(["a"]);
    expect(out.warnings).toEqual([]);
  });

  it("什麼都沒有:說明錯誤", () => {
    expect(parseBomPaste("").error).toContain("沒有內容");
    expect(parseBomPaste("\n\t\n").error).toContain("沒有內容");
  });

  it("太多列:整份不貼,說明上限", () => {
    const out = parseBomPaste(Array.from({ length: MAX_PASTED_BOM_ROWS + 1 }, (_, i) => `料${i}`).join("\n"));
    expect(out.error).toContain(String(MAX_PASTED_BOM_ROWS));
    expect(out.rows).toEqual([]);
  });
});
