/**
 * 解析從 Excel / Google 試算表複製出來的純文字(text/plain):列用換行分隔、欄用 Tab 分隔;
 * 內容裡有 Tab、換行或雙引號的儲存格會被雙引號包起來,裡面的雙引號寫成兩個("")。
 *
 * 文字最後的那個換行不算一列(試算表複製出來的範圍一律以換行結尾);中間的空行保留成空白列,
 * 因為貼回去要跟畫面上的列一一對齊。
 */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  /** 雙引號只有出現在儲存格開頭才算「開始包起來」,中間的雙引號就是一個字元。 */
  let atCellStart = true;

  const endCell = () => {
    row.push(cell);
    cell = "";
    atCellStart = true;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && atCellStart) {
      inQuotes = true;
      atCellStart = false;
    } else if (ch === "\t") {
      endCell();
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") {
      endRow();
    } else {
      cell += ch;
      atCellStart = false;
    }
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
