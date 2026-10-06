/**
 * 工時備註的歷史建議:這位成員自己以前登記過什麼備註,下次登記同一個工作項/類別時直接選。
 * 純邏輯,畫面與 server action 共用。
 */

/** scope 是備註當時登記的對象:"item:<工作項 id>"(專案工時)或 "cat:<類別 id>"(非專案工時)。 */
export type NoteRow = { scope: string; text: string; date: string };

export type NoteHistoryEntry = { scope: string; text: string; count: number; last: string };

/** 同一個對象、同一句備註收成一筆:用過幾次、最近一次是哪天。空白備註不算。 */
export function buildNoteHistory(rows: NoteRow[]): NoteHistoryEntry[] {
  const map = new Map<string, NoteHistoryEntry>();
  for (const row of rows) {
    const text = row.text.trim();
    if (!text) continue;
    const key = `${row.scope}\u0000${text}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      if (row.date > existing.last) existing.last = row.date;
    } else {
      map.set(key, { scope: row.scope, text, count: 1, last: row.date });
    }
  }
  return [...map.values()];
}

/**
 * 輸入時的建議清單。關鍵字用空白隔開、每個都要出現(不分大小寫);已經一模一樣的不再建議。
 * 排序:這次登記的對象用過的排前面,再依用過幾次、最近一次。同一句備註在不同對象出現只列一次。
 */
export function suggestNotes(
  history: NoteHistoryEntry[],
  options: { scope: string | null; query: string; limit?: number }
): string[] {
  const tokens = options.query.toLowerCase().split(/\s+/).filter(Boolean);
  const current = options.query.trim().toLowerCase();

  const merged = new Map<string, { text: string; inScope: boolean; count: number; last: string }>();
  for (const entry of history) {
    const lower = entry.text.toLowerCase();
    if (!tokens.every((t) => lower.includes(t))) continue;
    if (lower === current) continue;
    const existing = merged.get(lower);
    const inScope = options.scope !== null && entry.scope === options.scope;
    if (existing) {
      existing.inScope = existing.inScope || inScope;
      existing.count += entry.count;
      if (entry.last > existing.last) existing.last = entry.last;
    } else {
      merged.set(lower, { text: entry.text, inScope, count: entry.count, last: entry.last });
    }
  }

  return [...merged.values()]
    .sort(
      (a, b) =>
        Number(b.inScope) - Number(a.inScope) ||
        b.count - a.count ||
        (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) ||
        a.text.localeCompare(b.text, "zh-TW")
    )
    .slice(0, options.limit ?? 8)
    .map((e) => e.text);
}
