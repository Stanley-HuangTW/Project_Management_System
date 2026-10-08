import { describe, expect, it } from "vitest";
import { parseClipboardTable } from "./clipboardTable";

describe("parseClipboardTable", () => {
  it("一欄的名單:每行一列", () => {
    expect(parseClipboardTable("甲\n乙\n丙")).toEqual([["甲"], ["乙"], ["丙"]]);
  });

  it("Excel 複製出來的範圍以換行結尾,最後那個換行不算一列;Windows 的 \\r\\n 也一樣", () => {
    expect(parseClipboardTable("甲\r\n乙\r\n")).toEqual([["甲"], ["乙"]]);
    expect(parseClipboardTable("甲\n")).toEqual([["甲"]]);
  });

  it("多欄用 Tab 分隔", () => {
    expect(parseClipboardTable("名稱\t狀態\t負責人\n韌體\t進行中\t王小明")).toEqual([
      ["名稱", "狀態", "負責人"],
      ["韌體", "進行中", "王小明"],
    ]);
  });

  it("空白儲存格與中間的空行保留,貼回去才跟畫面上的列對得齊", () => {
    expect(parseClipboardTable("甲\t\t丙\n\n丁")).toEqual([["甲", "", "丙"], [""], ["丁"]]);
  });

  it("用雙引號包起來的儲存格:裡面可以有 Tab、換行,雙引號寫成兩個", () => {
    expect(parseClipboardTable('"第一行\n第二行"\t"他說""好"""\tx')).toEqual([["第一行\n第二行", '他說"好"', "x"]]);
  });

  it("儲存格中間的雙引號就是一個字元,不是包起來的開頭", () => {
    expect(parseClipboardTable('3" 螺絲\t5"')).toEqual([['3" 螺絲', '5"']]);
  });

  it("沒有結尾換行的最後一列照樣算;空字串沒有任何列", () => {
    expect(parseClipboardTable("a\tb")).toEqual([["a", "b"]]);
    expect(parseClipboardTable("")).toEqual([]);
  });
});
