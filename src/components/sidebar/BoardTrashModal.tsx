"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError } from "@/lib/staleBuild";
import {
  listTrashedBoards,
  restoreBoard,
  purgeBoard,
  type TrashedBoard,
} from "@/lib/actions/board";
import { actionErrorMessage } from "@/lib/userError";
import { localeDateTimeWithWeekday } from "@/lib/weekdayLabel";

/** 已刪除的看板:還原(連同工作項、預算、基準線與所屬專案群組)或永久刪除。 */
export function BoardTrashModal({
  open,
  onOpenChange,
  canPurge,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 永久刪除僅 ADMIN——SUPERVISOR 只能還原自己建立的看板。 */
  canPurge: boolean;
}) {
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [boards, setBoards] = useState<TrashedBoard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setBoards(await listTrashedBoards());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await listTrashedBoards();
        if (!cancelled) setBoards(rows);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function run(board: TrashedBoard, work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusyId(board.id);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      await reload();
      router.refresh();
    } catch (err) {
      await notify(
        actionErrorMessage(err, "操作失敗"),
        { title: isStaleBuildError(err) ? "需要重新整理" : failTitle }
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handlePurge(board: TrashedBoard) {
    const ok = await confirm(
      `永久刪除看板「${board.name}」?它的 ${board.itemCount} 個工作項,以及預算、基準線、留言、附件與歷史紀錄會一起消失,這次真的無法復原,備份裡也不會有。`,
      { title: "永久刪除看板", confirmLabel: "永久刪除", danger: true }
    );
    if (!ok) return;
    await run(board, () => purgeBoard(board.id), "無法刪除");
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="看板垃圾桶" size="lg">
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        已刪除的看板會留在這裡,資料整份都還在。還原後它會回到原本的專案群組,跨看板的前置也會重新連動。
      </p>

      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>}
      {!loading && boards.length === 0 && (
        <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">垃圾桶是空的</p>
      )}

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
        {boards.map((board) => (
          <li key={board.id} className="flex items-center gap-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-neutral-800 dark:text-neutral-100">
                {board.name}
                <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">
                  {board.itemCount} 個工作項
                </span>
              </p>
              <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                {board.programName ? `${board.programName}・` : ""}
                {localeDateTimeWithWeekday(board.deletedAt)}
                {board.deletedBy ? `・由 ${board.deletedBy} 刪除` : ""}
              </p>
            </div>
            <button
              type="button"
              disabled={busyId === board.id}
              onClick={() => run(board, () => restoreBoard(board.id), "無法還原")}
              className="flex shrink-0 items-center gap-1 rounded-md border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50"
            >
              <RotateCcw size={13} /> 還原
            </button>
            {canPurge && (
              <button
                type="button"
                disabled={busyId === board.id}
                onClick={() => handlePurge(board)}
                className="flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-50"
              >
                <Trash2 size={13} /> 永久刪除
              </button>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
