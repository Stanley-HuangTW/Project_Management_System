import { describe, expect, it } from "vitest";
import {
  MAX_NRE_AMOUNT,
  NRE_CATEGORIES,
  NRE_CATEGORY_GUIDE,
  NRE_LABELS,
  describeNreChange,
  nreByCostCategory,
  NRE_COST_CATEGORY,
  planNreApply,
  parseNumberField,
  planNreImport,
  sameNreContent,
  type NreExistingLine,
  resolveNreAmount,
  summarizeNre,
  summarizeNreByPhase,
  validateNreLine,
  type NreLineInput,
} from "./nre";

const line = (overrides: Partial<NreLineInput> = {}): NreLineInput => ({
  category: "TOOLING",
  phaseId: "p1",
  startDate: null,
  endDate: null,
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
  it("每一大項都有名稱與欄位說明;研發人力的數量是工時、單價是時薪", () => {
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

describe("匯入比對 planNreImport", () => {
  const existing = (overrides: Partial<NreExistingLine> & { id: string }): NreExistingLine => ({
    category: "TOOLING",
    phaseId: "p1",
    startDate: null,
    endDate: null,
    description: "外殼塑膠射出鋼模",
    basis: "",
    vendor: "",
    quantity: null,
    unitPrice: null,
    amount: 550000,
    note: "",
    ...overrides,
  });

  it("同類別、同細項說明是同一列:內容一樣不動、不一樣就更新、沒有就新增", () => {
    const plan = planNreImport(
      [existing({ id: "a" }), existing({ id: "b", description: "組裝治具", amount: 60000 })],
      [line({ amount: 550000 }), line({ description: "組裝治具", amount: 70000 }), line({ description: "新的治具", amount: 1000 })]
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.updates.map((u) => u.id)).toEqual(["b"]);
    expect(plan.creates.map((c) => c.description)).toEqual(["新的治具"]);
    expect(plan.untouched).toEqual([]);
  });

  it("Excel 沒提到的現有列維持原樣(不刪)", () => {
    const plan = planNreImport([existing({ id: "a" }), existing({ id: "b", description: "沒在 Excel 的" })], [line()]);
    expect(plan.untouched.map((l) => l.id)).toEqual(["b"]);
  });

  it("不同類別的同名細項是兩列,不會互相對到", () => {
    const plan = planNreImport([existing({ id: "a", category: "PROTOTYPE" })], [line({ category: "TOOLING" })]);
    expect(plan.creates).toHaveLength(1);
    expect(plan.untouched.map((l) => l.id)).toEqual(["a"]);
  });

  it("同一類別有好幾列細項說明一樣:依先後順序一對一,多的 Excel 列是新增", () => {
    const plan = planNreImport(
      [existing({ id: "a", amount: 100 }), existing({ id: "b", amount: 200 })],
      [line({ amount: 111 }), line({ amount: 222 }), line({ amount: 333 })]
    );
    expect(plan.updates.map((u) => [u.id, resolveNreAmount(u.input)])).toEqual([["a", 111], ["b", 222]]);
    expect(plan.creates).toHaveLength(1);
  });

  it("細項說明的頭尾空白不影響對應", () => {
    const plan = planNreImport([existing({ id: "a" })], [line({ description: "  外殼塑膠射出鋼模 " })]);
    expect(plan.unchanged).toBe(1);
  });
});

describe("sameNreContent / describeNreChange", () => {
  const before: NreExistingLine = {
    id: "a",
    category: "LABOUR",
    phaseId: "p1",
    startDate: null,
    endDate: null,
    description: "設計",
    basis: "3 人 × 3 個月",
    vendor: "弘泰",
    quantity: 500,
    unitPrice: 800,
    amount: 400000,
    note: "",
  };

  it("數量 × 單價算出來的金額一樣就算沒變", () => {
    expect(sameNreContent(line({ category: "LABOUR", description: "設計", basis: "3 人 × 3 個月", vendor: "弘泰", quantity: 500, unitPrice: 800, amount: 0 }), before)).toBe(true);
  });

  it("說出改了哪些欄位", () => {
    const changed = line({ category: "LABOUR", description: "設計", basis: "3 人 × 3 個月", vendor: "弘泰", quantity: 600, unitPrice: 800, amount: 0, note: "加量" });
    expect(describeNreChange(before, changed)).toBe("數量 500 → 600、金額 400,000 → 480,000、備註 (空白) → 加量");
  });
});

describe("summarizeNreByPhase(整個專案的 NRE)", () => {
  const phases = [
    { id: "p1", name: "POC" },
    { id: "p2", name: "EVT" },
    { id: "p3", name: "DVT" },
  ];

  it("每個階段每一類的小計、每個階段的合計,以及全部階段加起來", () => {
    const s = summarizeNreByPhase(phases, [
      { phaseId: "p1", category: "TOOLING", amount: 550000 },
      { phaseId: "p1", category: "LABOUR", amount: 400000 },
      { phaseId: "p2", category: "TOOLING", amount: 60000 },
      { phaseId: "p2", category: "CERTIFICATION", amount: 140000 },
    ]);
    expect(s.rows.map((r) => [r.phaseName, r.total])).toEqual([["POC", 950000], ["EVT", 200000], ["DVT", 0]]);
    expect(s.rows[0].byCategory).toEqual({ LABOUR: 400000, COMMISSIONED: 0, TOOLING: 550000, PROTOTYPE: 0, CERTIFICATION: 0 });
    expect(s.byCategory).toEqual({ LABOUR: 400000, COMMISSIONED: 0, TOOLING: 610000, PROTOTYPE: 0, CERTIFICATION: 140000 });
    expect(s.total).toBe(1150000);
  });

  it("沒填報價單的階段也有一列(0);不屬於這個看板任何階段的資料不算", () => {
    const s = summarizeNreByPhase(phases, [{ phaseId: "gone", category: "TOOLING", amount: 999 }]);
    expect(s.rows).toHaveLength(3);
    expect(s.total).toBe(0);
  });

  it("涵蓋整個專案的委託開發(沒有階段)另外一列,而且算進全部的合計", () => {
    const s = summarizeNreByPhase(phases, [
      { phaseId: "p1", category: "COMMISSIONED", amount: 300000 },
      { phaseId: null, category: "COMMISSIONED", amount: 900000 },
      { phaseId: "p2", category: "TOOLING", amount: 60000 },
    ]);
    expect(s.projectWide).toEqual({ byCategory: { LABOUR: 0, COMMISSIONED: 900000, TOOLING: 0, PROTOTYPE: 0, CERTIFICATION: 0 }, total: 900000 });
    expect(s.rows.map((r) => r.total)).toEqual([300000, 60000, 0]);
    expect(s.byCategory.COMMISSIONED).toBe(1200000);
    expect(s.total).toBe(1260000);
  });
});

describe("委託開發", () => {
  const commissioned = (overrides: Partial<NreLineInput> = {}) =>
    line({ category: "COMMISSIONED", description: "主控板硬體設計", vendor: "弘泰工程", amount: 300000, ...overrides });

  it("類別設定:委託單位、委託項目,排在研發人力之後", () => {
    expect(NRE_LABELS.COMMISSIONED).toBe("委託開發");
    expect(NRE_CATEGORY_GUIDE.COMMISSIONED.vendorLabel).toBe("委託單位");
    expect(NRE_CATEGORY_GUIDE.COMMISSIONED.descriptionLabel).toBe("委託項目");
    expect(NRE_CATEGORIES.indexOf("COMMISSIONED")).toBe(NRE_CATEGORIES.indexOf("LABOUR") + 1);
  });

  it("掛在某個階段、或涵蓋整個專案(phaseId 是 null)都可以;有時間範圍也可以", () => {
    expect(validateNreLine(commissioned())).toBeNull();
    expect(validateNreLine(commissioned({ phaseId: null }))).toBeNull();
    expect(validateNreLine(commissioned({ phaseId: null, startDate: "2026-10-01", endDate: "2026-12-31" }))).toBeNull();
    expect(validateNreLine(commissioned({ startDate: "2026-10-01", endDate: "2026-10-01" }))).toBeNull();
  });

  it("缺少的欄位提示用「委託項目」", () => {
    expect(validateNreLine(commissioned({ description: " " }))).toContain("委託項目");
  });

  it("時間範圍:起訖要一起填、日期要正確、結束不能早於開始", () => {
    expect(validateNreLine(commissioned({ startDate: "2026-10-01" }))).toContain("起訖");
    expect(validateNreLine(commissioned({ endDate: "2026-10-01" }))).toContain("起訖");
    expect(validateNreLine(commissioned({ startDate: "2026/10/01", endDate: "2026-12-31" }))).toContain("格式");
    expect(validateNreLine(commissioned({ startDate: "2026-02-30", endDate: "2026-12-31" }))).toContain("格式");
    expect(validateNreLine(commissioned({ startDate: "2026-12-31", endDate: "2026-10-01" }))).toContain("不能早於");
  });

  it("別的類別一定要屬於一個階段、也沒有時間範圍", () => {
    expect(validateNreLine(line({ phaseId: null }))).toContain("只有委託開發");
    expect(validateNreLine(line({ startDate: "2026-10-01", endDate: "2026-12-31" }))).toContain("只有委託開發");
  });

  it("匯入比對:同名的委託項目掛在不同範圍是兩列,不會互相蓋掉", () => {
    const plan = planNreImport(
      [{ id: "a", category: "COMMISSIONED", phaseId: "p1", startDate: null, endDate: null, description: "主控板硬體設計", basis: "", vendor: "弘泰工程", quantity: null, unitPrice: null, amount: 100, note: "" }],
      [commissioned({ phaseId: null }), commissioned({ phaseId: "p1", amount: 100 })]
    );
    expect(plan.unchanged).toBe(1);
    expect(plan.creates.map((c) => c.phaseId)).toEqual([null]);
  });

  it("改了時間範圍、範圍或委託單位:算有變動,並且說出改了什麼", () => {
    const before: NreExistingLine = { id: "a", category: "COMMISSIONED", phaseId: "p1", startDate: "2026-10-01", endDate: "2026-12-31", description: "主控板硬體設計", basis: "", vendor: "弘泰工程", quantity: null, unitPrice: null, amount: 300000, note: "" };
    expect(sameNreContent(commissioned({ startDate: "2026-10-01", endDate: "2026-12-31" }), before)).toBe(true);
    const moved = commissioned({ phaseId: null, startDate: "2026-11-01", endDate: "2027-01-31" });
    expect(sameNreContent(moved, before)).toBe(false);
    expect(describeNreChange(before, moved, (id) => (id === null ? "整個專案" : "POC"))).toBe(
      "範圍 POC → 整個專案、時間範圍 2026-10-01(週四) ~ 2026-12-31(週四) → 2026-11-01(週日) ~ 2027-01-31(週日)"
    );
  });
});

describe("nreByCostCategory(NRE 報價 → 預算的費用類別)", () => {
  it("每一類報價對到預算的費用類別:研發人力 → 人力、打樣與樣品 → 材料、委託開發 → 委託開發", () => {
    expect(NRE_COST_CATEGORY).toEqual({
      LABOUR: "LABOUR",
      COMMISSIONED: "OUTSOURCING",
      TOOLING: "TOOLING",
      PROTOTYPE: "MATERIAL",
      CERTIFICATION: "CERTIFICATION",
    });
  });

  it("金額照費用類別加起來,總計是全部的報價", () => {
    const out = nreByCostCategory([
      { category: "LABOUR", amount: 400000 },
      { category: "TOOLING", amount: 550000 },
      { category: "TOOLING", amount: 60000 },
      { category: "PROTOTYPE", amount: 50000 },
      { category: "COMMISSIONED", amount: 300000 },
    ]);
    expect(out.byCategory).toEqual({ LABOUR: 400000, TOOLING: 610000, MATERIAL: 50000, OUTSOURCING: 300000 });
    expect(out.total).toBe(1360000);
  });

  it("沒有報價:空的、總計 0", () => {
    expect(nreByCostCategory([])).toEqual({ byCategory: {}, total: 0 });
  });
});

describe("planNreApply(把 NRE 報價帶入核准預算)", () => {
  const base = { labourFromPlan: false, materialFromBom: false };

  it("有報價的類別:核准預算改成報價,列出改之前與改之後", () => {
    const plan = planNreApply({
      ...base,
      nreByCategory: { TOOLING: 610000, CERTIFICATION: 140000, OUTSOURCING: 300000 },
      budgetByCategory: { TOOLING: 800000 },
    });
    expect(plan.apply).toEqual([
      { category: "OUTSOURCING", before: 0, after: 300000 },
      { category: "TOOLING", before: 800000, after: 610000 },
      { category: "CERTIFICATION", before: 0, after: 140000 },
    ]);
    expect(plan.skipped).toEqual([]);
  });

  it("人力有人力規劃表算、材料有樣機 BOM 算:略過並說明,不帶入", () => {
    const plan = planNreApply({
      labourFromPlan: true,
      materialFromBom: true,
      nreByCategory: { LABOUR: 400000, MATERIAL: 50000, TOOLING: 610000 },
      budgetByCategory: { LABOUR: 1000000, MATERIAL: 20000 },
    });
    expect(plan.apply.map((a) => a.category)).toEqual(["TOOLING"]);
    expect(plan.skipped).toEqual([
      { category: "LABOUR", reason: "人力預算由人力規劃表計算" },
      { category: "MATERIAL", reason: "材料預算由樣機 BOM 計算" },
    ]);
  });

  it("沒被算出來的人力、材料可以帶入(研發人力 → 人力、打樣與樣品 → 材料)", () => {
    const plan = planNreApply({ ...base, nreByCategory: { LABOUR: 400000, MATERIAL: 50000 }, budgetByCategory: {} });
    expect(plan.apply).toEqual([
      { category: "LABOUR", before: 0, after: 400000 },
      { category: "MATERIAL", before: 0, after: 50000 },
    ]);
  });

  it("報價跟核准預算一樣:不用動;報價是 0 或沒有:不會把核准預算清掉", () => {
    const plan = planNreApply({
      ...base,
      nreByCategory: { TOOLING: 610000, CERTIFICATION: 0 },
      budgetByCategory: { TOOLING: 610000, CERTIFICATION: 99000, TRAVEL: 5000 },
    });
    expect(plan.apply).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });
});
