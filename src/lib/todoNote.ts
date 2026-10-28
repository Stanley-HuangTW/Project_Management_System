/** 待辦事項備註的長度上限(字)。 */
export const TODO_NOTE_MAX = 1000;

/** 備註存檔前整理:頭尾空白去掉、空的就是 null(沒有備註)、太長回 error。 */
export function normalizeTodoNote(raw: string | null): { note: string | null } | { error: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed.length > TODO_NOTE_MAX) return { error: `備註太長了(上限 ${TODO_NOTE_MAX} 字)` };
  return { note: trimmed || null };
}

/** 寫進稽核紀錄的備註摘要:太長的截斷。 */
export function noteForLog(note: string | null): string {
  if (!note) return "(清空)";
  return note.length > 80 ? `${note.slice(0, 80)}…` : note;
}
