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
