"use client";

import type { KeyboardEvent } from "react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError } from "@/lib/staleBuild";
import { indentTarget, outdentTarget, type MoveItemLike } from "@/lib/dragReorder";
import { useRecordedItemMove } from "./useRecordedItemMove";
import { actionErrorMessage } from "@/lib/userError";

export type LevelDirection = "indent" | "outdent";

/** Tab 降階、Shift+Tab 升階;帶著 Ctrl/Alt/Meta 的是別的快捷鍵,不攔。 */
export function levelDirectionOfKey(e: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">): LevelDirection | null {
  if (e.key !== "Tab" || e.ctrlKey || e.altKey || e.metaKey) return null;
  return e.shiftKey ? "outdent" : "indent";
}

/** 搬完之後 React 會把這一列搬到新的位置,焦點會掉——等畫面更新後把焦點還給它的名稱按鈕,才能連按 Tab。 */
function refocusNameButton(itemId: string) {
  window.setTimeout(() => {
    const buttons = document.querySelectorAll<HTMLElement>(`[data-item-name-button="${itemId}"]`);
    // 甘特圖打開過就一直留在畫面外(display:none),只還給看得見的那一個。
    [...buttons].find((b) => b.offsetParent !== null)?.focus();
  }, 450);
}

/**
 * 升階 / 降階(表格與甘特圖共用):用跟拖曳同一個搬移(moveRecorded),所以 Lvl、Summary 連動、
 * WBS 編號、上一步 / 下一步都跟著走。可以搬回傳 true;不能搬(沒有前一個同層、已經最上層)或失敗回 false,
 * 失敗會顯示原因。
 */
export function useChangeLevel(boardId: string) {
  const moveRecorded = useRecordedItemMove();
  const { notify } = useDialogs();

  return async function changeLevel(
    direction: LevelDirection,
    item: { id: string; groupId: string },
    groupItems: (MoveItemLike & { name: string })[],
    options: {
      /** 降階時,新的父項如果是收合的要先展開,不然這一列一搬就從畫面上消失。 */
      expandParent?: (parentId: string) => void;
      /** 用鍵盤操作時,搬完把焦點還給這一列。 */
      refocus?: boolean;
    } = {}
  ): Promise<boolean> {
    const move = direction === "indent" ? indentTarget(groupItems, item.id) : outdentTarget(groupItems, item.id);
    if (!move) return false;
    if (direction === "indent") options.expandParent?.(move.targetId);
    try {
      await moveRecorded({
        boardId,
        groupId: item.groupId,
        groupItems,
        draggedId: item.id,
        targetId: move.targetId,
        zone: move.zone,
      });
      if (options.refocus) refocusNameButton(item.id);
      return true;
    } catch (err) {
      await notify(
        actionErrorMessage(err, "搬移失敗"),
        { title: isStaleBuildError(err) ? "需要重新整理" : direction === "indent" ? "無法降階" : "無法升階" }
      );
      return false;
    }
  };
}
