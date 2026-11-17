import { describe, expect, it } from "vitest";
import { casePeriod, errorTypeCategory, formatCaseNo, isIsoDate, openDays, processingDays } from "./issueCase";

describe("Case No", () => {
  it("CS + 西元年月日 + - + 三位流水號(跟 Sheet 2026 的 CS20260106-001 同格式)", () => {
    expect(formatCaseNo("2026-01-06", 1)).toBe("CS20260106-001");
    expect(formatCaseNo("2026-06-26", 29)).toBe("CS20260626-029");
    expect(formatCaseNo("2026-06-26", 1000)).toBe("CS20260626-1000");
  });
  it("流水號依發生日期的年月分組", () => {
    expect(casePeriod("2026-06-26")).toBe("202606");
    expect(casePeriod("2025-12-31")).toBe("202512");
  });
  it("不合法的日期或流水號丟錯,不產生怪編號", () => {
    expect(() => formatCaseNo("2026-13-01", 1)).toThrow();
    expect(() => formatCaseNo("2026-02-30", 1)).toThrow();
    expect(() => formatCaseNo("2026-01-06", 0)).toThrow();
    expect(() => casePeriod("abc")).toThrow();
  });
  it("isIsoDate 擋掉不存在的日期", () => {
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026/1/6")).toBe(false);
  });
});

describe("處理天數", () => {
  it("工作天:Sheet 的 NETWORKDAYS(2026/1/6 → 2026/2/10 = 26)", () => {
    expect(processingDays("2026-01-06", "2026-02-10", "WORKDAY")).toBe(26);
  });
  it("工作天可排除公司假日", () => {
    expect(processingDays("2026-01-06", "2026-02-10", "WORKDAY", new Set(["2026-01-07", "2026-01-08"]))).toBe(24);
  });
  it("日曆天:含頭尾", () => {
    expect(processingDays("2026-01-06", "2026-02-10", "CALENDAR")).toBe(36);
    expect(processingDays("2026-01-06", "2026-01-06", "CALENDAR")).toBe(1);
  });
  it("沒有結案日期、或結案早於發生日 → null(Sheet 的 N/A)", () => {
    expect(processingDays("2026-01-06", null, "WORKDAY")).toBeNull();
    expect(processingDays("2026-01-06", "2026-01-01", "WORKDAY")).toBeNull();
  });
  it("未結案已開幾天", () => {
    expect(openDays("2026-01-05", "2026-01-09", "WORKDAY")).toBe(5);
    expect(openDays("2026-01-05", "2026-01-11", "CALENDAR")).toBe(7);
  });
});

describe("問題類型大類", () => {
  it("由名稱前綴決定大類", () => {
    expect(errorTypeCategory("SW01-App異常")).toBe("軟體");
    expect(errorTypeCategory("HW02-刀盤馬達異常")).toBe("硬體");
    expect(errorTypeCategory("HW16 -機器充電異常")).toBe("硬體");
    expect(errorTypeCategory("CN02-No Trouble Found")).toBe("查無問題/操作");
    expect(errorTypeCategory("LM01-Design Limitation")).toBe("設計限制");
    expect(errorTypeCategory("OP01-Installation Error")).toBe("安裝/操作錯誤");
    expect(errorTypeCategory("自訂的類型")).toBe("其他");
    expect(errorTypeCategory(null)).toBe("其他");
  });
});
