"use client";

import { moveItemWithinGroup } from "@/lib/actions/item";
import { buildMoveInverse, countAdoptedBy, resolveItemMove, type DropZone, type MoveItemLike } from "@/lib/dragReorder";
import { sameJson, type UndoResult } from "@/lib/editHistory";
import { useEditHistory } from "./EditHistoryProvider";

type MovableItem = MoveItemLike & { name: string };

/**
 * 拖曳搬移項目(表格與甘特圖共用):搬移成功才登記到看板的「上一步 / 下一步」。
 *
 * moveItemWithinGroup 沒有反向動作,所以用搬移**之前**的清單算出「搬回原位」的目標
 * (buildMoveInverse)。還原/重做前,比對被搬項目現在的位置關係(它的下一個/上一個
 * 兄弟,或父項)是不是當初搬完/搬之前的樣子——不比對 order 數字,因為搬移會把兄弟
 * 重新編號,數字本來就不會跟原本一樣。
 *
 * 搬移失敗(拒絕、沒權限)會丟出例外,由呼叫端照原本的方式顯示。
 */
export function useRecordedItemMove() {
  const history = useEditHistory();

  return async function moveRecorded(args: {
    boardId: string;
    groupId: string;
    /** 搬移之前、這個分組的全部項目。 */
    groupItems: MovableItem[];
    draggedId: string;
    targetId: string;
    zone: DropZone;
  }): Promise<void> {
    const { boardId, groupId, groupItems, draggedId, targetId, zone } = args;
    const forward = resolveItemMove(groupItems, draggedId, targetId, zone);
    // 搬移之前它的位置關係(下一個/上一個兄弟或父項)——還原與重做前拿來比對,看有沒有人動過。
    const inverse = buildMoveInverse(groupItems, draggedId);
    // 怎麼搬回去。一般的搬移就是搬回 inverse 那個位置;升階會把下面的兄弟接管成子項,
    // 搬回原位會撞到「不能拖進自己的子孫底下」,所以要用 childRelease 連同接管來的一起放回去。
    const undoMove: { targetId: string; zone: DropZone; releaseCount?: number } | null =
      zone === "afterAdopt"
        ? { targetId, zone: "childRelease", releaseCount: countAdoptedBy(groupItems, draggedId) }
        : inverse;

    await moveItemWithinGroup(boardId, groupId, draggedId, targetId, zone);

    if (!history || !forward.ok || !inverse || !undoMove) return;
    const writes = new Map(forward.writes.map((w) => [w.id, w]));
    // 位置沒變(沒有任何寫入牽涉到被拖的項目)就沒有東西可以還原。
    if (!writes.has(draggedId)) return;
    const movedItems = groupItems.map((i) => {
      const w = writes.get(i.id);
      return w ? { ...i, parentId: w.parentId, order: w.order } : i;
    });
    const afterRelation = buildMoveInverse(movedItems, draggedId);
    const name = groupItems.find((i) => i.id === draggedId)?.name ?? "";
    // 升階接管來的那幾個(照順序)。還原前要確認它們還是這個項目最後的子項,不然放回去的會是別人新加的。
    const adoptedIds =
      zone === "afterAdopt"
        ? forward.writes
            .filter((w) => w.parentId === draggedId && groupItems.find((i) => i.id === w.id)?.parentId !== draggedId)
            .sort((a, b) => a.order - b.order)
            .map((w) => w.id)
        : [];

    const apply = async (
      expected: typeof inverse | null,
      target: string,
      targetZone: DropZone,
      releaseCount?: number
    ): Promise<UndoResult> => {
      const current = history.getBoard().items.filter((i) => i.groupId === groupId);
      if (!current.some((i) => i.id === draggedId)) return { ok: false, reason: "這個項目已經不存在,沒有執行。" };
      if (!sameJson(buildMoveInverse(current, draggedId), expected)) {
        return {
          ok: false,
          reason: "這個項目的位置已經被改過(可能是其他人或其他分頁),為了不蓋掉新的修改,沒有執行。",
        };
      }
      if (targetZone === "childRelease") {
        const kids = current
          .filter((i) => i.parentId === draggedId)
          .sort((a, b) => a.order - b.order)
          .map((i) => i.id);
        if (!sameJson(kids.slice(kids.length - adoptedIds.length), adoptedIds)) {
          return {
            ok: false,
            reason: "這個項目底下的子項已經被改過(可能是其他人或其他分頁),為了不蓋掉新的修改,沒有執行。",
          };
        }
      }
      try {
        await moveItemWithinGroup(boardId, groupId, draggedId, target, targetZone, releaseCount);
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : "搬移失敗" };
      }
    };

    history.record({
      label: `搬移「${name}」`,
      undo: () => apply(afterRelation, undoMove.targetId, undoMove.zone, undoMove.releaseCount),
      redo: () => apply(inverse, targetId, zone),
    });
  };
}
