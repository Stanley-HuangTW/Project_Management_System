import { describe, expect, it } from "vitest";
import {
  MAX_NRE_AMOUNT,
  NRE_CATEGORIES,
  NRE_CATEGORY_GUIDE,
  NRE_LABELS,
  parseNumberField,
  resolveNreAmount,
  summarizeNre,
  validateNreLine,
  type NreLineInput,
} from "./nre";

const line = (overrides: Partial<NreLineInput> = {}): NreLineInput => ({
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

describe("resolveNreAmount", () => {
  it("有數量和單價:兩者相乘,四捨五入到元", () => {
    expect(resolveNreAmount({ quantity: 500, unitPrice: 800, amount: 0 })).toBe(400000);
    expect(resolveNreAmount({ quantity: 2.5, unitPrice: 333, amount: 0 })).toBe(833);
  });

  it("以相乘為準,直接填的金額被忽略", () => {
    expect(resolveNreAmount({ quantity: 2, unitPrice: 30000, amount: 1 })).toBe(60000);
  });

  it("數量或單價缺一個、或數量是 0:用直接填的金額", () => {
    expect(resolveNreAmount({ quantity: 2, unitPrice: null, amount: 60000 })).toBe(60000);
    expect(resolveNreAmount({ quantity: null, unitPrice: 30000, amount: 60000 })).toBe(60000);
    expect(resolveNreAmount({ quantity: 0, unitPrice: 30000, amount: 60000 })).toBe(60000);
  });

  it("單價 0(例如免費治具)算數:金額是 0", () => {
    expect(resolveNreAmount({ quantity: 3, unitPrice: 0, amount: 999 })).toBe(0);
  });
});

describe("validateNreLine", () => {
  it("正常的一列沒問題", () => {
    expect(validateNreLine(line())).toBeNull();
    expect(validateNreLine(line({ category: "LABOUR", vendor: "ABC 工程", quantity: 500, unitPrice: 800, amount: 0 }))).toBeNull();
  });

  it("細項說明一定要有", () => {
    expect(validateNreLine(line({ description: "   " }))).toContain("細項說明");
  });

  it("欄位太長、負數、不是數字都擋下來", () => {
    expect(validateNreLine(line({ description: "字".repeat(201) }))).toContain("太長");
    expect(validateNreLine(line({ note: "字".repeat(501) }))).toContain("備註");
    expect(validateNreLine(line({ quantity: -1 }))).toContain("數量");
    expect(validateNreLine(line({ unitPrice: -5 }))).toContain("單價");
    expect(validateNreLine(line({ amount: -1 }))).toContain("金額");
    expect(validateNreLine(line({ amount: Number.NaN }))).toContain("金額");
  });

  it("金額大到不合理也擋下來(相乘之後算)", () => {
    expect(validateNreLine(line({ quantity: MAX_NRE_AMOUNT, unitPrice: 10, amount: 0 }))).toContain("太大");
  });

  it("不認得的類別擋下來", () => {
    expect(validateNreLine(line({ category: "NOPE" as never }))).toContain("類別");
  });
});

describe("summarizeNre", () => {
  it("每一類的筆數與小計,加上總計;沒有資料的類別是 0", () => {
    const s = summarizeNre([
      { category: "TOOLING", amount: 550000 },
      { category: "TOOLING", amount: 60000 },
      { category: "CERTIFICATION", amount: 140000 },
    ]);
    expect(s.byCategory.TOOLING).toEqual({ count: 2, total: 610000 });
    expect(s.byCategory.CERTIFICATION).toEqual({ count: 1, total: 140000 });
    expect(s.byCategory.LABOUR).toEqual({ count: 0, total: 0 });
    expect(s.byCategory.PROTOTYPE).toEqual({ count: 0, total: 0 });
    expect(s.total).toBe(750000);
    expect(s.count).toBe(3);
  });

  it("你貼的範例:研發人力 40 萬 + 模具 61 萬 + 打樣 5 萬 + 測試認證 19 萬 = 125 萬", () => {
    const s = summarizeNre([
      { category: "LABOUR", amount: 400000 },
      { category: "TOOLING", amount: 550000 },
      { category: "TOOLING", amount: 60000 },
      { category: "PROTOTYPE", amount: 30000 },
      { category: "PROTOTYPE", amount: 20000 },
      { category: "CERTIFICATION", amount: 50000 },
      { category: "CERTIFICATION", amount: 140000 },
    ]);
    expect(s.total).toBe(1250000);
  });
});

describe("類別設定", () => {
  it("四大項都有名稱與欄位說明;研發人力的數量是工時、單價是時薪", () => {
    for (const c of NRE_CATEGORIES) {
      expect(NRE_LABELS[c]).toBeTruthy();
      expect(NRE_CATEGORY_GUIDE[c].hint).toBeTruthy();
    }
    expect(NRE_CATEGORY_GUIDE.LABOUR.quantityLabel).toContain("工時");
    expect(NRE_CATEGORY_GUIDE.LABOUR.unitPriceLabel).toContain("時薪");
    expect(NRE_CATEGORY_GUIDE.LABOUR.vendorLabel).toContain("外部");
  });
});

describe("parseNumberField", () => {
  it("空白是 null、逗號與空白可以有、不是數字是 NaN", () => {
    expect(parseNumberField("")).toBeNull();
    expect(parseNumberField("  ")).toBeNull();
    expect(parseNumberField("1,250,000")).toBe(1250000);
    expect(parseNumberField("2.5")).toBe(2.5);
    expect(Number.isNaN(parseNumberField("abc"))).toBe(true);
  });
});
