/**
 * BOM 勾選之後的批次操作(升階 / 降階、移動、複製)要用的純邏輯。不碰資料庫與畫面。
 *
 * 規則跟看板表格的批次操作一致:勾選一列,它底下的子項目一起被處理;父項與子項都被勾,只算父項
 * (不會處理兩次)。清單(lines)一律是畫面上的順序(先序走訪),階層(depth)0 起算。
 */
import { deriveBomMoves, type BomMove, type FlatBomLine } from "@/lib/bomLevel";

export type BulkSelection = {
  /** 勾選的列收斂成「根」:祖先也被勾的不另外算。照畫面順序。 */
  rootIds: string[];
  /** 根與它們底下所有子孫(連同子項目一共哪些列)。 */
  subtreeIds: Set<string>;
};

export function selectionRoots(lines: FlatBomLine[], selected: Set<string>): BulkSelection {
  const rootIds: string[] = [];
  const subtreeIds = new Set<string>();
  let rootDepth: number | null = null; // 目前走在哪個根的底下(那個根原本的階層)
  for (const line of lines) {
    if (rootDepth !== null && line.depth > rootDepth) {
      subtreeIds.add(line.id);
      continue;
    }
    rootDepth = null;
    if (selected.has(line.id)) {
      rootIds.push(line.id);
      subtreeIds.add(line.id);
      rootDepth = line.depth;
    }
  }
  return { rootIds, subtreeIds };
}

/**
 * 勾選的列(各帶底下的子項目)一起升一階(delta = -1)或降一階(delta = +1)。規則同 setBomLevel:
 * 往外升階時,後面原本同層的列變成被升階那一列的子項目;降階最多只能比(新的)前一列深一層。
 * 全有或全無:只要有一列做不到(已經是 1 還要升階、前面沒有可以掛的上層),整批都不動並說明是哪一列。
 */
export function shiftBomLevels(
  lines: FlatBomLine[],
  names: Map<string, string>,
  selected: Set<string>,
  delta: 1 | -1
): { error: string } | { moves: BomMove[] } {
  const { rootIds } = selectionRoots(lines, selected);
  if (rootIds.length === 0) return { error: "沒有選到任何列" };
  const roots = new Set(rootIds);
  const label = (id: string) => `「${names.get(id) ?? id}」`;

  const depths = lines.map((l) => l.depth);
  let rootDepth: number | null = null;
  lines.forEach((line, i) => {
    if (rootDepth !== null && line.depth > rootDepth) {
      depths[i] += delta;
      return;
    }
    rootDepth = null;
    if (roots.has(line.id)) {
      depths[i] += delta;
      rootDepth = line.depth;
    }
  });

  for (let i = 0; i < lines.length; i++) {
    if (!roots.has(lines[i].id)) continue;
    if (depths[i] < 0) return { error: `${label(lines[i].id)}已經是 BOM LEVEL 1,不能再升階。` };
    const max = i === 0 ? 0 : depths[i - 1] + 1;
    if (depths[i] > max) {
      return {
        error: `${label(lines[i].id)}降階之後會比前一列深超過一層,前面沒有可以掛的上層(第一列、或前面沒有同層的列,不能降階)。`,
      };
    }
  }
  // 往外升階之後,後面沒被勾的列可能比前一列深超過一層:夾回前一列的下一層(它們變成前一列的子項目)。
  depths[0] = 0;
  for (let i = 1; i < depths.length; i++) depths[i] = Math.min(depths[i], depths[i - 1] + 1);
  return { moves: deriveBomMoves(lines, depths) };
}

export type MovePosition = "last" | "first" | { after: string };
export type MoveTarget = { parentId: string | null; position: MovePosition };

/**
 * 把 movedIds(各帶底下的子項目,不用列出來)放到 target.parentId 底下的指定位置。
 * lines = 目標那份 BOM 目前的列(先序)。movedIds 可以不在 lines 裡:從別份 BOM 搬進來的、或複製出來的新列(用暫時的 id)。
 * 同一份 BOM 內搬動時,它們原本的位置會被拿掉;所有列的同層順序一併整理成 1、2、3…。
 * 回傳上層或順序變了的列(movedIds 一定在裡面)。
 */
export function planBomMove(lines: FlatBomLine[], movedIds: string[], target: MoveTarget): { error: string } | { moves: BomMove[] } {
  const moved = new Set(movedIds);
  const byId = new Map(lines.map((l) => [l.id, l]));

  if (target.parentId !== null) {
    if (!byId.has(target.parentId)) return { error: "找不到目標的上層" };
    // 目標不能是被搬的列自己、或它底下的列,不然這棵樹會繞成一圈。
    for (let cursor: string | null = target.parentId, guard = 0; cursor && guard < lines.length + 1; guard++) {
      if (moved.has(cursor)) return { error: "目標不能是被搬動的列自己,或它底下的列" };
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }

  // 每個上層底下的同層順序(先序走訪,同層的先後就是出現的先後)。
  const children = new Map<string | null, string[]>();
  for (const line of lines) {
    if (moved.has(line.id)) continue;
    children.set(line.parentId, [...(children.get(line.parentId) ?? []), line.id]);
  }

  const siblings = children.get(target.parentId) ?? [];
  if (target.position === "first") siblings.unshift(...movedIds);
  else if (target.position === "last") siblings.push(...movedIds);
  else {
    const at = siblings.indexOf(target.position.after);
    if (at < 0) return { error: "找不到要接在後面的那一列(或它是被搬動的列)" };
    siblings.splice(at + 1, 0, ...movedIds);
  }
  children.set(target.parentId, siblings);

  const moves: BomMove[] = [];
  for (const [parentId, ids] of children) {
    ids.forEach((id, i) => {
      const order = i + 1;
      const old = byId.get(id);
      if (moved.has(id) || !old || old.parentId !== parentId || old.order !== order) moves.push({ id, parentId, order });
    });
  }
  return { moves };
}
