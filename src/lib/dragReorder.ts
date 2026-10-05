import { collectSubtreeIds } from "./trash";
import { computeWbsCodes } from "./wbs";

/**
 * 拖曳工作項重新排列/改階層——放開的位置決定結果:
 * - "child":   變成目標項目的子項(附加在它現有子項的最後面)。
 * - "after":   變成目標項目下面的同層項目。
 * - "outdent": 外移一層,變成目標項目的父項的同層項目(緊接在目標項目的舊父項後面)。
 */
export type DropZone = "child" | "after" | "outdent" | "before";

export interface DropZoneInput {
  /** 目標列自己的 top(clientY 座標系)。 */
  rowTop: number;
  rowHeight: number;
  /** 當下滑鼠的 Y 座標,跟 rowTop 同一個座標系。 */
  pointerY: number;
  /** 目標列自己的縮排(px)。 */
  targetIndentPx: number;
  /** 當下滑鼠的 X 座標,跟 targetIndentPx 同一個座標系。 */
  pointerX: number;
  /** 每一階縮排的 px 數——甘特圖跟表格視圖的縮排單位不一樣,各自傳各自的值。 */
  indentUnitPx: number;
  /** 下緣判定範圍佔列高的比例,預設 0.3。 */
  bottomEdgeRatio?: number;
  /** 目標已經是最上層——外移沒有意義,退化成「同層」。 */
  targetIsTopLevel: boolean;
}

/** 純幾何判斷,不碰 DOM——呼叫端自己從 getBoundingClientRect()/滑鼠事件算出這些數字。 */
export function classifyDropZone(input: DropZoneInput): DropZone {
  const { rowTop, rowHeight, pointerY, targetIndentPx, pointerX, indentUnitPx, bottomEdgeRatio = 0.3, targetIsTopLevel } =
    input;
  const offsetY = pointerY - rowTop;
  const inBottomEdge = offsetY >= rowHeight * (1 - bottomEdgeRatio);
  if (!inBottomEdge) return "child";
  const draggedLeftOfTarget = pointerX < targetIndentPx - indentUnitPx / 2;
  if (draggedLeftOfTarget && !targetIsTopLevel) return "outdent";
  return "after";
}

export type MoveItemLike = { id: string; parentId: string | null; order: number };

export type MoveRejectionReason =
  | "not-found"
  | "self"
  | "descendant"
  | "no-parent-to-outdent-to"
  | "invalid-zone";

/** 一筆要寫回資料庫的結果——parentId 一律帶上(即使沒變),讓呼叫端可以直接對每一筆
 *  跑一次 prisma.item.update()。 */
export type MoveWrite = { id: string; parentId: string | null; order: number };

export type ResolveItemMoveResult = { ok: true; writes: MoveWrite[] } | { ok: false; reason: MoveRejectionReason };

/**
 * 純計算:給同一個 Group 的完整 `{id,parentId,order}` 清單,算出拖放之後每個受影響項目
 * 的新 parentId/order。
 *
 * 核心做法是「以 index 重編號」而不是「對 order >= X 的項目整批 +1」(insertItem 用的
 * 位移式寫法)——同一個父層內重新排序時,目標項目自己的 order 會因為「先把被拖項目從
 * 舊位置移除」而跟著變動,位移式寫法在這個情境下算出來的順序會不連續。做法是:把「新
 * 父層底下、排除被拖項目本身」的兄弟清單依 order 排序,算出插入點,整份重新編號成連續
 * 的 0..n-1。新舊父層不同時,這個做法跟分別對兩個清單各自重編號是等價的。
 */
export function resolveItemMove(
  items: MoveItemLike[],
  draggedId: string,
  targetId: string,
  zone: DropZone
): ResolveItemMoveResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const dragged = byId.get(draggedId);
  const target = byId.get(targetId);
  if (!dragged || !target) return { ok: false, reason: "not-found" };
  if (draggedId === targetId) return { ok: false, reason: "self" };

  const descendantIds = new Set(collectSubtreeIds(items, draggedId));
  if (descendantIds.has(targetId)) return { ok: false, reason: "descendant" };

  let newParentId: string | null;
  let insertAfterId: string | null;

  if (zone === "child") {
    newParentId = targetId;
    const children = items
      .filter((i) => i.parentId === targetId && i.id !== draggedId)
      .sort((a, b) => a.order - b.order);
    insertAfterId = children.length > 0 ? children[children.length - 1].id : null;
  } else if (zone === "after") {
    newParentId = target.parentId;
    insertAfterId = targetId;
  } else if (zone === "before") {
    // 畫面上的拖曳不會產生這個區域,只給「還原搬移」用:放在目標前面,也就是排在
    // 目標前一個兄弟(扣掉被拖項目本身)的後面;目標是第一個就排在最前面。
    newParentId = target.parentId;
    const targetSiblings = items
      .filter((i) => i.parentId === target.parentId && i.id !== draggedId)
      .sort((a, b) => a.order - b.order);
    const targetIndex = targetSiblings.findIndex((i) => i.id === targetId);
    insertAfterId = targetIndex > 0 ? targetSiblings[targetIndex - 1].id : null;
  } else if (zone === "outdent") {
    if (target.parentId === null) return { ok: false, reason: "no-parent-to-outdent-to" };
    const grandparent = byId.get(target.parentId);
    newParentId = grandparent ? grandparent.parentId : null;
    insertAfterId = target.parentId;
  } else {
    // 執行期收到沒見過的字串(server action 的參數不能全信 TypeScript)——寧可拒絕,
    // 不要當成某一個區域亂搬。
    return { ok: false, reason: "invalid-zone" };
  }

  const siblings = items
    .filter((i) => i.parentId === newParentId && i.id !== draggedId)
    .sort((a, b) => a.order - b.order);
  const insertIndex = insertAfterId === null ? 0 : siblings.findIndex((i) => i.id === insertAfterId) + 1;

  const withDragged = [...siblings.slice(0, insertIndex), dragged, ...siblings.slice(insertIndex)];
  const writes: MoveWrite[] = withDragged
    .map((item, index) => ({ id: item.id, parentId: newParentId, order: index }))
    .filter((w) => {
      const current = byId.get(w.id)!;
      return current.parentId !== w.parentId || current.order !== w.order;
    });

  // 父層真的換了的話,舊父層底下剩下的兄弟也要收斂成連續的 0..n-1,不然會留一個洞。
  if (newParentId !== dragged.parentId) {
    const oldSiblings = items
      .filter((i) => i.parentId === dragged.parentId && i.id !== draggedId)
      .sort((a, b) => a.order - b.order);
    oldSiblings.forEach((item, index) => {
      if (item.order !== index) {
        writes.push({ id: item.id, parentId: item.parentId, order: index });
      }
    });
  }

  return { ok: true, writes };
}

/**
 * 還原一次搬移要用的那個「反向搬移」:依被拖項目**搬移前**的位置,算出拿 resolveItemMove
 * 搬回去的 `{ targetId, zone }`。有下一個兄弟就放在它前面,否則有上一個兄弟就放在它後面,
 * 否則(獨生子)回到原本的父項底下。最上層唯一的項目沒地方可搬,也就不會需要還原,回傳 null。
 */
export function buildMoveInverse<T extends MoveItemLike>(
  items: T[],
  draggedId: string
): { targetId: string; zone: DropZone } | null {
  const dragged = items.find((i) => i.id === draggedId);
  if (!dragged) return null;
  const siblings = items.filter((i) => i.parentId === dragged.parentId).sort((a, b) => a.order - b.order);
  const index = siblings.findIndex((i) => i.id === draggedId);
  const next = siblings[index + 1];
  if (next) return { targetId: next.id, zone: "before" };
  const previous = siblings[index - 1];
  if (previous) return { targetId: previous.id, zone: "after" };
  if (dragged.parentId) return { targetId: dragged.parentId, zone: "child" };
  return null;
}

export type DropPreview = {
  /** 放開之後被拖項目的 WBS 編號——拖曳途中直接顯示在它那一列上。 */
  newCode: string | null;
  /** 一句話說明放在誰底下、跟誰同階,顯示在目標列的放置提示上。 */
  label: string;
};

/** 拖曳途中每個視圖都要記的狀態:懸停在哪一列、哪個放置區、拖的是誰、放開後會怎樣。 */
export type DragOverState = {
  id: string;
  zone: DropZone;
  draggedId: string;
  preview: DropPreview | null;
};

/**
 * 拖曳途中的即時預覽:假設現在放開,被拖項目的 WBS 編號會變成什麼、放在哪裡。
 *
 * 直接用 resolveItemMove 算出來的寫入結果套回整份清單、再重算一次 WBS——跟放開
 * 之後資料庫真正的結果走同一條路,預覽不會跟實際結果對不起來。說明文字裡引用的
 * 編號用「放開之後」的新編號:往下拖時,被拖項目原本在前面,放開後它前面的項目編號
 * 會往前補,用舊編號寫的「放在 1.2 底下」就會跟放開後看到的 1.1 對不上。
 *
 * 不能放(拖到自己、拖到自己的子孫、最上層無法外移)回傳 null。
 */
export function previewDrop<T extends MoveItemLike & { name: string }>(
  items: T[],
  draggedId: string,
  targetId: string,
  zone: DropZone
): DropPreview | null {
  const result = resolveItemMove(items, draggedId, targetId, zone);
  if (!result.ok) return null;

  const byId = new Map(items.map((i) => [i.id, i]));
  const writes = new Map(result.writes.map((w) => [w.id, w]));
  const moved = items.map((i) => {
    const w = writes.get(i.id);
    return w ? { ...i, parentId: w.parentId, order: w.order } : i;
  });
  const newCodes = computeWbsCodes(moved);
  const newCode = newCodes.get(draggedId) ?? null;

  if (!writes.has(draggedId)) {
    return { newCode, label: `位置不變${newCode ? `(${newCode})` : ""}` };
  }

  const ref = (id: string | null): string => {
    const item = id ? byId.get(id) : undefined;
    if (!id || !item) return "最上層";
    const code = newCodes.get(id);
    return `${code ? `${code} ` : ""}${item.name}`;
  };
  const target = byId.get(targetId)!;
  const head = newCode ? `${newCode} · ` : "";

  if (zone === "child") return { newCode, label: `${head}成為「${ref(targetId)}」的子項` };
  if (zone === "after") return { newCode, label: `${head}與「${ref(targetId)}」同階` };
  if (zone === "before") return { newCode, label: `${head}放在「${ref(targetId)}」前面` };
  return { newCode, label: `${head}外移一層,與「${ref(target.parentId)}」同階` };
}

/** `newParentLvl` 是 null 代表變成最上層,或新父層沒有數字 Lvl 值(呼叫端應該在這種
 *  情況下完全跳過 Lvl 連動,不要捏造數值)。 */
export function computeLvlDelta(oldLvl: number, newParentLvl: number | null): number {
  const newLvl = newParentLvl === null ? 1 : newParentLvl + 1;
  return newLvl - oldLvl;
}
