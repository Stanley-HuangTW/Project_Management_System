import { describe, expect, it } from "vitest";
import {
  BUILT_IN_BOM_COLUMNS,
  countRowsMissingRequired,
  importCellValue,
  initialColumnValues,
  isEmptyCellValue,
  isCustomColumn,
  isStoredCustomColumn,
  missingRequired,
  newColumnId,
  normalizeCellValue,
  parseBomColumns,
  resolveBomColumns,
  validateBomColumns,
  type BomColumnDef,
} from "./bomColumns";

const builtIn = () => BUILT_IN_BOM_COLUMNS.map((c) => ({ ...c }));
const custom = (over: Partial<BomColumnDef> = {}): BomColumnDef => ({
  id: "c_abc12345",
  name: "驗證狀態",
  type: "SELECT",
  options: ["未送樣", "已送樣", "通過"],
  required: false,
  defaultValue: null,
  visible: true,
  ...over,
});
const withCustom = (...extra: BomColumnDef[]) => [...builtIn(), ...extra];

describe("the built-in set", () => {
  it("is vendor, part number, the money block, delivery and note — what the table looked like before columns were configurable", () => {
    expect(BUILT_IN_BOM_COLUMNS.map((c) => c.id)).toEqual(["vendor", "partNumber", "money", "delivery", "note"]);
    expect(BUILT_IN_BOM_COLUMNS.map((c) => c.name)).toEqual(["廠商", "型號/料號", "數量、單價、幣別、小計", "交期", "備註"]);
    expect(validateBomColumns(builtIn())).toEqual({ value: builtIn() });
  });
});

describe("normalizeCellValue", () => {
  const col = (type: BomColumnDef["type"]) => ({ name: "欄", type });

  it("text: trims, empty is null, and has a length limit", () => {
    expect(normalizeCellValue(col("TEXT"), "  abc ")).toEqual({ value: "abc" });
    for (const blank of ["", "   ", null, undefined]) expect(normalizeCellValue(col("TEXT"), blank)).toEqual({ value: null });
    expect(normalizeCellValue(col("TEXT"), "x".repeat(501))).toHaveProperty("error");
  });

  it("number: accepts numbers and numeric strings, rejects anything else, empty is null", () => {
    expect(normalizeCellValue(col("NUMBER"), "12.5")).toEqual({ value: 12.5 });
    expect(normalizeCellValue(col("NUMBER"), 0)).toEqual({ value: 0 });
    expect(normalizeCellValue(col("NUMBER"), "")).toEqual({ value: null });
    for (const bad of ["abc", NaN, Infinity, "1,5"]) expect(normalizeCellValue(col("NUMBER"), bad)).toEqual({ error: "「欄」要填數字" });
  });

  it("date: real calendar dates only", () => {
    expect(normalizeCellValue(col("DATE"), "2026-11-30")).toEqual({ value: "2026-11-30" });
    for (const bad of ["2026-02-30", "2026/11/30", "11/30", "abc"]) expect(normalizeCellValue(col("DATE"), bad)).toHaveProperty("error");
    expect(normalizeCellValue(col("DATE"), "")).toEqual({ value: null });
  });

  it("checkbox: always true or false", () => {
    expect(normalizeCellValue(col("CHECKBOX"), true)).toEqual({ value: true });
    expect(normalizeCellValue(col("CHECKBOX"), "true")).toEqual({ value: true });
    for (const no of [false, "", null, undefined, "no", 0]) expect(normalizeCellValue(col("CHECKBOX"), no)).toEqual({ value: false });
  });

  it("link: http(s) addresses only", () => {
    expect(normalizeCellValue(col("LINK"), "https://drive.example.com/a?b=1")).toEqual({ value: "https://drive.example.com/a?b=1" });
    for (const bad of ["javascript:alert(1)", "ftp://x.example.com", "not a url", "drive.example.com"]) expect(normalizeCellValue(col("LINK"), bad)).toHaveProperty("error");
  });

  it("select keeps a value that is no longer in the options (they can be edited later); person must look like an id", () => {
    expect(normalizeCellValue(col("SELECT"), "舊選項")).toEqual({ value: "舊選項" });
    expect(normalizeCellValue(col("PERSON"), "cm123abc")).toEqual({ value: "cm123abc" });
    expect(normalizeCellValue(col("PERSON"), "<script>")).toHaveProperty("error");
  });
});

describe("isEmptyCellValue", () => {
  it("blank text, null and an unticked checkbox are empty; 0 and a ticked box are not", () => {
    expect(isEmptyCellValue({ type: "TEXT" }, "")).toBe(true);
    expect(isEmptyCellValue({ type: "TEXT" }, "  ")).toBe(true);
    expect(isEmptyCellValue({ type: "NUMBER" }, null)).toBe(true);
    expect(isEmptyCellValue({ type: "NUMBER" }, 0)).toBe(false);
    expect(isEmptyCellValue({ type: "CHECKBOX" }, false)).toBe(true);
    expect(isEmptyCellValue({ type: "CHECKBOX" }, true)).toBe(false);
  });
});

describe("validateBomColumns", () => {
  const ok = (cols: unknown) => expect(validateBomColumns(cols)).toHaveProperty("value");
  const bad = (cols: unknown, message: RegExp) => {
    const r = validateBomColumns(cols);
    expect("error" in r && r.error).toMatch(message);
  };

  it("accepts custom columns anywhere in the order, including before the money block", () => {
    ok([custom(), ...builtIn()]);
    ok(withCustom(custom(), custom({ id: "c_zzzz9999", name: "規格書", type: "LINK", options: [] })));
  });

  it("the built-in columns and the money block cannot be removed", () => {
    bad(builtIn().filter((c) => c.id !== "vendor"), /內建欄位.*不能刪除/);
    bad(builtIn().filter((c) => c.id !== "money"), /金額欄位.*不能刪除/);
    bad("x", /格式/);
    bad([null], /格式/);
  });

  it("built-ins can be renamed, hidden, reordered, made required and given a default — but keep their type; the money block is locked", () => {
    const cols = builtIn().map((c) => (c.id === "vendor" ? { ...c, name: "供應商", visible: false, required: true, defaultValue: "待確認", type: "NUMBER" as const } : c));
    const r = validateBomColumns(cols);
    expect("value" in r && r.value.find((c) => c.id === "vendor")).toMatchObject({ name: "供應商", visible: false, required: true, defaultValue: "待確認", type: "TEXT" });
    const locked = validateBomColumns(builtIn().map((c) => (c.id === "money" ? { ...c, name: "金額", visible: false, required: true } : c)));
    expect("value" in locked && locked.value.find((c) => c.id === "money")).toMatchObject({ name: "數量、單價、幣別、小計", visible: true, required: false });
  });

  it("names: not empty, not too long, not a reserved table heading, no duplicates (ignoring case)", () => {
    bad(withCustom(custom({ name: "  " })), /不可為空/);
    bad(withCustom(custom({ name: "字".repeat(31) })), /太長/);
    for (const name of ["名稱", "BOM LEVEL", "bom level", "數量", "單價", "幣別", "匯率", "小計"]) bad(withCustom(custom({ name })), /固定的欄位名稱/);
    bad(withCustom(custom({ name: "廠商" })), /重複/);
    bad(withCustom(custom(), custom({ id: "c_other111", name: "驗證狀態" })), /重複/);
    bad(withCustom(custom({ name: "Alpha" }), custom({ id: "c_other111", name: "alpha" })), /重複/);
  });

  it("custom ids must look like the ones the app makes, and cannot repeat", () => {
    for (const id of ["abc", "c_", "C_ABC12345", "c_<x>", "vendor2"]) bad(withCustom(custom({ id })), /代號/);
    bad(withCustom(custom(), custom({ name: "別的" })), /代號重複/);
  });

  it("a dropdown needs options: non-empty, short, unique, not too many", () => {
    bad(withCustom(custom({ options: [] })), /至少要有一個選項/);
    bad(withCustom(custom({ options: ["a", "a"] })), /重複/);
    bad(withCustom(custom({ options: ["字".repeat(31)] })), /選項太長/);
    bad(withCustom(custom({ options: Array.from({ length: 31 }, (_, i) => `o${i}`) })), /選項太多/);
    const r = validateBomColumns(withCustom(custom({ options: [" 已送樣 ", "", "通過"] })));
    expect("value" in r && r.value.at(-1)?.options).toEqual(["已送樣", "通過"]);
  });

  it("only a dropdown keeps options; an unknown type is refused", () => {
    const r = validateBomColumns(withCustom(custom({ type: "TEXT", options: ["x"] })));
    expect("value" in r && r.value.at(-1)?.options).toEqual([]);
    bad(withCustom(custom({ type: "VIDEO" as never })), /類型/);
  });

  it("a default value has to fit the type, and a dropdown default has to be one of the options", () => {
    ok(withCustom(custom({ defaultValue: "已送樣" })));
    bad(withCustom(custom({ defaultValue: "不存在" })), /不在選項裡/);
    bad(withCustom(custom({ type: "NUMBER", options: [], defaultValue: "abc" })), /預設值.*數字/);
    ok(withCustom(custom({ type: "NUMBER", options: [], defaultValue: 3 })));
    bad(withCustom(custom({ type: "LINK", options: [], defaultValue: "javascript:x" })), /預設值/);
    const person = validateBomColumns(withCustom(custom({ type: "PERSON", options: [], defaultValue: "u1" })));
    expect("value" in person && person.value.at(-1)?.defaultValue).toBeNull(); // 人員沒有預設值
    const box = validateBomColumns(withCustom(custom({ type: "CHECKBOX", options: [], defaultValue: false })));
    expect("value" in box && box.value.at(-1)?.defaultValue).toBeNull();
  });

  it("has a cap on the number of columns", () => {
    const many = withCustom(...Array.from({ length: 30 }, (_, i) => custom({ id: `c_col${String(i).padStart(4, "0")}`, name: `欄${i}`, type: "TEXT", options: [] })));
    bad(many, /太多/);
  });
});

describe("parseBomColumns / resolveBomColumns", () => {
  it("a broken stored setting is treated as 'not set' instead of breaking the table", () => {
    for (const junk of [null, undefined, 5, "x", {}, [], [{ id: "vendor" }], builtIn().slice(1)]) expect(parseBomColumns(junk)).toBeNull();
  });

  it("a board uses its own columns, else the system default, else the built-in set", () => {
    const own = withCustom(custom({ name: "看板自己的" }));
    const system = withCustom(custom({ name: "系統預設" }));
    expect(resolveBomColumns(own, system)).toMatchObject({ source: "board" });
    expect(resolveBomColumns(own, system).columns.at(-1)?.name).toBe("看板自己的");
    expect(resolveBomColumns(null, system)).toMatchObject({ source: "system" });
    expect(resolveBomColumns(null, system).columns.at(-1)?.name).toBe("系統預設");
    expect(resolveBomColumns(null, null)).toEqual({ columns: BUILT_IN_BOM_COLUMNS, source: "built-in" });
    // 看板的設定壞了,退回系統預設
    expect(resolveBomColumns([{ id: "x" }], system).source).toBe("system");
  });

  it("the built-in set it returns can be edited without changing the shared constant", () => {
    const { columns } = resolveBomColumns(null, null);
    columns[0].name = "改過了";
    expect(BUILT_IN_BOM_COLUMNS[0].name).toBe("廠商");
  });
});

describe("defaults and required", () => {
  const cols = withCustom(
    custom({ defaultValue: "未送樣", required: true }),
    custom({ id: "c_num00001", name: "採購量", type: "NUMBER", options: [], defaultValue: 0 }),
    custom({ id: "c_hid00001", name: "隱藏的必填", type: "TEXT", options: [], required: true, visible: false })
  );

  it("交期是週數(數字);以前存的日期預設值當作沒有預設,整份設定照樣讀得回來", () => {
    expect(builtIn().find((c) => c.id === "delivery")?.type).toBe("NUMBER");
    const old = builtIn().map((c) => (c.id === "delivery" ? { ...c, type: "DATE" as const, defaultValue: "2026-11-30" } : c));
    const r = validateBomColumns(old);
    expect("value" in r && r.value.find((c) => c.id === "delivery")).toMatchObject({ type: "NUMBER", defaultValue: null });
    const weeks = validateBomColumns(builtIn().map((c) => (c.id === "delivery" ? { ...c, defaultValue: "8" } : c)));
    expect("value" in weeks && weeks.value.find((c) => c.id === "delivery")?.defaultValue).toBe(8);
  });

  it("initialColumnValues lists only the columns that have a default — the money block never does", () => {
    expect(initialColumnValues(cols)).toEqual({ c_abc12345: "未送樣", c_num00001: 0 });
    expect(initialColumnValues(builtIn())).toEqual({});
  });

  it("missingRequired names the visible required columns that are empty, and ignores hidden ones", () => {
    expect(missingRequired(cols, () => null).map((c) => c.id)).toEqual(["c_abc12345"]);
    expect(missingRequired(cols, (c) => (c.id === "c_abc12345" ? "通過" : null))).toEqual([]);
  });

  it("a required checkbox has to be ticked", () => {
    const boxes = withCustom(custom({ type: "CHECKBOX", options: [], required: true }));
    expect(missingRequired(boxes, () => false)).toHaveLength(1);
    expect(missingRequired(boxes, () => true)).toHaveLength(0);
  });

  it("countRowsMissingRequired counts rows, not columns", () => {
    const two = withCustom(custom({ required: true }), custom({ id: "c_two00001", name: "第二個", type: "TEXT", options: [], required: true }));
    const rows = [
      { valueOf: () => null }, // 兩欄都缺 → 算一列
      { valueOf: (c: BomColumnDef) => (c.id === "c_abc12345" ? "通過" : null) }, // 缺一欄
      { valueOf: () => "都有" },
    ];
    expect(countRowsMissingRequired(two, rows)).toBe(2);
  });
});

describe("column helpers", () => {
  it("only columns that are not built-in or the money block are custom", () => {
    expect(builtIn().filter(isCustomColumn)).toEqual([]);
    expect(isCustomColumn(custom())).toBe(true);
  });

  it("newColumnId makes ids the validator accepts, and they differ", () => {
    const a = newColumnId();
    const b = newColumnId();
    expect(a).not.toBe(b);
    expect(validateBomColumns(withCustom(custom({ id: a }), custom({ id: b, name: "第二個" })))).toHaveProperty("value");
  });
});

describe("importCellValue(Excel 貼上 / 匯入的一格文字)", () => {
  const users = [
    { id: "u1", name: "王小明" },
    { id: "u2", name: "李美玲" },
    { id: "u3", name: "Alex" },
    { id: "u4", name: "alex" },
  ];
  const col = (type: BomColumnDef["type"], options: string[] = []) => ({ name: "欄", type, options });

  it("空白是沒填(勾選是沒勾)", () => {
    for (const type of ["TEXT", "NUMBER", "DATE", "SELECT", "PERSON", "LINK"] as const) expect(importCellValue(col(type, ["a"]), "  ", users)).toEqual({ value: null });
    expect(importCellValue(col("CHECKBOX"), "", users)).toEqual({ value: false });
  });

  it("數字認千分位與貨幣符號;日期認斜線寫法;勾選認「是、Y、1、✓」", () => {
    expect(importCellValue(col("NUMBER"), "NT$1,250", users)).toEqual({ value: 1250 });
    expect(importCellValue(col("NUMBER"), "abc", users)).toHaveProperty("error");
    expect(importCellValue(col("DATE"), "2026/11/4", users)).toEqual({ value: "2026-11-04" });
    expect(importCellValue(col("DATE"), "2026/02/30", users)).toHaveProperty("error");
    for (const yes of ["是", "Y", "yes", "TRUE", "1", "✓", "有"]) expect(importCellValue(col("CHECKBOX"), yes, users)).toEqual({ value: true });
    for (const no of ["否", "N", "0", "沒有"]) expect(importCellValue(col("CHECKBOX"), no, users)).toEqual({ value: false });
  });

  it("下拉選單:選項大小寫不同也對得上,不在選項裡的原樣收", () => {
    expect(importCellValue(col("SELECT", ["已送樣"]), "已送樣", users)).toEqual({ value: "已送樣" });
    expect(importCellValue(col("SELECT", ["OK", "NG"]), "ok", users)).toEqual({ value: "OK" });
    expect(importCellValue(col("SELECT", ["OK"]), "待測", users)).toEqual({ value: "待測" });
  });

  it("人員:拿姓名找(大小寫不分)或直接給帳號代號;找不到或同名好幾個要說明", () => {
    expect(importCellValue(col("PERSON"), "王小明", users)).toEqual({ value: "u1" });
    expect(importCellValue(col("PERSON"), "u2", users)).toEqual({ value: "u2" });
    expect(importCellValue(col("PERSON"), "不存在", users)).toEqual({ error: "「欄」找不到「不存在」這個人" });
    expect(importCellValue(col("PERSON"), "ALEX", users)).toEqual({ error: "「欄」的「ALEX」有好幾個同名的人" });
  });

  it("連結要是網址", () => {
    expect(importCellValue(col("LINK"), "https://a.example.com/x", users)).toEqual({ value: "https://a.example.com/x" });
    expect(importCellValue(col("LINK"), "javascript:1", users)).toHaveProperty("error");
  });
});

describe("檔案附件欄位", () => {
  it("可以建立:沒有選項、沒有預設值(傳了也不收),檔案不經過格子的值", () => {
    const r = validateBomColumns(withCustom(custom({ type: "FILE", options: ["x"], defaultValue: "a.pdf", required: true })));
    expect("value" in r && r.value.at(-1)).toMatchObject({ type: "FILE", options: [], defaultValue: null, required: true });
    expect(normalizeCellValue({ name: "規格書", type: "FILE" }, "任何東西")).toEqual({ value: null });
    expect(importCellValue({ name: "規格書", type: "FILE", options: [] }, "a.pdf", [])).toEqual({ value: null });
    expect(initialColumnValues(withCustom(custom({ type: "FILE" })))).toEqual({});
  });

  it("isStoredCustomColumn:值存在 extra 的只有自訂欄位、而且不是檔案附件", () => {
    expect(isStoredCustomColumn(custom({ type: "TEXT" }))).toBe(true);
    expect(isStoredCustomColumn(custom({ type: "FILE" }))).toBe(false);
    expect(isStoredCustomColumn({ id: "vendor", type: "TEXT" })).toBe(false);
  });
});
