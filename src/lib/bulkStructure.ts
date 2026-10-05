import { collectSubtreeIds } from "./trash";
import { formatPredEntries, parsePredEntries, type WbsIndex } from "./predecessorLink";

/**
 * 批次複製 / 移動 / 刪除的純計算——不碰 DB,client 與 server 都能跑(與 dragReorder.ts、
 * trash.ts 同一個做法),server action 只負責把結果寫進資料庫。
 */

export type TreeNode = { id: string; parentId: string | null; order: number; groupId: string };

/** 每個分組各自從頭走一遍樹,回傳「畫面上從上到下」的順序。分組依 groupOrder 排,
 *  不在 groupOrder 裡的接在最後。 */
function displayOrder(items: TreeNode[], groupOrder: string[]): Map<string, number> {
  const rank = new Map<string, number>();
  const groupRank = new Map(groupOrder.map((id, index) => [id, index]));
  const groups = [...new Set(items.map((i) => i.groupId))].sort(
    (a, b) => (groupRank.get(a) ?? Infinity) - (groupRank.get(b) ?? Infinity)
  );
  for (const groupId of groups) {
    const inGroup = items.filter((i) => i.groupId === groupId);
    const childrenOf = new Map<string | null, TreeNode[]>();
    for (const item of inGroup) {
      const list = childrenOf.get(item.parentId) ?? [];
      list.push(item);
      childrenOf.set(item.parentId, list);
    }
    for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);
    const seen = new Set<string>();
    const walk = (parentId: string | null) => {
      for (const child of childrenOf.get(parentId) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        rank.set(child.id, rank.size);
        walk(child.id);
      }
    };
    walk(null);
  }
  return rank;
}

/**
 * 勾選的項目裡,祖先也被勾選的不另外算——整個子樹會跟著祖先一起處理,再算一次只會
 * 複製兩份、搬兩次、或讓子項目被刪成跟父項不同批的垃圾桶紀錄。回傳畫面上由上而下的順序。
 * 不存在的 id 直接忽略。
 */
export function collapseToRoots(items: TreeNode[], selectedIds: Iterable<string>, groupOrder: string[]): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const selected = new Set([...selectedIds].filter((id) => byId.has(id)));
  const roots: string[] = [];
  for (const id of selected) {
    let cursor = byId.get(id)!.parentId;
    let hasSelectedAncestor = false;
    const seen = new Set<string>([id]);
    while (cursor && !seen.has(cursor)) {
      if (selected.has(cursor)) {
        hasSelectedAncestor = true;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    if (!hasSelectedAncestor) roots.push(id);
  }
  const rank = displayOrder(items, groupOrder);
  return roots.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
}

/** 這些根項目底下所有項目(含根本身)。 */
export function subtreeIdsOf(items: TreeNode[], rootIds: string[]): Set<string> {
  const all = new Set<string>();
  for (const rootId of rootIds) for (const id of collectSubtreeIds(items, rootId)) all.add(id);
  return all;
}

export type BulkMoveWrite = { id: string; parentId: string | null; order: number; groupId: string };

export type PlanMoveResult =
  | { ok: true; writes: BulkMoveWrite[] }
  | { ok: false; reason: "not-found" | "target-group-mismatch" | "target-in-moved" };

/**
 * 把一批根項目(連同各自的子樹)搬到 targetParentId 底下(null = targetGroupId 的最上層),
 * 依傳入順序接在原有子項目的後面。
 *
 * 跟 resolveItemMove 一樣用「整份重新編號成連續的 0..n-1」,不用位移式寫法;被搬走的根
 * 項目原本所在的父層也會收斂,不留空洞。換分組時,整個子樹的 groupId 一起改,其餘欄位不動。
 * 只回傳真的有變的項目。
 */
export function planMoveToParent(
  items: TreeNode[],
  rootIds: string[],
  targetParentId: string | null,
  targetGroupId: string
): PlanMoveResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  if (rootIds.some((id) => !byId.has(id))) return { ok: false, reason: "not-found" };
  if (targetParentId) {
    const target = byId.get(targetParentId);
    if (!target) return { ok: false, reason: "not-found" };
    if (target.groupId !== targetGroupId) return { ok: false, reason: "target-group-mismatch" };
  }

  const moved = subtreeIdsOf(items, rootIds);
  if (targetParentId && moved.has(targetParentId)) return { ok: false, reason: "target-in-moved" };

  const desired = new Map<string, BulkMoveWrite>();
  const rootSet = new Set(rootIds);

  // 1. 新父層:原有子項目(扣掉被搬的)+ 被搬的根項目,依序重新編號。
  const targetSiblings = items
    .filter((i) => i.parentId === targetParentId && i.groupId === targetGroupId && !moved.has(i.id))
    .sort((a, b) => a.order - b.order);
  [...targetSiblings.map((i) => i.id), ...rootIds].forEach((id, index) => {
    desired.set(id, { id, parentId: targetParentId, order: index, groupId: targetGroupId });
  });

  // 2. 子樹裡的其他項目:換分組才需要改 groupId,父層與順序維持原樣。
  for (const id of moved) {
    if (rootSet.has(id)) continue;
    const item = byId.get(id)!;
    desired.set(id, { id, parentId: item.parentId, order: item.order, groupId: targetGroupId });
  }

  // 3. 根項目原本的父層:剩下的兄弟收斂成連續編號。跟新父層同一個的,上面已經處理過。
  const oldParents = new Map<string, { parentId: string | null; groupId: string }>();
  for (const id of rootIds) {
    const { parentId, groupId } = byId.get(id)!;
    if (parentId === targetParentId && groupId === targetGroupId) continue;
    oldParents.set(`${groupId}:${parentId ?? ""}`, { parentId, groupId });
  }
  for (const { parentId, groupId } of oldParents.values()) {
    items
      .filter((i) => i.parentId === parentId && i.groupId === groupId && !moved.has(i.id))
      .sort((a, b) => a.order - b.order)
      .forEach((item, index) => {
        if (!desired.has(item.id)) desired.set(item.id, { id: item.id, parentId, order: index, groupId });
      });
  }

  const writes = [...desired.values()].filter((w) => {
    const current = byId.get(w.id)!;
    return current.parentId !== w.parentId || current.order !== w.order || current.groupId !== w.groupId;
  });
  return { ok: true, writes };
}

export type PlannedCopy = {
  sourceId: string;
  /** 複本的父項是哪個「來源項目」的複本;null 表示它是根項目,掛在目標父項底下。 */
  parentSourceId: string | null;
  order: number;
};

/**
 * 複製一批根項目連同各自的子樹:依「父項先於子項」的順序列出要建立的項目,每個項目的
 * 順序在自己的父層內重新編號成 0..n-1(維持原本的相對順序);根項目依傳入順序,從
 * firstRootOrder 開始排在目標父層既有子項目的後面。
 */
export function planCopy(items: TreeNode[], rootIds: string[], firstRootOrder: number): PlannedCopy[] {
  const childrenOf = new Map<string, TreeNode[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    const list = childrenOf.get(item.parentId) ?? [];
    list.push(item);
    childrenOf.set(item.parentId, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);

  const planned: PlannedCopy[] = [];
  const seen = new Set<string>();
  const walk = (sourceId: string, parentSourceId: string | null, order: number) => {
    if (seen.has(sourceId)) return;
    seen.add(sourceId);
    planned.push({ sourceId, parentSourceId, order });
    (childrenOf.get(sourceId) ?? []).forEach((child, index) => walk(child.id, sourceId, index));
  };
  rootIds.forEach((rootId, index) => walk(rootId, null, firstRootOrder + index));
  return planned;
}

/**
 * 複本(或搬到新位置的子樹)的 Lvl 要加多少:新的 Lvl = 新父項的 Lvl + 1,放在最上層就是 1。
 * 回傳 null 代表整段跳過、不要捏造數值——根項目自己沒有數字 Lvl,或新父項沒有數字 Lvl
 * (targetParentLvl 為 undefined)。跟 moveItemWithinGroup 的 Lvl 連動同一個規則。
 */
export function lvlShiftFor(rootLvl: unknown, targetParentLvl: number | null | undefined): number | null {
  if (typeof rootLvl !== "number") return null;
  if (targetParentLvl === undefined) return null;
  const newLvl = targetParentLvl === null ? 1 : targetParentLvl + 1;
  return newLvl - rootLvl;
}

/**
 * 複本的 Pred 值:指到「這次一起複製的項目」的,改指到它們的複本;指到範圍外的維持原樣
 * (複本跟原件等待同一個前置)。逐筆解析再寫回,所以每條依賴自己的 :FS/:SS 與 +N 天
 * 延遲都保留;舊匯入留下的 WBS 編號也在這裡依「來源項目自己的分組」解析成 id,
 * 不會因為複本放進別的分組而指錯人。沒有任何可解析的前置就回傳 null。
 */
export function remapPredValue(
  index: WbsIndex,
  sourceGroupId: string,
  value: unknown,
  idMap: Map<string, string>
): string | null {
  const entries = parsePredEntries(index, sourceGroupId, value);
  return formatPredEntries(entries.map((entry) => ({ ...entry, itemId: idMap.get(entry.itemId) ?? entry.itemId })));
}
