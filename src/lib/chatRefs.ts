import type { RefKind } from "@/lib/chatLinks";

/** 一筆風險登記冊的紀錄屬於哪一類:Mantis 同步來的是議題,其他依風險 / 問題。 */
export function riskKindOf(r: { kind: "RISK" | "ISSUE"; mantisId: number | null }): RefKind {
  return r.mantisId !== null ? "mantis" : r.kind === "RISK" ? "risk" : "issue";
}

type RefItem = { id: string; name: string; wbsCode: string; parentId: string | null };

/**
 * 搜尋工作項:名稱或 WBS 代號符合的留下,連同它們的所有上層一起留下(原本的階層順序不變),
 * 才看得出符合的那一項在階層裡的位置。上層本身不符合的標 muted。沒有搜尋字就全部留下、都不 muted。
 */
export function filterItemsKeepingAncestors<T extends RefItem>(items: T[], query: string): { item: T; muted: boolean }[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.map((item) => ({ item, muted: false }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const matched = new Set<string>();
  const keep = new Set<string>();
  for (const i of items) {
    if (!i.name.toLowerCase().includes(q) && !i.wbsCode.includes(q)) continue;
    matched.add(i.id);
    // 往上走到最上層;資料有環也停得下來(已經留下的就不再走)。
    for (let cur: string | null = i.id; cur && !keep.has(cur); cur = byId.get(cur)?.parentId ?? null) keep.add(cur);
  }
  return items.filter((i) => keep.has(i.id)).map((item) => ({ item, muted: !matched.has(item.id) }));
}
