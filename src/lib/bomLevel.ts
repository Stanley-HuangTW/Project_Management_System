/**
 * 改 BOM 一列的階層(BOM LEVEL)。純函式,不碰資料庫與畫面。
 *
 * 跟 ERP / PLM 的 BOM 一樣把表看成「一張照順序排好的平的清單 + 每列一個階層數字」:
 * 一列的上層 = 它前面最近的、階層剛好少 1 的那一列。改一列的階層就是改那個數字,再照清單重新找每一列的上層:
 *   - 這一列底下的子項目整串跟著位移(升一階、降一階,內部的上下關係不變);
 *   - 往外升階(階層變小)時,清單裡排在它後面、原本跟它同層的列,因為前面最近的少一階的列變成了它,就變成它的子項目
 *     ——跟看板表格升階會接管後面同層項目是同一個規則;
 *   - 一列最多只能比前一列深一層(第一列只能是 1),不然就會冒出沒有上層的子項目。
 * 階層從 1 起算:1 = 最上層。
 */

export type FlatBomLine = {
  id: string;
  parentId: string | null;
  /** 0 = 最上層(畫面上的 BOM LEVEL 是它加 1)。 */
  depth: number;
  /** 在同一個上層底下的順序。 */
  order: number;
};

/** 要改的列:新的上層與同層順序。 */
export type BomMove = { id: string; parentId: string | null; order: number };

/**
 * 把 id 那一列的階層改成 level(1 起算)。回傳要寫回資料庫的列(只有上層或順序真的變了的);
 * lines 要是畫面上看到的順序(先序走訪)。階層沒變回空陣列。
 */
export function setBomLevel(lines: FlatBomLine[], id: string, level: number): { error: string } | { moves: BomMove[] } {
  const index = lines.findIndex((l) => l.id === id);
  if (index < 0) return { error: "找不到這一列" };
  if (!Number.isInteger(level) || level < 1) return { error: "BOM LEVEL 要填 1 以上的整數(1 = 最上層)" };

  const newDepth = level - 1;
  const maxDepth = index === 0 ? 0 : lines[index - 1].depth + 1;
  if (newDepth > maxDepth) {
    return {
      error:
        index === 0
          ? "第一列只能是 BOM LEVEL 1"
          : `BOM LEVEL 最多只能比上一列深一層,這一列最多是 ${maxDepth + 1}(要放更深,先把它前面的列升成它的上層)`,
    };
  }
  const delta = newDepth - lines[index].depth;
  if (delta === 0) return { moves: [] };

  // 這一列與它的子孫(清單裡緊接著、階層比它深的那一段)整串位移。
  const depths = lines.map((l) => l.depth);
  let end = index + 1;
  while (end < lines.length && lines[end].depth > lines[index].depth) end++;
  for (let i = index; i < end; i++) depths[i] += delta;
  // 往外升階之後,後面的列可能比前一列深超過一層:夾回前一列的下一層(它們會變成前一列的子項目)。
  depths[0] = 0;
  for (let i = 1; i < depths.length; i++) depths[i] = Math.min(depths[i], depths[i - 1] + 1);

  // 照新的階層重新找每一列的上層,同層的順序就是它在清單裡的先後(從 1 起算)。
  const stack: number[] = [];
  const nextOrder = new Map<string | null, number>();
  const moves: BomMove[] = [];
  lines.forEach((line, i) => {
    const d = depths[i];
    const parentId = d > 0 ? lines[stack[d - 1]].id : null;
    stack[d] = i;
    stack.length = d + 1;
    const order = (nextOrder.get(parentId) ?? 0) + 1;
    nextOrder.set(parentId, order);
    if (parentId !== line.parentId || order !== line.order) moves.push({ id: line.id, parentId, order });
  });
  return { moves };
}

/** 這一列最深可以放到第幾層(畫面上 → 按鈕要不要停用)。 */
export function maxBomLevel(lines: FlatBomLine[], id: string): number {
  const index = lines.findIndex((l) => l.id === id);
  if (index <= 0) return 1;
  return lines[index - 1].depth + 2;
}
