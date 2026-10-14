/**
 * 側邊欄的看板、專案群組順序是每個人自己排的:存一份 id 清單(由上到下)。
 * 清單裡沒有的(新建的、剛拿到權限的)接在最後,維持原本的順序(建立時間);
 * 清單裡有、但已經看不到或刪掉的 id 直接略過。
 */
export function applyStoredOrder<T extends { id: string }>(items: T[], stored: readonly string[]): T[] {
  const position = new Map<string, number>();
  stored.forEach((id, index) => {
    if (!position.has(id)) position.set(id, index);
  });
  const known = items.filter((item) => position.has(item.id)).sort((a, b) => position.get(a.id)! - position.get(b.id)!);
  return [...known, ...items.filter((item) => !position.has(item.id))];
}

const MAX_STORED = 1000;

/** 存進資料庫前清理:只留字串、去重複、不超過上限。 */
export function sanitizeOrder(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id !== "") seen.add(id);
    if (seen.size >= MAX_STORED) break;
  }
  return [...seen];
}
