/**
 * 待辦事項拖曳排序後的最終順序。requested 是畫面上拖完的順序(id 清單);
 * 只認得 currentIds 裡有的、重複的只算第一次;畫面還沒看到的(別人剛新增的)接在後面,維持它們原本的先後。
 */
export function mergeTodoOrder(currentIds: string[], requested: string[]): string[] {
  const known = new Set(currentIds);
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const id of requested) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id);
      picked.push(id);
    }
  }
  return [...picked, ...currentIds.filter((id) => !seen.has(id))];
}
