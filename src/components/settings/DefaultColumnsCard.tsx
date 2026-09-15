"use client";

import { useState, useTransition } from "react";
import { Columns3 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  setDefaultBoardColumnsFromBoard,
  resetDefaultBoardColumns,
} from "@/lib/actions/systemSettings";
import type { DefaultColumn } from "@/lib/defaultColumns";

export type DefaultColumnsBoard = { id: string; name: string; columnCount: number };

/**
 * 新看板預設欄位.
 *
 * Set by copying a board that is already laid out the way this company's
 * projects actually look, rather than by typing column names in one at a time —
 * that is how anyone actually knows what they want, and it carries the
 * Type/Status/Link option lists across identically instead of subtly
 * differently.
 *
 * Existing boards are never touched: a board's columns hold its data.
 */
export function DefaultColumnsCard({
  boards,
  initialColumns,
  initialConfigured,
}: {
  boards: DefaultColumnsBoard[];
  initialColumns: DefaultColumn[];
  initialConfigured: boolean;
}) {
  const { notify, confirm } = useDialogs();
  const [columns, setColumns] = useState(initialColumns);
  const [configured, setConfigured] = useState(initialConfigured);
  const [sourceId, setSourceId] = useState(boards[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  function copyFrom() {
    const source = boards.find((b) => b.id === sourceId);
    if (!source) return;
    startTransition(async () => {
      try {
        const next = await setDefaultBoardColumnsFromBoard(sourceId);
        setColumns(next);
        setConfigured(true);
        await notify(
          `之後新增的看板都會帶「${source.name}」的 ${next.length} 個欄位。現有看板不受影響。`,
          { title: "已設定預設欄位" }
        );
      } catch (error) {
        await notify(error instanceof Error ? error.message : "無法設定", { title: "設定失敗" });
      }
    });
  }

  function reset() {
    startTransition(async () => {
      const ok = await confirm("新增看板時改回帶內建的那一組標準欄位?", {
        title: "恢復內建欄位",
        confirmLabel: "恢復",
      });
      if (!ok) return;
      const next = await resetDefaultBoardColumns();
      setColumns(next);
      setConfigured(false);
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 flex items-center gap-1.5 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        <Columns3 size={14} /> 新看板預設欄位
      </p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        新增看板時要自動建立哪些欄位。從一個已經排好的看板複製過來最省事——
        連 Type/Status/Link 的選項也會一起帶過去。
        <b>只影響之後新增的看板</b>,現有看板的欄位與資料都不會被動到。
      </p>

      <div className="mb-3 rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
        <p className="mb-1.5 text-xs text-neutral-400 dark:text-neutral-500">
          目前:{configured ? "自訂" : "內建標準欄位"},共 {columns.length} 欄
        </p>
        <div className="flex flex-wrap gap-1">
          {columns.map((column) => (
            <span
              key={column.name}
              className="rounded bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-700 dark:text-neutral-200"
              title={column.type}
            >
              {column.name}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sourceId}
          disabled={isPending || boards.length === 0}
          onChange={(e) => setSourceId(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
        >
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}({board.columnCount} 欄)
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isPending || !sourceId}
          onClick={copyFrom}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          設為預設
        </button>
        {configured && (
          <button
            type="button"
            disabled={isPending}
            onClick={reset}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            恢復內建
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500">
        Start/Days/Finish/Pred/Link/Lag/% Done 等名稱一致的欄位,建立後會自動接上看板設定。
        若複製來的看板帶有 start(set)/duration,新看板會有這兩個欄位但不會自動啟用唯讀排程
        ——要用的話,到上面的「甘特圖欄位對應」逐個看板指定。
      </p>
    </div>
  );
}
