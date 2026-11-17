"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ColumnData, UserOption } from "@/types/board";
import { bulkSetCellValue, bulkShiftDates } from "@/lib/actions/bulk";
import { getStatusOptions } from "@/types/column";
import { useDialogs } from "@/components/ui/DialogProvider";
import { actionErrorMessage } from "@/lib/userError";

/** 批次下拉 / 輸入框的外觀(表格的批次編輯列與甘特圖的選取列共用)。 */
export const bulkSelectClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-50";

/**
 * 跑一個批次動作:成功之後重新整理、跳出「已套用 N 項 + 略過的原因」,有套用就清掉勾選。
 * 權限是伺服器逐項檢查的,沒權限的項目會被略過並說明,不會讓整批失敗。
 */
export function useBulkRun(onClear: () => void) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [busy, setBusy] = useState(false);

  async function run(label: string, action: () => Promise<{ applied: number; skipped: string[] }>) {
    setBusy(true);
    try {
      const result = await action();
      router.refresh();
      const lines = [`${label}:已套用 ${result.applied} 項`, ...result.skipped];
      await notify(lines.join("\n"), { title: "批次編輯完成" });
      if (result.applied > 0) onClear();
    } catch (err) {
      await notify(actionErrorMessage(err, "批次編輯失敗"), { title: "批次編輯失敗" });
    } finally {
      setBusy(false);
    }
  }

  return { busy, run };
}

/** 每個狀態欄一個下拉:選了就把勾選的項目全部設成那個值(例如一次把 Status 都改成 Completed)。 */
export function BulkStatusSelects({
  boardId,
  columns,
  ids,
  busy,
  run,
}: {
  boardId: string;
  columns: ColumnData[];
  ids: string[];
  busy: boolean;
  run: (label: string, action: () => Promise<{ applied: number; skipped: string[] }>) => Promise<void>;
}) {
  return (
    <>
      {columns
        .filter((c) => c.type === "STATUS")
        .map((column) => (
          <select
            key={column.id}
            value=""
            disabled={busy}
            data-bulk-status={column.name}
            onChange={(e) => {
              const value = e.target.value;
              e.target.value = "";
              if (value) run(`批次設定「${column.name}」`, () => bulkSetCellValue(boardId, ids, column.id, value));
            }}
            className={bulkSelectClass}
          >
            <option value="">設定{column.name}...</option>
            {getStatusOptions(column.options).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        ))}
    </>
  );
}

/**
 * The bar that appears once rows are ticked. Everything here is something you
 * would otherwise do one cell at a time down a few hundred rows — a status
 * sweep after a review, reassigning someone's work, pushing a slipped phase
 * back a week.
 */
export function BulkEditBar({
  boardId,
  columns,
  users,
  selectedIds,
  onClear,
  children,
}: {
  boardId: string;
  columns: ColumnData[];
  users: UserOption[];
  selectedIds: Set<string>;
  onClear: () => void;
  /** 接在批次編輯後面的其他動作(複製、移動、刪除)。 */
  children?: ReactNode;
}) {
  const { notify, confirm } = useDialogs();
  const { busy, run } = useBulkRun(onClear);
  const [shiftDays, setShiftDays] = useState("7");

  const ids = [...selectedIds];
  const personColumns = columns.filter((c) => c.type === "PERSON");

  async function handleShift() {
    const days = Number(shiftDays);
    if (!Number.isFinite(days) || days === 0) {
      await notify("請輸入要推移的天數(可為負數表示提前)", { title: "無法推移" });
      return;
    }
    const ok = await confirm(
      `將選取的 ${ids.length} 個工作項${days > 0 ? "往後" : "往前"}推移 ${Math.abs(days)} 天?後續依賴的項目會跟著重算。`,
      { title: "批次推移時程", confirmLabel: "推移" }
    );
    if (!ok) return;
    await run("批次推移時程", () => bulkShiftDates(boardId, ids, days));
  }

  const selectClass = bulkSelectClass;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-3 py-2 text-xs">
      <span className="font-medium text-blue-800 dark:text-blue-200">已選 {ids.length} 項</span>

      <BulkStatusSelects boardId={boardId} columns={columns} ids={ids} busy={busy} run={run} />

      {personColumns.map((column) => (
        <UserSelect
          key={column.id}
          users={users}
          disabled={busy}
          extraOptions={[{ value: "__clear__", label: "— 清除 —" }]}
          value=""
          placeholder={`設定${column.name}...`}
          onChange={(value) => {
            if (!value) return;
            run(`批次設定「${column.name}」`, () =>
              bulkSetCellValue(boardId, ids, column.id, value === "__clear__" ? null : value)
            );
          }}
          className={selectClass}
        />
      ))}

      <span className="ml-1 text-blue-800 dark:text-blue-200">推移</span>
      <input
        type="number"
        value={shiftDays}
        disabled={busy}
        onChange={(e) => setShiftDays(e.target.value)}
        className="w-16 rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500"
      />
      <span className="text-blue-800 dark:text-blue-200">天</span>
      <button
        type="button"
        disabled={busy}
        onClick={handleShift}
        className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        套用
      </button>

      {children}

      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900"
      >
        <X size={13} /> 取消選取
      </button>
    </div>
  );
}
