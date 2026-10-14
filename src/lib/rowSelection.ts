import { subtreeIdsOf, type TreeNode } from "@/lib/bulkStructure";

/**
 * 勾選(或取消勾選)一列。父項被收成一行時看不到底下的子項,所以整個子樹一起勾、一起取消;
 * 展開著的父項只動它自己那一列(子項各自勾)。
 */
export function toggleRowSelection(
  items: TreeNode[],
  selected: ReadonlySet<string>,
  itemId: string,
  checked: boolean,
  collapsed: boolean
): Set<string> {
  const ids = collapsed ? subtreeIdsOf(items, [itemId]) : new Set([itemId]);
  const next = new Set(selected);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}
