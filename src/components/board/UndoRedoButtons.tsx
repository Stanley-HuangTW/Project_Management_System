"use client";

import { Redo2, Undo2 } from "lucide-react";
import { useEditHistory } from "./EditHistoryProvider";

/** 上一步 / 下一步。放在甘特圖與表格的工具列;不在看板裡(沒有 provider)就不顯示。 */
export function UndoRedoButtons() {
  const history = useEditHistory();
  if (!history) return null;

  const base =
    "flex items-center rounded-md border border-neutral-300 dark:border-neutral-600 px-2 py-1 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => void history.undo()}
        disabled={!history.canUndo || history.busy}
        title={history.undoLabel ? `上一步:${history.undoLabel}(Ctrl+Z)` : "沒有可以還原的修改"}
        aria-label="上一步"
        className={base}
      >
        <Undo2 size={13} />
      </button>
      <button
        type="button"
        onClick={() => void history.redo()}
        disabled={!history.canRedo || history.busy}
        title={history.redoLabel ? `下一步:${history.redoLabel}(Ctrl+Y)` : "沒有可以重做的修改"}
        aria-label="下一步"
        className={base}
      >
        <Redo2 size={13} />
      </button>
    </div>
  );
}
