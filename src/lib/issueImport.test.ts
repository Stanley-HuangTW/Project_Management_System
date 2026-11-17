import { describe, expect, it } from "vitest";
import { cellText, parseDate, parseIssueSheet, splitUnits, usableCaseNo } from "./issueImport";

const H2026 = [" CS Number", "Repair/Issue", "Customer", "Model", "Region", "issue Date", "機器序號 (SN)", "QR code", "Description", "Specification and behavior", "Warranty ", "Status", "Close Date", "處理工作天", "Response", "Deck up/down times", "Cut_hr", "whl_hr", "QA Staff", "安排", "處理單位", "Error Type", "RMA", "RMA By Cutting Disk", "維修單號", "更換重要零件1", "更換重要零件2"];

function row2026(over: Record<number, unknown>): unknown[] {
  const r: unknown[] = new Array(H2026.length).fill("");
  for (const [i, v] of Object.entries(over)) r[Number(i)] = v;
  return r;
}

describe("儲存格與日期", () => {
  it("公式儲存格取結果、richText 合併、布林", () => {
    expect(cellText({ formula: "=A1", result: "CS20260106-001" })).toBe("CS20260106-001");
    expect(cellText({ richText: [{ text: "a" }, { text: "b" }] })).toBe("ab");
    expect(cellText(true)).toBe("TRUE");
  });
  it("日期:Date、序號、斜線與短橫線、沒有年份不收", () => {
    expect(parseDate(new Date("2026-01-06T00:00:00Z"))).toBe("2026-01-06");
    expect(parseDate(46028)).toBe("2026-01-06");
    expect(parseDate("2026/1/6")).toBe("2026-01-06");
    expect(parseDate("2026/01/13")).toBe("2026-01-13");
    expect(parseDate("2026-1-3")).toBe("2026-01-03");
    expect(parseDate("1/10")).toBeNull();
    expect(parseDate("2026/2/30")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
  it("處理單位多值", () => {
    expect(splitUnits("HW/QA")).toEqual(["HW", "QA"]);
    expect(splitUnits("qa")).toEqual(["QA"]);
    expect(splitUnits("")).toEqual([]);
  });
  it("匯入的 Case No 要格式正確且日期與發生日期一致", () => {
    expect(usableCaseNo("CS20260106-001", "2026-01-06")).toEqual({ caseNo: "CS20260106-001", seq: 1 });
    expect(usableCaseNo("CS20260106-001", "2026-01-07")).toBeNull();
    expect(usableCaseNo("Error", "2026-01-07")).toBeNull();
    expect(usableCaseNo(null, "2026-01-07")).toBeNull();
  });
});

describe("parseIssueSheet", () => {
  it("2026 版:依標題對欄位,零件多欄合併、布林、處理單位", () => {
    const rows = [
      H2026,
      row2026({ 0: "CS20260106-001", 1: "Repair", 2: "Parkland", 3: "CS", 4: "New Zealand", 5: 46028, 7: "CS-599C", 8: "Charging station not working.", 10: "IN", 11: "TC", 12: 46063, 14: "[1/7] 確認", 20: "QA", 22: true, 23: false, 25: "M690 CHARGER", 26: "BLADE" }),
    ];
    const out = parseIssueSheet("2026CSTable", rows);
    expect(out.recognized).toBe(true);
    expect(out.errors).toEqual([]);
    expect(out.records).toHaveLength(1);
    expect(out.records[0]).toMatchObject({
      caseNo: "CS20260106-001",
      kind: "REPAIR",
      customer: "Parkland",
      product: "CS",
      issueDate: "2026-01-06",
      closeDate: "2026-02-10",
      status: "TC",
      warranty: "IN",
      units: ["QA"],
      rma: true,
      rmaCuttingDisk: false,
      parts: ["M690 CHARGER", "BLADE"],
      response: "[1/7] 確認",
    });
  });
  it("2024 版:沒有 Repair/Issue 欄 → 維修;標題用中文", () => {
    const rows = [
      ["case no ", "customer", "產品型號", "地區", "客戶型態", "發生問題日期", "機器序號 (SN)", "QR code", "Deck up/down times", "Mowing hours", "問題簡述", " 保固狀態", "Status", "安排", "處理單位", "Error Type", "結案時間", "處裡天數", "RMA"],
      ["Error", "廣容", "M1", "TW", "Lease", 44908, "M1B2A1NLB007", 552, "", "", "刀盤打到硬物", "IN", "KIV", "1. 更換刀盤", "HW", "HW17-Others", 44918, 10, ""],
    ];
    const out = parseIssueSheet("2024CSTable", rows);
    // KIV 不是合法狀態:這一列報錯,不是默默吞掉
    expect(out.records).toHaveLength(0);
    expect(out.errors[0].message).toContain("KIV");
    const rows2 = [rows[0], ["Error", "廣容", "M1", "TW", "Lease", 44908, "M1B2A1NLB007", 552, "", "", "刀盤打到硬物", "IN", "PC", "1. 更換刀盤", "HW", "HW17-Others", 44918, 10, ""]];
    const ok = parseIssueSheet("2024CSTable", rows2);
    expect(ok.records[0]).toMatchObject({ kind: "REPAIR", customerType: "Lease", issueDate: "2022-12-13", closeDate: "2022-12-23", status: "PC", errorType: "HW17-Others", qrCode: "552", description: "刀盤打到硬物", caseNo: "Error" });
  });
  it("空白列略過;日期無法辨識或結案早於發生的列報錯而不是整批失敗", () => {
    const rows = [H2026, row2026({}), row2026({ 2: "A", 5: "1/10" }), row2026({ 2: "B", 5: "2026/3/5", 12: "2026/3/1" }), row2026({ 2: "C", 5: "2026/3/5" })];
    const out = parseIssueSheet("2026CSTable", rows);
    expect(out.records.map((r) => r.customer)).toEqual(["C"]);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[0].where).toBe("2026CSTable 第 3 列");
  });
  it("不是案件表的工作表(Dashboard、Reliability…)整個略過", () => {
    expect(parseIssueSheet("Reliability", [["", "counts"], ["M1 RMA", 5]]).recognized).toBe(false);
    expect(parseIssueSheet("Empty", []).recognized).toBe(false);
  });
});
