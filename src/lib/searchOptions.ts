/**
 * 下拉選單的搜尋:空白隔開的每個關鍵字都要出現在(名稱 + 補充說明)裡,不分大小寫。
 * 「AMR BOX poc-3」會找到「AMR BOX 專案 / POC-3 費用」,不必照順序、不必連在一起。
 */
export function filterOptions<T extends { label: string; hint?: string }>(options: T[], query: string): T[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options;
  return options.filter((o) => {
    const text = `${o.label} ${o.hint ?? ""}`.toLowerCase();
    return tokens.every((t) => text.includes(t));
  });
}
