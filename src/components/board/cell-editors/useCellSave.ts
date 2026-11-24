"use client";

import { useRouter } from "next/navigation";
import { useDialogs } from "@/components/ui/DialogProvider";
import { upsertCellValue } from "@/lib/actions/cell";
import { sameJson, type UndoResult } from "@/lib/editHistory";
import type { CellValueJson } from "@/types/column";
import { useEditHistory, type EditHistoryApi } from "../EditHistoryProvider";
import { knownErrorMessage } from "@/lib/userError";
import { doneStatusTarget } from "@/lib/progressDoneStatus";
import { getStatusOptions } from "@/types/column";

/**
 * Runs a cell-update server action and surfaces its error instead of leaving
 * it as an unhandled rejection — the schedule locks and the summary-window
 * rule both reject writes, and without this the edit just appeared to do
 * nothing. Refreshes afterwards so the field snaps back to the stored value
 * rather than keeping the rejected one on screen.
 *
 * `onSuccess` runs only when the action came back without an error.
 */
export function useCellSave() {
  const router = useRouter();
  const { notify } = useDialogs();
  return (run: () => Promise<unknown>, onSuccess?: () => void) => {
    run()
      .then((result) => {
        // Validation comes back as a value, not an exception — Next.js
        // redacts thrown Server Action messages in production builds.
        const error =
          result && typeof result === "object" && "error" in result
            ? (result as { error?: unknown }).error
            : null;
        if (typeof error === "string") {
          notify(error, { title: "無法儲存" });
          router.refresh();
        } else {
          // Saved, but the new dates put a 必須完成於 out of reach of its predecessors.
          const warning =
            result && typeof result === "object" && "warning" in result
              ? (result as { warning?: unknown }).warning
              : null;
          if (typeof warning === "string") notify(warning, { title: "日期約束衝突" });
          onSuccess?.();
        }
      })
      .catch((err) => {
        notify(knownErrorMessage(err, "儲存失敗,請重新整理後再試一次。"), { title: "無法儲存" });
        router.refresh();
      });
  };
}

export type RecordedCellEdit = {
  boardId: string;
  itemId: string;
  columnId: string;
  /** 改之前、改完之後的儲存值(跟 upsertCellValue 收的格式一樣)。 */
  before: CellValueJson;
  after: CellValueJson;
};

function storedCellValue(history: EditHistoryApi, itemId: string, columnId: string): { found: boolean; value: unknown } {
  const item = history.getBoard().items.find((i) => i.id === itemId);
  if (!item) return { found: false, value: null };
  return { found: true, value: item.cellValues.find((c) => c.columnId === columnId)?.value ?? null };
}

/** 還原/重做共用:目前存的值還是當初改完(或改之前)的那個值才寫,不然擋下來,不蓋掉別人的修改。 */
async function writeIfUnchanged(
  history: EditHistoryApi,
  edit: RecordedCellEdit,
  expected: CellValueJson,
  write: CellValueJson
): Promise<UndoResult> {
  const current = storedCellValue(history, edit.itemId, edit.columnId);
  if (!current.found) return { ok: false, reason: "這個項目已經不存在,沒有執行。" };
  if (!sameJson(current.value, expected)) {
    return { ok: false, reason: "這個欄位已經被改過(可能是其他人或其他分頁),為了不蓋掉新的修改,沒有執行。" };
  }
  try {
    const result = await upsertCellValue(edit.boardId, edit.itemId, edit.columnId, write);
    if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
      return { ok: false, reason: result.error };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: knownErrorMessage(err, "儲存失敗,請重新整理後再試一次。") };
  }
}

/**
 * 一格儲存格的修改:存成功才登記到看板的「上一步 / 下一步」。不在看板裡就跟 useCellSave 一樣。
 *
 * 進度(% Done)填到 100% 而狀態還不是完成時,伺服器會把狀態一起切成完成(見 upsertCellValue),
 * 所以存之前先請使用者同意;不同意就整個不存。回傳 Promise<boolean>:有沒有送出(不同意是 false,
 * 輸入框要把使用者打的數字還原)。
 */
export function useRecordedCellSave() {
  const save = useCellSave();
  const history = useEditHistory();
  const { confirm } = useDialogs();
  return (edit: RecordedCellEdit): Promise<boolean> => {
    const board = history?.getBoard();
    if (board && edit.columnId === board.progressColumnId && typeof edit.after === "number" && edit.after >= 1) {
      const target = doneStatusTarget(board.columns, board.reportStatusColumnId, board.reportDoneOptionIds);
      const item = board.items.find((i) => i.id === edit.itemId);
      const current = item?.cellValues.find((c) => c.columnId === target?.columnId)?.value;
      if (target && item && !(typeof current === "string" && target.doneOptionIds.includes(current))) {
        const statusColumn = board.columns.find((c) => c.id === target.columnId);
        const label = getStatusOptions(statusColumn?.options).find((o) => o.id === target.optionId)?.label ?? "完成";
        return confirm(
          `進度設為 100%,「${item.name}」的狀態會一併切成「${label}」。
是否同意?`,
          { title: "狀態切成完成", confirmLabel: "同意" }
        ).then((ok) => {
          if (ok) runSave(edit);
          return ok;
        });
      }
    }
    runSave(edit);
    return Promise.resolve(true);
  };

  function runSave(edit: RecordedCellEdit) {
    save(
      () => upsertCellValue(edit.boardId, edit.itemId, edit.columnId, edit.after),
      () => {
        if (!history || sameJson(edit.before, edit.after)) return;
        const board = history.getBoard();
        const itemName = board.items.find((i) => i.id === edit.itemId)?.name ?? "";
        const columnName = board.columns.find((c) => c.id === edit.columnId)?.name ?? "欄位";
        history.record({
          label: `修改「${itemName}」的「${columnName}」`,
          undo: () => writeIfUnchanged(history, edit, edit.after, edit.before),
          redo: () => writeIfUnchanged(history, edit, edit.before, edit.after),
        });
      }
    );
  }
}
