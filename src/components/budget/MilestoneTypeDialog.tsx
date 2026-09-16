"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";

export type MilestoneTypeRow = { id: string; name: string };

/**
 * 里程碑類型的增刪改。
 *
 * 類型就是「排在哪一排」—— 同一個類型的里程碑排同一排,彼此重疊才會再
 * 往下長。本來是每個里程碑自己打一段字,打錯一個字就多出一排。
 */
export function MilestoneTypeDialog({
  open,
  onOpenChange,
  types,
  busy,
  onCreate,
  onRename,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  types: MilestoneTypeRow[];
  busy: boolean;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (type: MilestoneTypeRow) => void;
}) {
  const [draft, setDraft] = useState("");

  const field =
    "rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  function add() {
    const name = draft.trim();
    if (!name) return;
    setDraft("");
    onCreate(name);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="里程碑類型">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          同一個類型的里程碑排在同一排,時間重疊才會往下長。底下還有里程碑的類型刪不掉。
        </p>

        <div className="space-y-1.5">
          {types.length === 0 && (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">還沒有類型。</p>
          )}
          {types.map((type) => (
            <div key={type.id} className="flex items-center gap-2">
              <input
                defaultValue={type.name}
                disabled={busy}
                // 離開欄位才送出:每打一個字就打一次伺服器,游標會被重畫吃掉。
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== type.name) onRename(type.id, next);
                }}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className={`flex-1 ${field} disabled:opacity-50`}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => onDelete(type)}
                title={`刪除 ${type.name}`}
                className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-700">
          <input
            value={draft}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="新類型名稱,例如 軟體、機構、key part 備料"
            className={`flex-1 ${field} disabled:opacity-50`}
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={add}
            className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus size={13} />
            新增
          </button>
        </div>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            關閉
          </button>
        </div>
      </div>
    </Modal>
  );
}
