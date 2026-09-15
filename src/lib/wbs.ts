import type { ItemData } from "@/types/board";

type WbsItemLike = { id: string; parentId: string | null; order: number };

/** WBS-style numbering (1, 1.1, 1.1.2, ...) based on each item's position among its siblings. */
export function computeWbsCodes(items: WbsItemLike[]): Map<string, string> {
  const byParent = new Map<string | null, WbsItemLike[]>();
  for (const item of items) {
    const list = byParent.get(item.parentId) ?? [];
    list.push(item);
    byParent.set(item.parentId, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

  const codes = new Map<string, string>();
  function walk(parentId: string | null, prefix: string) {
    (byParent.get(parentId) ?? []).forEach((child, index) => {
      const code = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      codes.set(child.id, code);
      walk(child.id, code);
    });
  }
  walk(null, "");
  return codes;
}

/** Ids of every ancestor (not including the item itself) of the given item. */
/**
 * 兩個 WBS 代號的先後。逐段比數字,不是比字串 —— 字串比較會把 "1.11" 排在
 * "1.9" 前面,因為 "1" < "9"。前綴較短的排前面,所以 "1.2" 在 "1.2.1" 之前。
 *
 * 只在同一個分組裡比才有意義:代號是項目在自己分組樹裡的位置,每個分組都
 * 從 1 重新開始。
 */
export function compareWbsCodes(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const x = Number(left[i] ?? -1);
    const y = Number(right[i] ?? -1);
    if (x !== y) return x - y;
  }
  return 0;
}

export function computeAncestorIds(
  items: ItemData[],
  itemId: string | null | undefined
): Set<string> {
  const ids = new Set<string>();
  if (!itemId) return ids;
  const byId = new Map(items.map((i) => [i.id, i]));
  let current = byId.get(itemId);
  while (current?.parentId) {
    ids.add(current.parentId);
    current = byId.get(current.parentId);
  }
  return ids;
}
