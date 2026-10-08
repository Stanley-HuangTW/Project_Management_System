import { describe, expect, it } from "vitest";
import {
  columnPasteSkipReason,
  parseDateText,
  parsePastedCell,
  planColumnReplace,
  planNewItems,
  type PasteColumn,
  type PasteContext,
} from "./pasteValues";

const status: PasteColumn = {
  id: "status",
  name: "Status",
  type: "STATUS",
  options: {
    statuses: [
      { id: "todo", label: "待處理", color: "#ccc" },
      { id: "doing", label: "進行中", color: "#fa0" },
      { id: "done", label: "Done", color: "#0c8" },
    ],
  },
};
const person: PasteColumn = { id: "owner", name: "負責人", type: "PERSON", options: null };
const date: PasteColumn = { id: "due", name: "Finish", type: "DATE", options: null };
const num: PasteColumn = { id: "cost", name: "Cost", type: "NUMBER", options: null };
const progress: PasteColumn = { id: "pct", name: "% Done", type: "NUMBER", options: null };
const text: PasteColumn = { id: "note", name: "Note", type: "TEXT", options: null };

const ctx: PasteContext = {
  progressColumnId: "pct",
  users: [
    { id: "u1", name: "王小明", email: "wang@example.com" },
    { id: "u2", name: "李小華", email: "lee@example.com" },
    { id: "u3", name: "陳同名", email: "chen1@example.com" },
    { id: "u4", name: "陳同名", email: "chen2@example.com" },
  ],
};

describe("parseDateText", () => {
  it("認得常見的寫法,輸出一律是 YYYY-MM-DD", () => {
    expect(parseDateText("2026-10-08")).toBe("2026-10-08");
    expect(parseDateText("2026/10/8")).toBe("2026-10-08");
    expect(parseDateText("2026.1.5")).toBe("2026-01-05");
    expect(parseDateText("20261008")).toBe("2026-10-08");
  });

  it("不是真的日期、或有歧義的不猜", () => {
    expect(parseDateText("2026-02-30")).toBeNull();
    expect(parseDateText("2026/13/1")).toBeNull();
    expect(parseDateText("10/8")).toBeNull();
    expect(parseDateText("10/8/2026")).toBeNull();
    expect(parseDateText("明天")).toBeNull();
  });
});

describe("parsePastedCell", () => {
  it("空白清空那一格", () => {
    expect(parsePastedCell(text, "  ", ctx)).toEqual({ ok: true, value: null });
    expect(parsePastedCell(date, "", ctx)).toEqual({ ok: true, value: null });
  });

  it("文字:去掉頭尾空白", () => {
    expect(parsePastedCell(text, "  已跟廠商確認 ", ctx)).toEqual({ ok: true, value: "已跟廠商確認" });
  });

  it("數字:千分位逗號可以;不是數字、一般欄位帶百分比符號會說原因", () => {
    expect(parsePastedCell(num, "1,250.5", ctx)).toEqual({ ok: true, value: 1250.5 });
    expect(parsePastedCell(num, "abc", ctx).ok).toBe(false);
    expect(parsePastedCell(num, "50%", ctx)).toMatchObject({ ok: false });
  });

  it("進度欄:畫面是百分比,存 0–1;「50」跟「50%」一樣;超出範圍不貼", () => {
    expect(parsePastedCell(progress, "50", ctx)).toEqual({ ok: true, value: 0.5 });
    expect(parsePastedCell(progress, "50%", ctx)).toEqual({ ok: true, value: 0.5 });
    expect(parsePastedCell(progress, "100", ctx)).toEqual({ ok: true, value: 1 });
    expect(parsePastedCell(progress, "120", ctx).ok).toBe(false);
  });

  it("日期:轉成 ISO;看不懂的說原因", () => {
    expect(parsePastedCell(date, "2026/10/8", ctx)).toEqual({ ok: true, value: "2026-10-08" });
    const bad = parsePastedCell(date, "下週", ctx);
    expect(bad.ok).toBe(false);
  });

  it("狀態:用標籤(不分大小寫)或 id 對選項,存的是選項 id", () => {
    expect(parsePastedCell(status, "進行中", ctx)).toEqual({ ok: true, value: "doing" });
    expect(parsePastedCell(status, "done", ctx)).toEqual({ ok: true, value: "done" });
    expect(parsePastedCell(status, "todo", ctx)).toEqual({ ok: true, value: "todo" });
  });

  it("狀態:沒有這個選項就列出可選的", () => {
    const r = parsePastedCell(status, "卡住", ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toContain("沒有「卡住」這個選項");
      expect(r.reason).toContain("待處理、進行中、Done");
    }
  });

  it("成員:用姓名或 Email 對;同名要說,找不到要說", () => {
    expect(parsePastedCell(person, "王小明", ctx)).toEqual({ ok: true, value: "u1" });
    expect(parsePastedCell(person, "LEE@example.com", ctx)).toEqual({ ok: true, value: "u2" });
    const dup = parsePastedCell(person, "陳同名", ctx);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.reason).toContain("2 位");
    expect(parsePastedCell(person, "chen2@example.com", ctx)).toEqual({ ok: true, value: "u4" });
    expect(parsePastedCell(person, "路人甲", ctx).ok).toBe(false);
  });
});

describe("planColumnReplace(整欄取代)", () => {
  const targets = [
    { itemId: "a", name: "甲" },
    { itemId: "b", name: "乙" },
    { itemId: "c", name: "丙" },
  ];

  it("框選的格子由上到下,對應貼上的每一行", () => {
    const plan = planColumnReplace({ column: status, targets, lines: ["待處理", "進行中", "Done"], ctx });
    expect(plan.entries).toEqual([
      { itemId: "a", value: "todo" },
      { itemId: "b", value: "doing" },
      { itemId: "c", value: "done" },
    ]);
    expect(plan.problems).toEqual([]);
    expect(plan.note).toBeNull();
  });

  it("只貼一行:框選的每一格都填同樣的值", () => {
    const plan = planColumnReplace({ column: status, targets, lines: ["Done"], ctx });
    expect(plan.entries.map((e) => e.value)).toEqual(["done", "done", "done"]);
    expect(plan.note).toBeNull();
  });

  it("行數比格數多:多的不貼,並說明", () => {
    const plan = planColumnReplace({ column: text, targets, lines: ["1", "2", "3", "4"], ctx });
    expect(plan.entries).toHaveLength(3);
    expect(plan.note).toContain("多出的 1 行沒有貼");
  });

  it("行數比格數少:其餘的格子不動,並說明", () => {
    const plan = planColumnReplace({ column: text, targets, lines: ["1", "2"], ctx });
    expect(plan.entries.map((e) => e.itemId)).toEqual(["a", "b"]);
    expect(plan.note).toContain("其餘 1 格沒有動");
  });

  it("轉不過去或不能貼的格子不寫、回報原因,不影響其他格", () => {
    const plan = planColumnReplace({
      column: status,
      targets: [
        { itemId: "a", name: "甲" },
        { itemId: "b", name: "乙", skipReason: "有子項目,進度由子項目統計" },
        { itemId: "c", name: "丙" },
      ],
      lines: ["進行中", "Done", "卡住"],
      ctx,
    });
    expect(plan.entries).toEqual([{ itemId: "a", value: "doing" }]);
    expect(plan.problems).toHaveLength(2);
    expect(plan.problems[0]).toContain("「乙」:有子項目");
    expect(plan.problems[1]).toContain("「丙」:沒有「卡住」這個選項");
  });

  it("空白的行清空那一格", () => {
    const plan = planColumnReplace({ column: text, targets, lines: ["x", "", "z"], ctx });
    expect(plan.entries).toEqual([
      { itemId: "a", value: "x" },
      { itemId: "b", value: null },
      { itemId: "c", value: "z" },
    ]);
  });
});

describe("planNewItems(貼上新增項目)", () => {
  const columns: PasteColumn[] = [status, person, date];
  const noSkip = () => null;

  it("只有一欄:每一列一個項目,名稱去頭尾空白,空行不建", () => {
    const plan = planNewItems({ table: [["韌體 "], [""], ["硬體"]], columns, skipReason: noSkip, ctx });
    expect(plan.rows.map((r) => r.name)).toEqual(["韌體", "硬體"]);
    expect(plan.rows.every((r) => r.cells.length === 0)).toBe(true);
    expect(plan.problems).toEqual([]);
  });

  it("多欄:第一欄是名稱,其餘欄依序對應到表格由左到右的欄位", () => {
    const plan = planNewItems({
      table: [["韌體", "進行中", "王小明", "2026/10/20"]],
      columns,
      skipReason: noSkip,
      ctx,
    });
    expect(plan.rows).toEqual([
      {
        name: "韌體",
        cells: [
          { columnId: "status", value: "doing" },
          { columnId: "owner", value: "u1" },
          { columnId: "due", value: "2026-10-20" },
        ],
      },
    ]);
    expect(plan.mapping.map((m) => m.target)).toEqual(["項目名稱", "Status", "負責人", "Finish"]);
  });

  it("不能貼的欄位整欄略過,但後面的欄位還是照原本的位置對應", () => {
    const plan = planNewItems({
      table: [["韌體", "進行中", "王小明"]],
      columns,
      skipReason: (c) => (c.id === "status" ? "自動計算" : null),
      ctx,
    });
    expect(plan.rows[0].cells).toEqual([{ columnId: "owner", value: "u1" }]);
    expect(plan.mapping[1]).toMatchObject({ target: "Status", skipReason: "自動計算" });
  });

  it("空白的格子不寫;轉不過去的格子留空並回報,項目還是會建", () => {
    const plan = planNewItems({
      table: [["韌體", "卡住", "", "2026/10/20"]],
      columns,
      skipReason: noSkip,
      ctx,
    });
    expect(plan.rows[0].cells).toEqual([{ columnId: "due", value: "2026-10-20" }]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toContain("「韌體」的「Status」");
  });

  it("貼的欄數比表格欄位多:多的欄沒有對應,說明出來", () => {
    const plan = planNewItems({ table: [["a", "進行中", "王小明", "2026-10-20", "e"]], columns, skipReason: noSkip, ctx });
    expect(plan.mapping[4]).toMatchObject({ target: "(沒有對應的欄位)" });
    expect(plan.rows[0].cells).toHaveLength(3);
  });

  it("有別的內容卻沒有名稱的列不建,並說明;完全空白的列不算", () => {
    const plan = planNewItems({ table: [["", "進行中"], ["", ""], ["乙"]], columns, skipReason: noSkip, ctx });
    expect(plan.rows.map((r) => r.name)).toEqual(["乙"]);
    expect(plan.problems).toEqual(["1 列沒有名稱(第一欄是空的),沒有建立。"]);
  });
});

describe("columnPasteSkipReason", () => {
  it("Pred 與 Lvl 不能貼,說得出原因;其他欄位可以", () => {
    const pred: PasteColumn = { id: "pred", name: "Pred", type: "TEXT", options: null };
    const lvl: PasteColumn = { id: "lvl", name: "Lvl", type: "NUMBER", options: null };
    expect(columnPasteSkipReason(pred, { predColumnId: "pred" })).toContain("Pred");
    expect(columnPasteSkipReason(lvl, { predColumnId: "pred" })).toContain("Lvl");
    expect(columnPasteSkipReason(text, { predColumnId: "pred" })).toBeNull();
    expect(columnPasteSkipReason(status, { predColumnId: null })).toBeNull();
  });
});
