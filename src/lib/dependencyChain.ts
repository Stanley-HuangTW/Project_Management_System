import { parsePredEntries, type RelationshipType, type WbsIndex } from "@/lib/predecessorLink";

/**
 * 甘特圖「相依檢視」:勾選的工作項,連同它整條前置鏈(前置的前置……)與後續鏈
 * (後續的後續……),依先後排成一串 —— 前置在上、後續在下。
 *
 * 「相依」有兩種來源:Pred 欄(甘特圖的箭頭)與日期約束的來源(約束日期跟著哪個前置任務)。
 * 跨看板的項目只要 id 在 index 裡就一樣算。純函式,伺服器與瀏覽器都用同一份。
 */

export type DependencyEdge = {
  predId: string;
  succId: string;
  /** "pred" = Pred 欄,會畫箭頭;"constraint" = 日期約束的來源,只用來找鏈。 */
  kind: "pred" | "constraint";
  /** Pred 邊的關係(這條邊自己的,或後續項目的 Link 欄);不知道時是 null。 */
  relationship: RelationshipType | null;
};

export type DependencySourceItem = {
  id: string;
  groupId: string;
  predValue: unknown;
  /** 後續項目 Link 欄的關係,Pred 那一格沒寫關係時用它。 */
  linkRelationship: RelationshipType | null;
  constraintRefItemId: string | null;
};

/** 這些項目身上的每一條相依(指向 index 裡找不到的項目就略過)。 */
export function dependencyEdgesOf(items: DependencySourceItem[], index: WbsIndex): DependencyEdge[] {
  const edges: DependencyEdge[] = [];
  for (const item of items) {
    for (const entry of parsePredEntries(index, item.groupId, item.predValue)) {
      edges.push({
        predId: entry.itemId,
        succId: item.id,
        kind: "pred",
        relationship: entry.relationship ?? item.linkRelationship,
      });
    }
    const ref = item.constraintRefItemId;
    if (ref && ref !== item.id && index.groupByItemId.has(ref)) {
      edges.push({ predId: ref, succId: item.id, kind: "constraint", relationship: null });
    }
  }
  return edges;
}

/** 勾選的項目 + 所有往上走得到的前置 + 所有往下走得到的後續(不含旁支)。 */
export function dependencyChain(edges: DependencyEdge[], seedIds: Iterable<string>): Set<string> {
  const predsOf = new Map<string, string[]>();
  const succsOf = new Map<string, string[]>();
  for (const e of edges) {
    predsOf.set(e.succId, [...(predsOf.get(e.succId) ?? []), e.predId]);
    succsOf.set(e.predId, [...(succsOf.get(e.predId) ?? []), e.succId]);
  }
  const seeds = [...seedIds];
  const chain = new Set(seeds);
  const walk = (next: Map<string, string[]>) => {
    const seen = new Set(seeds);
    const queue = [...seeds];
    while (queue.length > 0) {
      for (const id of next.get(queue.shift()!) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        chain.add(id);
        queue.push(id);
      }
    }
  };
  walk(predsOf);
  walk(succsOf);
  return chain;
}

/**
 * 把鏈上的項目排成「前置一定在後續上面」的順序;同一層之間依 rank 小的在前
 * (呼叫端給開始日期之類)。有循環的話,剩下的照 rank 接在最後,不會漏掉。
 */
export function orderDependencyChain(
  ids: Iterable<string>,
  edges: DependencyEdge[],
  rank: (id: string) => number
): string[] {
  const members = new Set(ids);
  const inDegree = new Map([...members].map((id) => [id, 0]));
  const succsOf = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!members.has(e.predId) || !members.has(e.succId) || e.predId === e.succId) continue;
    const succs = succsOf.get(e.predId) ?? new Set<string>();
    if (succs.has(e.succId)) continue;
    succs.add(e.succId);
    succsOf.set(e.predId, succs);
    inDegree.set(e.succId, inDegree.get(e.succId)! + 1);
  }
  const byRank = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);
  const ready = [...members].filter((id) => inDegree.get(id) === 0).sort(byRank);
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const succ of succsOf.get(id) ?? []) {
      const left = inDegree.get(succ)! - 1;
      inDegree.set(succ, left);
      if (left === 0) {
        ready.push(succ);
        ready.sort(byRank);
      }
    }
  }
  if (ordered.length < members.size) {
    const placed = new Set(ordered);
    ordered.push(...[...members].filter((id) => !placed.has(id)).sort(byRank));
  }
  return ordered;
}
