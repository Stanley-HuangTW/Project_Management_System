"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { planNameReplace } from "@/lib/bulkRename";

const MAX_PREVIEW = 8;

const inputClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/**
 * 勾選之後「取代名稱字樣」:輸入要找的字樣與換成什麼,下面即時列出每個項目改完的樣子。
 * 只改勾選的項目本身,沒勾的子項目不動。
 */
export function BulkRenameDialog({
  items,
  busy,
  onConfirm,
  onClose,
}: {
  /** 勾選的項目(只取 id 與名稱)。 */
  items: { id: string; name: string }[];
  busy: boolean;
  onConfirm: (find: string, replace: string) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const plan = useMemo(() => planNameReplace(items, find, replace), [items, find, replace]);

  return (
    <Modal open onOpenChange={(open) => !open && !busy && onClose()} title="取代名稱字樣">
      <div className="space-y-4 text-sm text-neutral-700 dark:text-neutral-200">
        <p>已選 {items.length} 項,只會改打勾的項目本身(沒勾的子項目不動)。</p>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">尋找(區分大小寫)</span>
          <input
            autoFocus
            value={find}
            disabled={busy}
            onChange={(e) => setFind(e.target.value)}
            placeholder="例如 PoC"
            className={inputClass}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">取代為(留空就是刪掉那段字)</span>
          <input
            value={replace}
            disabled={busy}
            onChange={(e) => setReplace(e.target.value)}
            placeholder="例如 POC"
            className={inputClass}
          />
        </label>

        <div className="rounded-md bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-xs">
          {!find ? (
            <span className="text-neutral-500 dark:text-neutral-400">輸入要尋找的字樣後,這裡會列出改完的名稱。</span>
          ) : (
            <>
              <p className="font-medium text-neutral-700 dark:text-neutral-200">
                會改 {plan.changes.length} 項
                {plan.unchangedIds.length > 0 && `,${plan.unchangedIds.length} 項沒有這段字樣`}
                {plan.blankIds.length > 0 && `,${plan.blankIds.length} 項取代後會變成空白而略過`}
              </p>
              {plan.changes.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {plan.changes.slice(0, MAX_PREVIEW).map((c) => (
                    <li key={c.id} className="min-w-0 break-words">
                      <span className="text-neutral-500 dark:text-neutral-400 line-through">{c.from}</span>
                      <span className="mx-1 text-neutral-400">→</span>
                      <span className="text-blue-700 dark:text-blue-300">{c.to}</span>
                    </li>
                  ))}
                  {plan.changes.length > MAX_PREVIEW && (
                    <li className="text-neutral-500 dark:text-neutral-400">…另外還有 {plan.changes.length - MAX_PREVIEW} 項</li>
                  )}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || plan.changes.length === 0}
            onClick={() => onConfirm(find, replace)}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "取代中…" : `取代 ${plan.changes.length} 項`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
