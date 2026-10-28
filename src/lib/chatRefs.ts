import type { RefKind } from "@/lib/chatLinks";

/** 一筆風險登記冊的紀錄屬於哪一類:風險,或議題(含從 Mantis 同步來的)。 */
export function riskKindOf(r: { kind: "RISK" | "ISSUE" }): RefKind {
  return r.kind === "RISK" ? "risk" : "issue";
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

type TreeRow = { id: string; parentId: string | null };

/** 有子項的工作項(清單上才要放收放的箭頭)。 */
export function parentIdsOf(items: TreeRow[]): Set<string> {
  const ids = new Set(items.map((i) => i.id));
  return new Set(items.flatMap((i) => (i.parentId && ids.has(i.parentId) ? [i.parentId] : [])));
}

/**
 * 樹狀清單要顯示哪些列:items 要是「父項在前、子項接在後」的順序(伺服器出的就是);
 * 一列要顯示,得每一層上層都是展開的。上層不在清單裡的(例如看不到的私人項目)當最上層。
 */
export function visibleTreeRows<T extends TreeRow>(items: T[], expanded: ReadonlySet<string>): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const shown = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const parent = item.parentId && byId.has(item.parentId) ? item.parentId : null;
    if (parent === null || (shown.has(parent) && expanded.has(parent))) {
      shown.add(item.id);
      out.push(item);
    }
  }
  return out;
}
