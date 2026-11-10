import { describe, expect, it } from "vitest";
import { BUILT_IN_BOM_COLUMNS, type BomColumnDef } from "./bomColumns";
import { buildRowUpdate, convertPastedCell, labelOfKey, placeBlock, type FieldChange, type RowFacts } from "./bomCellPaste";

const col = (id: string, name: string, type: BomColumnDef["type"], over: Partial<BomColumnDef> = {}): BomColumnDef => ({
  id,
  name,
  type,
  options: [],
  required: false,
  defaultValue: null,
  visible: true,
  ...over,
});
const COLUMNS: BomColumnDef[] = [
  ...BUILT_IN_BOM_COLUMNS.map((c) => (c.id === "vendor" ? { ...c, name: "供應商" } : c)),
  col("c_status01", "驗證狀態", "SELECT", { options: ["未送樣", "已送樣", "通過"] }),
  col("c_buyer001", "採購負責人", "PERSON"),
  col("c_rohs0001", "RoHS", "CHECKBOX"),
  col("c_moq00001", "最小訂購量", "NUMBER"),
  col("c_spec0001", "規格書", "FILE"),
];
const USERS = [{ id: "u1", name: "李美玲" }, { id: "u2", name: "王小明" }];
const leaf: RowFacts = { isAssembly: false, currency: "TWD", fxRate: 1 };
const conv = (key: string, text: string, row: RowFacts = leaf) => convertPastedCell(key, text, { columns: COLUMNS, users: USERS, row });

const ROWS = ["r1", "r2", "r3", "r4"];
const COLS = ["name", "vendor", "qty", "unitPrice"];

describe("placeBlock:一欄、一列、一塊", () => {
  it("貼一欄:從框選的第一列開始,由上而下一列對一列", () => {
    const out = placeBlock([["10"], ["20"], ["30"]], ROWS, COLS, { rowIds: ROWS, colKeys: ["qty"] });
    if ("error" in out) throw new Error(out.error);
    expect(out.cells).toEqual([
      { rowId: "r1", colKey: "qty", text: "10" },
      { rowId: "r2", colKey: "qty", text: "20" },
      { rowId: "r3", colKey: "qty", text: "30" },
    ]);
    expect(out.clippedRows).toBe(0);
  });

  it("貼一列:從游標所在那一格開始,由左而右一欄對一欄", () => {
    const out = placeBlock([["華創", "5", "100"]], ROWS, COLS, { rowIds: ["r2"], colKeys: ["vendor"] });
    if ("error" in out) throw new Error(out.error);
    expect(out.cells.map((c) => `${c.rowId}.${c.colKey}=${c.text}`)).toEqual(["r2.vendor=華創", "r2.qty=5", "r2.unitPrice=100"]);
  });

  it("貼一塊:兩列兩欄", () => {
    const out = placeBlock([["a", "b"], ["c", "d"]], ROWS, COLS, { rowIds: ["r2"], colKeys: ["name"] });
    if ("error" in out) throw new Error(out.error);
    expect(out.cells.map((c) => `${c.rowId}.${c.colKey}=${c.text}`)).toEqual(["r2.name=a", "r2.vendor=b", "r3.name=c", "r3.vendor=d"]);
  });

  it("只貼一個值、框選了好幾格:每一格都填同一個值", () => {
    const out = placeBlock([["TWD"]], ROWS, COLS, { rowIds: ["r1", "r3"], colKeys: ["vendor", "qty"] });
    if ("error" in out) throw new Error(out.error);
    expect(out.cells).toHaveLength(4);
    expect(out.cells.every((c) => c.text === "TWD")).toBe(true);
  });

  it("只貼一個值、只框了一格:就是那一格", () => {
    const out = placeBlock([["x"]], ROWS, COLS, { rowIds: ["r2"], colKeys: ["vendor"] });
    expect(out).toEqual({ cells: [{ rowId: "r2", colKey: "vendor", text: "x" }], clippedRows: 0, clippedCols: 0 });
  });

  it("貼得比表格長 / 寬:超出的部分不貼,回報幾列 / 幾欄被略過", () => {
    const out = placeBlock([["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]], ROWS, COLS, { rowIds: ["r4"], colKeys: ["qty"] });
    if ("error" in out) throw new Error(out.error);
    expect(out.cells.map((c) => `${c.rowId}.${c.colKey}=${c.text}`)).toEqual(["r4.qty=1", "r4.unitPrice=2"]);
    expect(out.clippedRows).toBe(2);
    expect(out.clippedCols).toBe(1);
  });

  it("空白格(空字串)也算一格,會貼上;列比較短的,沒有的那幾格不動", () => {
    const out = placeBlock([["a", ""], ["b"]], ROWS, COLS, { rowIds: ["r1"], colKeys: ["name"] });
    if ("error" in out) throw new Error(out.error);
    expect(out.cells.map((c) => `${c.rowId}.${c.colKey}=${c.text}`)).toEqual(["r1.name=a", "r1.vendor=", "r2.name=b"]);
  });

  it("找不到位置、太多列、沒有內容:說明", () => {
    expect(placeBlock([["x"]], ROWS, COLS, { rowIds: ["zzz"], colKeys: ["qty"] })).toEqual({ error: expect.stringContaining("重新框選") });
    expect(placeBlock([], ROWS, COLS, { rowIds: ["r1"], colKeys: ["qty"] })).toEqual({ error: "沒有內容可以貼上" });
    expect(placeBlock(Array.from({ length: 301 }, () => ["1"]), ROWS, COLS, { rowIds: ["r1"], colKeys: ["qty"] })).toEqual({ error: expect.stringContaining("最多貼上 300 列") });
  });
});

describe("convertPastedCell", () => {
  it("名稱:不能空白(空白 = 這格維持原樣)、有長度上限", () => {
    expect(conv("name", " 主機板 ")).toEqual({ change: { field: "name", value: "主機板" } });
    expect(conv("name", "  ")).toEqual({ skip: "名稱" });
    expect(conv("name", "x".repeat(201))).toEqual({ problem: expect.stringContaining("太長") });
  });

  it("廠商、型號/料號、備註:空白就是清空", () => {
    expect(conv("vendor", "華創")).toEqual({ change: { field: "vendor", value: "華創" } });
    expect(conv("vendor", "")).toEqual({ change: { field: "vendor", value: "" } });
    expect(conv("note", "")).toEqual({ change: { field: "note", value: "" } });
  });

  it("交期是週數:8、8週、8 weeks 都讀成 8,空白 = 清空,讀不懂說明;以前的日期原樣保留", () => {
    expect(conv("delivery", "8")).toEqual({ change: { field: "deliveryDate", value: "8" } });
    expect(conv("delivery", "12 週")).toEqual({ change: { field: "deliveryDate", value: "12" } });
    expect(conv("delivery", "6 weeks")).toEqual({ change: { field: "deliveryDate", value: "6" } });
    expect(conv("delivery", "2026/11/5")).toEqual({ change: { field: "deliveryDate", value: "2026-11-05" } });
    expect(conv("delivery", "")).toEqual({ change: { field: "deliveryDate", value: null } });
    expect(conv("delivery", "下週")).toEqual({ problem: expect.stringContaining("週數") });
    expect(conv("delivery", "9999")).toEqual({ problem: expect.stringContaining("週數") });
  });

  it("數量與單價:讀得懂 1,250、NT$300;數量要大於 0、單價不能是負的;空白維持原樣", () => {
    expect(conv("qty", "1,250")).toEqual({ change: { field: "qty", value: 1250 } });
    expect(conv("unitPrice", "NT$300")).toEqual({ change: { field: "unitPrice", value: 300 } });
    expect(conv("unitPrice", "0")).toEqual({ change: { field: "unitPrice", value: 0 } });
    expect(conv("qty", "0")).toEqual({ problem: expect.stringContaining("大於 0") });
    expect(conv("qty", "三個")).toEqual({ problem: expect.stringContaining("大於 0") });
    expect(conv("unitPrice", "-5")).toEqual({ problem: expect.stringContaining("0 或正數") });
    expect(conv("qty", "")).toEqual({ skip: "數量" });
    expect(conv("unitPrice", "")).toEqual({ skip: "單價" });
  });

  it("有子項目的列:單價、幣別、匯率不能貼(底下加總算出來的),數量可以", () => {
    const assembly: RowFacts = { isAssembly: true, currency: "TWD", fxRate: 1 };
    expect(conv("unitPrice", "100", assembly)).toEqual({ problem: expect.stringContaining("底下加總") });
    expect(conv("currency", "USD", assembly)).toEqual({ problem: expect.stringContaining("有子項目") });
    expect(conv("fxRate", "30", assembly)).toEqual({ problem: expect.stringContaining("有子項目") });
    expect(conv("qty", "2", assembly)).toEqual({ change: { field: "qty", value: 2 } });
  });

  it("幣別:小寫轉大寫、要三個英文字母;匯率要大於 0", () => {
    expect(conv("currency", "usd")).toEqual({ change: { field: "currency", value: "USD" } });
    expect(conv("currency", "美金")).toEqual({ problem: expect.stringContaining("三個英文字母") });
    expect(conv("fxRate", "30.5")).toEqual({ change: { field: "fxRate", value: 30.5 } });
    expect(conv("fxRate", "0")).toEqual({ problem: expect.stringContaining("大於 0") });
  });

  it("自訂欄位:下拉(大小寫不拘)、人員(姓名)、勾選、數字;檔案附件與不認得的欄不能貼", () => {
    expect(conv("c_status01", "通過")).toEqual({ change: { field: "extra", columnId: "c_status01", value: "通過" } });
    expect(conv("c_buyer001", "王小明")).toEqual({ change: { field: "extra", columnId: "c_buyer001", value: "u2" } });
    expect(conv("c_buyer001", "路人甲")).toEqual({ problem: expect.stringContaining("找不到「路人甲」") });
    expect(conv("c_rohs0001", "是")).toEqual({ change: { field: "extra", columnId: "c_rohs0001", value: true } });
    expect(conv("c_moq00001", "1,000")).toEqual({ change: { field: "extra", columnId: "c_moq00001", value: 1000 } });
    expect(conv("c_status01", "")).toEqual({ change: { field: "extra", columnId: "c_status01", value: null } });
    expect(conv("c_spec0001", "x")).toEqual({ problem: expect.stringContaining("檔案附件") });
    expect(conv("zzz", "x")).toEqual({ problem: expect.stringContaining("不能貼上") });
  });

  it("欄位名稱照看板設定的(供應商)", () => {
    expect(labelOfKey("vendor", COLUMNS)).toBe("供應商");
    expect(labelOfKey("qty", COLUMNS)).toBe("數量");
    expect(labelOfKey("c_status01", COLUMNS)).toBe("驗證狀態");
  });
});

describe("buildRowUpdate:幣別與匯率互相牽動", () => {
  const rate = (code: string) => ({ USD: 32, JPY: 0.21 })[code as "USD" | "JPY"] ?? null;
  const ch = (...changes: FieldChange[]) => changes;

  it("一般欄位直接帶進去,自訂欄位合成 extra", () => {
    const out = buildRowUpdate(leaf, ch({ field: "qty", value: 5 }, { field: "vendor", value: "華創" }, { field: "extra", columnId: "c_status01", value: "通過" }), rate);
    expect(out).toEqual({ data: { qty: 5, vendor: "華創" }, extra: { c_status01: "通過" }, problems: [] });
  });

  it("台幣的列改成外幣:用貼上的匯率;沒貼就用系統設定的目前匯率", () => {
    expect(buildRowUpdate(leaf, ch({ field: "currency", value: "USD" }, { field: "fxRate", value: 30 }), rate).data).toEqual({ currency: "USD", fxRate: 30 });
    expect(buildRowUpdate(leaf, ch({ field: "currency", value: "USD" }), rate).data).toEqual({ currency: "USD", fxRate: 32 });
  });

  it("系統設定裡也沒有這個幣別的匯率:幣別不改、說明", () => {
    const out = buildRowUpdate(leaf, ch({ field: "currency", value: "EUR" }), rate);
    expect(out.data).toEqual({});
    expect(out.problems[0]).toContain("沒有匯率");
  });

  it("本來就是外幣的列:只貼匯率就是改匯率;再貼同一個幣別沿用原本的匯率", () => {
    const usd: RowFacts = { isAssembly: false, currency: "USD", fxRate: 31 };
    expect(buildRowUpdate(usd, ch({ field: "fxRate", value: 29 }), rate).data).toEqual({ fxRate: 29 });
    expect(buildRowUpdate(usd, ch({ field: "currency", value: "USD" }), rate).data).toEqual({ currency: "USD", fxRate: 31 });
    expect(buildRowUpdate(usd, ch({ field: "currency", value: "JPY" }), rate).data).toEqual({ currency: "JPY", fxRate: 0.21 });
  });

  it("外幣改回台幣:匯率一律 1,貼的匯率不算", () => {
    const usd: RowFacts = { isAssembly: false, currency: "USD", fxRate: 31 };
    expect(buildRowUpdate(usd, ch({ field: "currency", value: "TWD" }, { field: "fxRate", value: 40 }), rate).data).toEqual({ currency: "TWD", fxRate: 1 });
  });

  it("台幣的列只貼匯率:說明台幣不需要匯率,什麼都不改", () => {
    const out = buildRowUpdate(leaf, ch({ field: "fxRate", value: 30 }), rate);
    expect(out.data).toEqual({});
    expect(out.problems[0]).toContain("台幣不需要匯率");
  });
});
