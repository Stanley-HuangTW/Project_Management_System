/**
 * 公司組織架構圖:部門(處、部、課…)成樹,每個部門有一位主管,人掛在部門底下。
 * 「誰是誰的直屬主管」不另外存,由這棵樹算出來,寫回 User.supervisorId —— 簽核、可見範圍、
 * 主管的下轄範圍本來就都讀 supervisorId,所以全部沿用,不用各自改。
 *
 * 全部是純函式(不碰資料庫),畫面端與伺服器端走同一份。
 */

export type OrgNodeLite = {
  id: string;
  name: string;
  parentId: string | null;
  headId: string | null;
  order: number;
  /** 這個部門對應的人力單位代號(EE、ME…);沒設就沿用上層部門的。 */
  unitCode?: string | null;
};

export type OrgPerson = { id: string; orgNodeId: string | null; supervisorId: string | null };

/** 部門在樹上的層級:最上層 = 1。資料裡若有環,走到看過的就停。 */
export function nodeDepth(nodes: OrgNodeLite[], nodeId: string): number {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const seen = new Set<string>([nodeId]);
  let depth = 1;
  let current = parentOf.get(nodeId) ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parentOf.get(current) ?? null;
  }
  return depth;
}

/** 把 nodeId 掛到 newParentId 底下會不會繞成環(自己掛自己、掛到自己的下層都算)。 */
export function wouldCreateNodeCycle(nodes: OrgNodeLite[], nodeId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const seen = new Set<string>();
  let cursor: string | null = newParentId;
  while (cursor && !seen.has(cursor)) {
    if (cursor === nodeId) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

/** 某個部門底下(含它自己)的所有部門 id。 */
export function descendantNodeIds(nodes: OrgNodeLite[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    childrenOf.set(n.parentId, [...(childrenOf.get(n.parentId) ?? []), n.id]);
  }
  const found = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (found.has(id)) continue;
    found.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return found;
}

/**
 * 一個掛在部門底下的人,直屬主管是誰:從他所在的部門往上找,第一個「有主管、而且主管不是他自己」的部門的主管。
 * 所以部門的主管本人往上找到的是上一層部門的主管;沒有主管的部門直接跳過;一路到頂都沒有就是 null。
 * 兼任好幾個部門主管的人,所在部門以外那幾層自己是自己的主管,同樣跳過。
 */
export function supervisorFromOrg(nodes: OrgNodeLite[], person: { id: string; orgNodeId: string | null }): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let nodeId = person.orgNodeId;
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = byId.get(nodeId);
    if (!node) return null;
    if (node.headId && node.headId !== person.id) return node.headId;
    nodeId = node.parentId;
  }
  return null;
}

export type SupervisorChange = { userId: string; supervisorId: string | null };

/**
 * 依架構圖,哪些人的 supervisorId 要改。沒掛部門的人不動(他們的主管還是手動指定的)。
 * 只回傳「跟現在不一樣」的。
 */
export function planSupervisorSync(nodes: OrgNodeLite[], people: OrgPerson[]): SupervisorChange[] {
  const changes: SupervisorChange[] = [];
  for (const person of people) {
    if (!person.orgNodeId) continue;
    const next = supervisorFromOrg(nodes, person);
    if (next !== person.supervisorId) changes.push({ userId: person.id, supervisorId: next });
  }
  return changes;
}

/**
 * 套用之後的主管關係裡有沒有環(A 是 B 的主管、B 又是 A 的主管)。有的話回傳環裡的一個人。
 * 例:某人掛在 A 部門底下、卻是 A 的上層部門的主管,就會變成「上層主管的主管是自己的部屬」。
 */
export function findSupervisorCycle(
  people: { id: string; supervisorId: string | null }[],
  changes: SupervisorChange[]
): string | null {
  const supervisorOf = new Map(people.map((p) => [p.id, p.supervisorId]));
  for (const change of changes) supervisorOf.set(change.userId, change.supervisorId);
  for (const person of people) {
    const seen = new Set<string>([person.id]);
    let current = supervisorOf.get(person.id) ?? null;
    while (current) {
      if (seen.has(current)) return person.id;
      seen.add(current);
      current = supervisorOf.get(current) ?? null;
    }
  }
  return null;
}

export type OrgTreeNode = { node: OrgNodeLite; children: OrgTreeNode[] };

/** 同一層的順序:先照 order,再照名稱。畫面與拖曳都用這一個。 */
const byOrder = (a: OrgNodeLite, b: OrgNodeLite) => a.order - b.order || a.name.localeCompare(b.name, "zh-TW");

/** 依 parentId 組成樹(根 = 沒有上層的部門),同一層照 order、再照名稱排。成環的資料不會被丟掉,各自當作根。 */
export function buildOrgForest(nodes: OrgNodeLite[]): OrgTreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, OrgNodeLite[]>();
  for (const n of nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), n]);
  }
  const sorted = (list: OrgNodeLite[]) => [...list].sort(byOrder);
  const placed = new Set<string>();
  const build = (n: OrgNodeLite): OrgTreeNode => {
    placed.add(n.id);
    return { node: n, children: sorted(childrenOf.get(n.id) ?? []).filter((c) => !placed.has(c.id)).map(build) };
  };
  const roots = sorted(childrenOf.get(null) ?? []).map(build);
  // 環裡面的部門(彼此當對方的上層)沒有根可以接,另外各自成一棵,免得從畫面上消失。
  for (const n of sorted(nodes)) if (!placed.has(n.id)) roots.push(build(n));
  return roots;
}

/** parentId 底下的部門(null = 最上層),照畫面上的順序。上層不存在的部門視同最上層,跟 buildOrgForest 一致。 */
export function orgChildren(nodes: OrgNodeLite[], parentId: string | null): OrgNodeLite[] {
  const ids = new Set(nodes.map((n) => n.id));
  return nodes.filter((n) => (n.parentId && ids.has(n.parentId) ? n.parentId : null) === parentId).sort(byOrder);
}

/** 拖曳時,放在目標部門的哪個位置:前面、後面(同一層),或裡面(變成它的下層)。 */
export type OrgDropZone = "before" | "after" | "child";

/** 拖完之後的位置:新的上層(null = 最上層),以及在新同層裡的第幾個(不含被拖的這個部門)。 */
export type OrgPlacement = { parentId: string | null; index: number };

/**
 * 把 draggedId 拖到 targetId 的前面 / 後面 / 裡面,會落在哪裡。
 * 放到自己、放到自己的下層(會繞成環)、或放了之後位置沒變 → null(不能放 / 不用做)。
 */
export function resolveOrgDrop(
  nodes: OrgNodeLite[],
  draggedId: string,
  targetId: string,
  zone: OrgDropZone
): OrgPlacement | null {
  const dragged = nodes.find((n) => n.id === draggedId);
  const target = nodes.find((n) => n.id === targetId);
  if (!dragged || !target || draggedId === targetId) return null;
  if (descendantNodeIds(nodes, draggedId).has(targetId)) return null;

  const ids = new Set(nodes.map((n) => n.id));
  const parentOf = (n: OrgNodeLite) => (n.parentId && ids.has(n.parentId) ? n.parentId : null);
  const parentId = zone === "child" ? target.id : parentOf(target);
  const siblings = orgChildren(nodes, parentId).filter((n) => n.id !== draggedId);
  const index = zone === "child" ? siblings.length : siblings.findIndex((n) => n.id === targetId) + (zone === "after" ? 1 : 0);

  if (parentOf(dragged) === parentId && orgChildren(nodes, parentId).findIndex((n) => n.id === draggedId) === index) return null;
  return { parentId, index };
}

/**
 * 把 nodeId 放到 parentId 底下的第 index 個位置之後,新同層要寫回資料庫的 { 上層, 順序 }。
 * 新同層整個重新編成 0、1、2…(不怕原本有並列的 order),只回傳有變的;舊的同層留著空號,順序不受影響。
 */
export function planOrgMove(
  nodes: OrgNodeLite[],
  nodeId: string,
  parentId: string | null,
  index: number
): { id: string; parentId: string | null; order: number }[] {
  const moving = nodes.find((n) => n.id === nodeId);
  if (!moving) return [];
  const siblings = orgChildren(nodes, parentId).filter((n) => n.id !== nodeId);
  const at = Math.max(0, Math.min(index, siblings.length));
  const ordered = [...siblings.slice(0, at), moving, ...siblings.slice(at)];
  const updates: { id: string; parentId: string | null; order: number }[] = [];
  ordered.forEach((n, order) => {
    const changed = n.id === nodeId ? n.parentId !== parentId || n.order !== order : n.order !== order;
    if (changed) updates.push({ id: n.id, parentId, order });
  });
  return updates;
}

/**
 * 掛在 nodeId 底下的人算哪個人力單位:從這個部門往上找,第一個有對應單位的部門的代號。
 * 一路到頂都沒有對應就是 null(那就不替他決定單位)。
 */
export function unitCodeFromOrg(nodes: OrgNodeLite[], nodeId: string | null): string | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  let cursor = nodeId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (!node) return null;
    if (node.unitCode) return node.unitCode;
    cursor = node.parentId;
  }
  return null;
}

export type DisciplineChange = { userId: string; discipline: string };

/**
 * 依部門對應,哪些人的所屬單位(User.discipline)要改。只管掛在部門底下、而且部門(或上層)有對應單位的人;
 * 沒有對應的部門不動他現有的單位(取消對應不會把已經帶入的單位清掉)。只回傳「跟現在不一樣」的。
 */
export function planDisciplineSync(
  nodes: OrgNodeLite[],
  people: { id: string; orgNodeId: string | null; discipline: string | null }[]
): DisciplineChange[] {
  const changes: DisciplineChange[] = [];
  for (const person of people) {
    const code = unitCodeFromOrg(nodes, person.orgNodeId);
    if (code && code !== person.discipline) changes.push({ userId: person.id, discipline: code });
  }
  return changes;
}

/** 把樹攤平成由上到下的清單(下拉選單用):每個部門帶它的層級(最上層 = 1),順序同畫面。 */
export function flattenOrgForest(nodes: OrgNodeLite[]): { node: OrgNodeLite; depth: number }[] {
  const out: { node: OrgNodeLite; depth: number }[] = [];
  const walk = (tree: OrgTreeNode, depth: number) => {
    out.push({ node: tree.node, depth });
    tree.children.forEach((child) => walk(child, depth + 1));
  };
  buildOrgForest(nodes).forEach((tree) => walk(tree, 1));
  return out;
}
