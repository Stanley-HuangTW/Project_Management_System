/**
 * 主管階層。所屬主管本來只有「團隊成員 → 主管」一層,主管自己不能有主管,
 * 所以整張組織圖被鎖死在剛好兩階。放開之後鏈可以是任意深度(2 階、3 階,
 * 或更深),於是三件事變成必要的:走整個下轄範圍而不是只看一層、擋掉會
 * 繞回自己的指派、以及知道一條鏈有多深。
 *
 * 這裡全部是純函式,吃的是已經載入的使用者清單 —— 畫面端(甘特圖、看板、
 * 指派視窗)跟伺服器端用的是同一份邏輯,不會各算各的。
 */

export type OrgNode = { id: string; supervisorId?: string | null };

/**
 * 某個人下轄的所有人,含隔階的部屬,不含自己。
 *
 * 即使資料裡真的存在環(舊資料、或有人繞過檢查寫進去),這裡也一定會停 ——
 * 走訪用的是「看過就不再看」,不是深度上限。
 */
export function subordinateIds(users: OrgNode[], rootId: string): Set<string> {
  const directReports = new Map<string, string[]>();
  for (const user of users) {
    if (!user.supervisorId) continue;
    const siblings = directReports.get(user.supervisorId);
    if (siblings) siblings.push(user.id);
    else directReports.set(user.supervisorId, [user.id]);
  }

  const found = new Set<string>();
  const queue = [...(directReports.get(rootId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === rootId || found.has(id)) continue;
    found.add(id);
    queue.push(...(directReports.get(id) ?? []));
  }
  return found;
}

/** 某個人自己加上他下轄的所有人 —— 「我的團隊」通常要含自己。 */
export function teamIds(users: OrgNode[], rootId: string): Set<string> {
  const ids = subordinateIds(users, rootId);
  ids.add(rootId);
  return ids;
}

export type OrgUnit = { id: string; parentId: string | null; headId: string | null };

/**
 * 副主管(組織架構圖上勾了「可代簽」的人)負責的那幾個部門的人:部門本身的成員,加上底下所有子部門的成員與子部門的主管;
 * 不含部門自己的主管。只算「他擔任副主管的那個部門」,不是那位主管整條下轄——主管可能同時是更大部門的主管
 * (例如研發處的主管兼任底下專案室的主管),副主管只看他那一個部門。
 */
export function deputyTeamIds(
  units: OrgUnit[],
  members: { id: string; orgNodeId?: string | null }[],
  deputyUnitIds: readonly string[]
): Set<string> {
  const childrenOf = new Map<string, OrgUnit[]>();
  for (const unit of units) {
    if (!unit.parentId) continue;
    const siblings = childrenOf.get(unit.parentId);
    if (siblings) siblings.push(unit);
    else childrenOf.set(unit.parentId, [unit]);
  }
  const unitById = new Map(units.map((u) => [u.id, u]));
  const ids = new Set<string>();
  for (const deputyUnitId of deputyUnitIds) {
    const root = unitById.get(deputyUnitId);
    if (!root) continue;
    const inside = new Set<string>();
    const queue = [root];
    while (queue.length > 0) {
      const unit = queue.shift()!;
      if (inside.has(unit.id)) continue; // 資料裡有環也停得下來
      inside.add(unit.id);
      if (unit.id !== root.id && unit.headId) ids.add(unit.headId);
      queue.push(...(childrenOf.get(unit.id) ?? []));
    }
    for (const member of members) if (member.orgNodeId && inside.has(member.orgNodeId)) ids.add(member.id);
    if (root.headId) ids.delete(root.headId);
  }
  return ids;
}

/**
 * 「我的團隊」要看哪些人(只是看,不含任何管理權限):
 * - 主管:自己加下轄;
 * - 副主管:自己加上他擔任副主管的部門的人(deputyTeam,見 deputyTeamIds);
 * - 兩種身分都有就合起來。
 * 都不是就回 null(沒有團隊可看)。
 */
export function teamViewIds(
  users: OrgNode[],
  selfId: string,
  options: { isSupervisor: boolean; deputyTeam: readonly string[] }
): Set<string> | null {
  if (!options.isSupervisor && options.deputyTeam.length === 0) return null;
  const ids = new Set<string>([selfId]);
  if (options.isSupervisor) for (const id of subordinateIds(users, selfId)) ids.add(id);
  for (const id of options.deputyTeam) ids.add(id);
  return ids;
}

/**
 * 把 supervisorId 指給 userId 會不會繞成環。自己指自己算,A→B→A 也算 ——
 * 一旦成環,這群人就會從組織圖上消失(誰的下轄範圍都不包含他們),而且
 * 每一次走訪都得靠 visited 才收得住。
 */
export function wouldCreateCycle(
  users: OrgNode[],
  userId: string,
  supervisorId: string | null
): boolean {
  if (!supervisorId) return false;
  if (userId === supervisorId) return true;
  // 新主管如果本來就在我的下轄範圍裡,接上去就會繞回來。
  return subordinateIds(users, userId).has(supervisorId);
}

/** 這個人頭上有幾層主管。沒有主管 = 1,他的部屬 = 2,再下一層 = 3。 */
export function orgDepth(users: OrgNode[], userId: string): number {
  const supervisorOf = new Map(users.map((u) => [u.id, u.supervisorId ?? null]));
  const seen = new Set<string>([userId]);
  let depth = 1;
  let current = supervisorOf.get(userId) ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = supervisorOf.get(current) ?? null;
  }
  return depth;
}
