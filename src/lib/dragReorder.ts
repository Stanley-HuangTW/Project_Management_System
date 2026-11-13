import { collectSubtreeIds } from "./trash";
import { computeWbsCodes } from "./wbs";

/**
 * 拖曳工作項重新排列/改階層——放開的位置決定結果:
 * - "child":   變成目標項目的子項(附加在它現有子項的最後面)。
 * - "after":   變成目標項目下面的同層項目。
 * - "outdent": 外移一層,變成目標項目的父項的同層項目(緊接在目標項目的舊父項後面)。
 * - "afterAdopt":升階按鈕用(目標一定是被搬項目自己的父項)。位置跟 "after" 一樣,緊接在父項後面;
 *                另外,原本排在被搬項目後面的兄弟,變成它的子項(接在它原本的子項後面)——整份清單的順序不變,
 *                只有階層變了(1.1.16 升階成 1.2,原本的 1.1.17 變成 1.2.1)。
 * - "childRelease":還原「afterAdopt」用。被搬項目變成目標(它的前一個同層項目,也就是升階前的父項)的最後一個子項,
 *                它最後 releaseCount 個子項(當初接管來的那幾個)放回目標底下、排在它後面。
 * - "before":      畫面上不會產生,只給「還原搬移」用:放在目標前面。
 */
export type DropZone = "child" | "after" | "outdent" | "before" | "afterAdopt" | "childRelease";

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
  zone: DropZone,
  /** 只有 "childRelease" 用:放回去幾個子項。 */
  options: { releaseCount?: number } = {}
): ResolveItemMoveResult {
  const byId = new Map(items.map((i) => [i.id, i]));
  const dragged = byId.get(draggedId);
  const target = byId.get(targetId);
  if (!dragged || !target) return { ok: false, reason: "not-found" };
  if (draggedId === targetId) return { ok: false, reason: "self" };

  const descendantIds = new Set(collectSubtreeIds(items, draggedId));
  if (descendantIds.has(targetId)) return { ok: false, reason: "descendant" };

  const byOrder = (a: MoveItemLike, b: MoveItemLike) => a.order - b.order;
  let newParentId: string | null;
  let insertAfterId: string | null;
  /** "afterAdopt":原本排在被搬項目後面的兄弟,搬完變成它的子項。 */
  let adopted: MoveItemLike[] = [];
  /** "childRelease":被搬項目最後幾個子項,搬完放回新父層、排在它後面。 */
  let released: MoveItemLike[] = [];

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
    // 畫面上的拖曳不會產生這個區域,給「還原搬移」與「上移」用:放在目標前面,也就是排在
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
  } else if (zone === "afterAdopt") {
    // 升階:目標一定是它自己的父項,不是的話不是這個按鈕該產生的呼叫。
    if (dragged.parentId !== targetId) return { ok: false, reason: "invalid-zone" };
    newParentId = target.parentId;
    insertAfterId = targetId;
    const oldSiblings = items.filter((i) => i.parentId === dragged.parentId).sort(byOrder);
    adopted = oldSiblings.slice(oldSiblings.findIndex((i) => i.id === draggedId) + 1);
  } else if (zone === "childRelease") {
    // 還原升階:目標是它同一層的(前一個)項目。
    if (dragged.parentId !== target.parentId) return { ok: false, reason: "invalid-zone" };
    const children = items.filter((i) => i.parentId === draggedId).sort(byOrder);
    const count = options.releaseCount ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > children.length) return { ok: false, reason: "invalid-zone" };
    newParentId = targetId;
    const targetChildren = items.filter((i) => i.parentId === targetId).sort(byOrder);
    insertAfterId = targetChildren.length > 0 ? targetChildren[targetChildren.length - 1].id : null;
    released = children.slice(children.length - count);
  } else {
    // 執行期收到沒見過的字串(server action 的參數不能全信 TypeScript)——寧可拒絕,
    // 不要當成某一個區域亂搬。
    return { ok: false, reason: "invalid-zone" };
  }

  const siblings = items
    .filter((i) => i.parentId === newParentId && i.id !== draggedId)
    .sort((a, b) => a.order - b.order);
  const insertIndex = insertAfterId === null ? 0 : siblings.findIndex((i) => i.id === insertAfterId) + 1;

  const withDragged = [...siblings.slice(0, insertIndex), dragged, ...released, ...siblings.slice(insertIndex)];
  const writes: MoveWrite[] = withDragged
    .map((item, index) => ({ id: item.id, parentId: newParentId, order: index }))
    .filter((w) => {
      const current = byId.get(w.id)!;
      return current.parentId !== w.parentId || current.order !== w.order;
    });

  // 升階接管的兄弟:變成被搬項目的子項,接在它原本的子項後面。
  if (adopted.length > 0) {
    const ownChildren = items.filter((i) => i.parentId === draggedId).length;
    adopted.forEach((item, index) => writes.push({ id: item.id, parentId: draggedId, order: ownChildren + index }));
  }

  // 還原升階:放回去的那幾個離開了,被搬項目留下的子項重新編號成連續的。
  if (released.length > 0) {
    const releasedIds = new Set(released.map((r) => r.id));
    items
      .filter((i) => i.parentId === draggedId && !releasedIds.has(i.id))
      .sort(byOrder)
      .forEach((item, index) => {
        if (item.order !== index) writes.push({ id: item.id, parentId: item.parentId, order: index });
      });
  }

  // 父層真的換了的話,舊父層底下剩下的兄弟也要收斂成連續的 0..n-1,不然會留一個洞
  // (被接管走的兄弟已經不在舊父層了)。
  if (newParentId !== dragged.parentId) {
    const adoptedIds = new Set(adopted.map((a) => a.id));
    const oldSiblings = items
      .filter((i) => i.parentId === dragged.parentId && i.id !== draggedId && !adoptedIds.has(i.id))
      .sort(byOrder);
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

/**
 * 降階(縮排):變成前一個同層項目的最後一個子項,整棵子樹跟著走。第一個同層項目前面沒有誰可以當父項,
 * 不能降階,回傳 null。用的是跟拖曳同一個搬移(resolveItemMove 的 "child"),Lvl 與 Summary 連動都一樣。
 */
export function indentTarget(items: MoveItemLike[], itemId: string): { targetId: string; zone: DropZone } | null {
  const item = items.find((i) => i.id === itemId);
  if (!item) return null;
  const siblings = items.filter((i) => i.parentId === item.parentId).sort((a, b) => a.order - b.order);
  const index = siblings.findIndex((i) => i.id === itemId);
  return index > 0 ? { targetId: siblings[index - 1].id, zone: "child" } : null;
}

/**
 * 升階(凸排):提升一階,變成父項的同層項目、緊接在父項後面;原本排在它後面的兄弟變成它的子項,
 * 所以它在清單上的位置不動、只有階層變(1.1.16 升階成 1.2,原本的 1.1.17 變成 1.2.1),
 * 跟 MS Project 的升階一樣。最上層沒有父項,不能升階,回傳 null。
 *
 * 拖曳往左拖的 "outdent" 不接管兄弟——那是使用者指定放在哪,不是按一下升階。
 */
export function outdentTarget(items: MoveItemLike[], itemId: string): { targetId: string; zone: DropZone } | null {
  const item = items.find((i) => i.id === itemId);
  return item?.parentId ? { targetId: item.parentId, zone: "afterAdopt" } : null;
}

/**
 * 上移 / 下移:跟同一層的前一個(後一個)項目對調位置,整棵子樹跟著走、階層不變。
 * 已經是同層第一個(最後一個)就不能再移,回傳 null。用的是跟拖曳同一個搬移("before" / "after")。
 */
export function moveUpTarget(items: MoveItemLike[], itemId: string): { targetId: string; zone: DropZone } | null {
  const { siblings, index } = siblingsOf(items, itemId);
  return index > 0 ? { targetId: siblings[index - 1].id, zone: "before" } : null;
}

export function moveDownTarget(items: MoveItemLike[], itemId: string): { targetId: string; zone: DropZone } | null {
  const { siblings, index } = siblingsOf(items, itemId);
  return index >= 0 && index < siblings.length - 1 ? { targetId: siblings[index + 1].id, zone: "after" } : null;
}

function siblingsOf(items: MoveItemLike[], itemId: string) {
  const item = items.find((i) => i.id === itemId);
  if (!item) return { siblings: [] as MoveItemLike[], index: -1 };
  const siblings = items.filter((i) => i.parentId === item.parentId).sort((a, b) => a.order - b.order);
  return { siblings, index: siblings.findIndex((i) => i.id === itemId) };
}

/**
 * 升階會接管幾個兄弟:原本排在它後面的同層項目。還原升階(zone "childRelease")要知道這個數字,
 * 才知道最後幾個子項是接管來的、要放回去。
 */
export function countAdoptedBy(items: MoveItemLike[], itemId: string): number {
  const item = items.find((i) => i.id === itemId);
  if (!item) return 0;
  const siblings = items.filter((i) => i.parentId === item.parentId).sort((a, b) => a.order - b.order);
  return siblings.length - 1 - siblings.findIndex((i) => i.id === itemId);
}

/**
 * 搬移之後被搬項目的父項 id(搬到最上層是 null);這次搬移沒有動到它就是原本的。
 * 不能寫成 `find(...)?.parentId ?? 原本`——搬到最上層時 parentId 本來就是 null,會被當成「沒有寫入」而退回舊父項,
 * 連帶讓 Lvl 與 Summary 類型的連動整段被跳過。
 */
export function parentAfterMove(writes: MoveWrite[], draggedId: string, oldParentId: string | null): string | null {
  const write = writes.find((w) => w.id === draggedId);
  return write ? write.parentId : oldParentId;
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
  if (zone === "afterAdopt") return { newCode, label: `${head}升一階,與「${ref(targetId)}」同階,下面的同層項目變成它的子項` };
  if (zone === "childRelease") return { newCode, label: `${head}降回「${ref(targetId)}」底下` };
  return { newCode, label: `${head}外移一層,與「${ref(target.parentId)}」同階` };
}

/** `newParentLvl` 是 null 代表變成最上層,或新父層沒有數字 Lvl 值(呼叫端應該在這種
 *  情況下完全跳過 Lvl 連動,不要捏造數值)。 */
export function computeLvlDelta(oldLvl: number, newParentLvl: number | null): number {
  const newLvl = newParentLvl === null ? 1 : newParentLvl + 1;
  return newLvl - oldLvl;
}
