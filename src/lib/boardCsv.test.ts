import { describe, it, expect } from "vitest";
import {
  csvField,
  csvRow,
  buildBoardCsv,
  parseBoardCsv,
  reconstructDepthTree,
  cellValueToCsvText,
  cellTextToValue,
  ID_HEADER,
} from "./boardCsv";

describe("csvField / csvRow", () => {
  it("一般文字不用加引號", () => {
    expect(csvField("EFS")).toBe("EFS");
  });

  it("含逗號的欄位包上引號", () => {
    expect(csvField("a,b")).toBe('"a,b"');
  });

  it("含雙引號的欄位,引號本身要疊一個", () => {
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("含換行的欄位也要包引號", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("一整列是逗號接起來的欄位", () => {
    expect(csvRow(["a", "b,c", "d"])).toBe('a,"b,c",d');
  });
});

describe("buildBoardCsv / parseBoardCsv 往返", () => {
  it("匯出再匯入,拿回同樣的工作項與欄位值", () => {
    const csv = buildBoardCsv({
      boardId: "board-1",
      boardName: "M3專案",
      columns: [{ name: "Status" }, { name: "負責人" }],
      rows: [
        { id: "item-1", depth: 0, groupName: "M3", name: "EFS", cells: ["進行中", "王小明"] },
        { id: "item-2", depth: 1, groupName: "M3", name: "EFS-1", cells: ["", ""] },
      ],
    });
    const parsed = parseBoardCsv(toMatrix(csv));

    expect(parsed.boardId).toBe("board-1");
    expect(parsed.boardName).toBe("M3專案");
    expect(parsed.columnNames).toEqual(["Status", "負責人"]);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.rows).toEqual([
      { sourceRow: 4, id: "item-1", depth: 0, groupName: "M3", name: "EFS", cells: ["進行中", "王小明"] },
      { sourceRow: 5, id: "item-2", depth: 1, groupName: "M3", name: "EFS-1", cells: ["", ""] },
    ]);
  });

  it("名稱裡有逗號跟中文引號也能正確拿回來", () => {
    const csv = buildBoardCsv({
      boardId: "b",
      boardName: "測試",
      columns: [{ name: "備註" }],
      rows: [{ id: "", depth: 0, groupName: "分組, A", name: 'PVT-7: 說"完成"了', cells: ["ok, done"] }],
    });
    const parsed = parseBoardCsv(toMatrix(csv));
    expect(parsed.rows[0].groupName).toBe("分組, A");
    expect(parsed.rows[0].name).toBe('PVT-7: 說"完成"了');
    expect(parsed.rows[0].cells).toEqual(["ok, done"]);
  });

  it("完全空白的一列略過,不會被讀成一筆資料", () => {
    const csv = buildBoardCsv({
      boardId: "b",
      boardName: "測試",
      columns: [{ name: "X" }],
      rows: [{ id: "", depth: 0, groupName: "G", name: "A", cells: ["1"] }],
    });
    const matrix = toMatrix(csv);
    matrix.splice(4, 0, ["", "", "", "", ""]); // 手動插一列完全空白
    const parsed = parseBoardCsv(matrix);
    expect(parsed.rows).toHaveLength(1);
  });

  it("沒有名稱的列講清楚是哪一列,並且略過", () => {
    const csv = buildBoardCsv({
      boardId: "b",
      boardName: "測試",
      columns: [{ name: "X" }],
      rows: [
        { id: "", depth: 0, groupName: "G", name: "A", cells: ["1"] },
        { id: "", depth: 0, groupName: "G", name: "", cells: ["2"] },
      ],
    });
    const parsed = parseBoardCsv(toMatrix(csv));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.warnings.join()).toContain("沒有名稱");
  });

  it("不是這支程式匯出的檔案就明白拒絕", () => {
    expect(() => parseBoardCsv([["隨便", "亂寫"]])).toThrow(ID_HEADER);
  });

  it("找不到 #boardId 這一行,boardId 就是 null,讓呼叫端自己決定怎麼辦", () => {
    const parsed = parseBoardCsv([[ID_HEADER, "階層", "分組", "名稱"], ["", "0", "G", "A"]]);
    expect(parsed.boardId).toBeNull();
  });
});

/** 模擬「使用者在 Excel/文字編輯器裡把匯出的 CSV 改過」——用逗號分割還原
 *  成 csv-parse 會給的那種矩陣,不用真的引入 csv-parse 依賴來測。 */
function toMatrix(csv: string): string[][] {
  return csv
    .split("\r\n")
    .filter((l) => l !== "")
    .map((line) => {
      // 這裡的測資都刻意涵蓋了帶引號的欄位,所以要走真正的 CSV 欄位切法,
      // 不能只用 split(",")。
      const fields: string[] = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
          if (c === '"' && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else if (c === '"') {
            inQuotes = false;
          } else {
            cur += c;
          }
        } else if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          fields.push(cur);
          cur = "";
        } else {
          cur += c;
        }
      }
      fields.push(cur);
      return fields;
    });
}

describe("reconstructDepthTree", () => {
  it("全部同一階層,大家都是最上層", () => {
    const { rows, warnings } = reconstructDepthTree([{ depth: 0 }, { depth: 0 }]);
    expect(warnings).toEqual([]);
    expect(rows.map((r) => r.parentIndex)).toEqual([null, null]);
  });

  it("退回上一層再往下,對回正確的那一筆祖先", () => {
    const { rows } = reconstructDepthTree([
      { depth: 0 }, // 0
      { depth: 1 }, // 1, parent 0
      { depth: 0 }, // 2
      { depth: 1 }, // 3, parent 2(不是 0)
    ]);
    expect(rows[3].parentIndex).toBe(2);
  });

  it("階層跳太多,自動夾回上一列的下一層並回報警告", () => {
    const { rows, warnings } = reconstructDepthTree([{ depth: 0 }, { depth: 2 }]);
    expect(rows[1].depth).toBe(1);
    expect(rows[1].parentIndex).toBe(0);
    expect(warnings.length).toBe(1);
  });
});

describe("cellValueToCsvText / cellTextToValue 往返", () => {
  it("TEXT 原封不動", () => {
    const text = cellValueToCsvText("hello", { type: "TEXT" });
    expect(text).toBe("hello");
    expect(cellTextToValue(text, { type: "TEXT" })).toEqual({ kind: "value", value: "hello" });
  });

  it("NUMBER 轉成字串再轉回數字", () => {
    const text = cellValueToCsvText(3.5, { type: "NUMBER" });
    expect(text).toBe("3.5");
    expect(cellTextToValue(text, { type: "NUMBER" })).toEqual({ kind: "value", value: 3.5 });
  });

  it("不是數字的文字回傳警告", () => {
    expect(cellTextToValue("三點五", { type: "NUMBER" })).toEqual({
      kind: "warning",
      message: expect.stringContaining("不是數字"),
    });
  });

  it("DATE 原樣往返", () => {
    const text = cellValueToCsvText("2026-09-21", { type: "DATE" });
    expect(text).toBe("2026-09-21");
    expect(cellTextToValue(text, { type: "DATE" })).toEqual({ kind: "value", value: "2026-09-21" });
  });

  it("日期格式不對回傳警告", () => {
    expect(cellTextToValue("2026/9/21", { type: "DATE" }).kind).toBe("warning");
  });

  it("STATUS 用選項的顯示文字往返,不是內部 id", () => {
    const statusOptions = [{ id: "done", label: "已完成", color: "#000" }];
    const text = cellValueToCsvText("done", { type: "STATUS", statusOptions });
    expect(text).toBe("已完成");
    expect(cellTextToValue(text, { type: "STATUS", statusOptions })).toEqual({
      kind: "value",
      value: "done",
    });
  });

  it("STATUS 文字對不到任何既有選項,回報「新選項」讓呼叫端決定要不要新增", () => {
    const statusOptions = [{ id: "done", label: "已完成", color: "#000" }];
    expect(cellTextToValue("卡住了", { type: "STATUS", statusOptions })).toEqual({
      kind: "newStatus",
      label: "卡住了",
    });
  });

  it("PERSON 用姓名往返,不是內部 id", () => {
    const personNameById = new Map([["u1", "王小明"]]);
    const text = cellValueToCsvText("u1", { type: "PERSON", personNameById });
    expect(text).toBe("王小明");
    const personIdByLowerName = new Map([["王小明", "u1"]]);
    expect(cellTextToValue(text, { type: "PERSON", personIdByLowerName })).toEqual({
      kind: "value",
      value: "u1",
    });
  });

  it("PERSON 名字找不到,回傳警告而不是靜靜地清空", () => {
    const personIdByLowerName = new Map<string, string>();
    expect(cellTextToValue("查無此人", { type: "PERSON", personIdByLowerName })).toEqual({
      kind: "warning",
      message: expect.stringContaining("查無此人"),
    });
  });

  it("空字串一律是 null,不分欄位類型", () => {
    expect(cellTextToValue("", { type: "NUMBER" })).toEqual({ kind: "value", value: null });
    expect(cellTextToValue("   ", { type: "TEXT" })).toEqual({ kind: "value", value: null });
  });

  it("null 值轉成 CSV 是空字串", () => {
    expect(cellValueToCsvText(null, { type: "TEXT" })).toBe("");
  });
});
