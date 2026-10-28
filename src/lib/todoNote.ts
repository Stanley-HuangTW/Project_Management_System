/** 待辦事項備註的長度上限(字)。 */
export const TODO_NOTE_MAX = 1000;

/** 待辦事項名稱(文字)的長度上限(字),新增與改名都用這個。 */
export const TODO_TEXT_MAX = 1000;

/** 備註存檔前整理:頭尾空白去掉、空的就是 null(沒有備註)、太長回 error。 */
export function normalizeTodoNote(raw: string | null): { note: string | null } | { error: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > TODO_NOTE_MAX) return { error: `備註太長了(上限 ${TODO_NOTE_MAX} 字)` };
  return { note: trimmed || null };
}

/** 改名存檔前整理:換行併成一個空白、頭尾空白去掉;空的或太長回 error(名稱不能留空,要清掉請刪除這一筆)。 */
export function normalizeTodoText(raw: string): { text: string } | { error: string } {
  const text = raw.replace(/\s*[\r\n]+\s*/g, " ").trim();
  if (!text) return { error: "請輸入待辦事項的內容" };
  if (text.length > TODO_TEXT_MAX) return { error: `內容太長了(上限 ${TODO_TEXT_MAX} 字)` };
  return { text };
}

/** 寫進稽核紀錄的備註摘要:太長的截斷。 */
export function noteForLog(note: string | null): string {
  if (!note) return "(清空)";
  return note.length > 80 ? `${note.slice(0, 80)}…` : note;
}
