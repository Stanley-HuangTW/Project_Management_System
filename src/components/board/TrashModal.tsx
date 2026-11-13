"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { listTrashedItems, restoreItem, purgeItem, type TrashedItem } from "@/lib/actions/trash";
import { localeDateTimeWithWeekday } from "@/lib/weekdayLabel";

/** 已刪除的工作項:還原(連同一起刪掉的子項目、被改寫的前置依賴)或永久刪除。 */
export function TrashModal({
  boardId,
  open,
  onOpenChange,
}: {
  boardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [items, setItems] = useState<TrashedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listTrashedItems(boardId));
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const rows = await listTrashedItems(boardId);
      if (!cancelled) {
        setItems(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, boardId]);

  async function handleRestore(item: TrashedItem) {
    setBusyId(item.id);
    try {
      const result = await restoreItem(item.id);
      if (result.error) {
        await notify(result.error, { title: "無法還原" });
        return;
      }
      await reload();
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function handlePurge(item: TrashedItem) {
    const ok = await confirm(
      `永久刪除「${item.name}」${item.childCount > 0 ? `及其 ${item.childCount} 個子項目` : ""}?連同它的留言、檔案與歷史紀錄一併消失,這次真的無法復原。`,
      { title: "永久刪除", confirmLabel: "永久刪除", danger: true }
    );
    if (!ok) return;
    setBusyId(item.id);
    try {
      const result = await purgeItem(item.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除" });
        return;
      }
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="垃圾桶" size="lg">
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        已刪除的工作項會留在這裡。還原時會一併還原跟著刪除的子項目,並把刪除時被改寫的前置依賴放回去。
      </p>

      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && items.length === 0 && (
        <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">垃圾桶是空的</p>
      )}

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-neutral-800 dark:text-neutral-100">
                {item.name}
                {item.childCount > 0 && (
                  <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">
                    +{item.childCount} 個子項目
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                {item.groupName}・{localeDateTimeWithWeekday(item.deletedAt)}
                {item.deletedBy ? `・由 ${item.deletedBy} 刪除` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handleRestore(item)}
              className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50"
            >
              <RotateCcw size={13} /> 還原
            </button>
            <button
              type="button"
              disabled={busyId === item.id}
              onClick={() => handlePurge(item)}
              className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
            >
              <Trash2 size={13} /> 永久刪除
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
