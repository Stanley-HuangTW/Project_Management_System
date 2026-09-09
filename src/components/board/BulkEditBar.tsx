"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ColumnData, UserOption } from "@/types/board";
import { bulkSetCellValue, bulkShiftDates } from "@/lib/actions/bulk";
import { getStatusOptions } from "@/types/column";
import { useDialogs } from "@/components/ui/DialogProvider";

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
}: {
  boardId: string;
  columns: ColumnData[];
  users: UserOption[];
  selectedIds: Set<string>;
  onClear: () => void;
}) {
  const router = useRouter();
  const { notify, confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [shiftDays, setShiftDays] = useState("7");

  const ids = [...selectedIds];
  const statusColumns = columns.filter((c) => c.type === "STATUS");
  const personColumns = columns.filter((c) => c.type === "PERSON");

  async function run(label: string, action: () => Promise<{ applied: number; skipped: string[] }>) {
    setBusy(true);
    try {
      const result = await action();
      router.refresh();
      const lines = [`${label}:已套用 ${result.applied} 項`, ...result.skipped];
      await notify(lines.join("\n"), { title: "批次編輯完成" });
      if (result.applied > 0) onClear();
    } catch (err) {
      await notify(err instanceof Error ? err.message : "批次編輯失敗", { title: "批次編輯失敗" });
    } finally {
      setBusy(false);
    }
  }

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

  const selectClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 px-3 py-2 text-xs">
      <span className="font-medium text-blue-800 dark:text-blue-200">已選 {ids.length} 項</span>

      {statusColumns.map((column) => (
        <select
          key={column.id}
          value=""
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            e.target.value = "";
            if (value) run(`批次設定「${column.name}」`, () => bulkSetCellValue(boardId, ids, column.id, value));
          }}
          className={selectClass}
        >
          <option value="">設定{column.name}...</option>
          {getStatusOptions(column.options).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      ))}

      {personColumns.map((column) => (
        <select
          key={column.id}
          value=""
          disabled={busy}
          onChange={(e) => {
            const value = e.target.value;
            e.target.value = "";
            if (value) {
              run(`批次設定「${column.name}」`, () =>
                bulkSetCellValue(boardId, ids, column.id, value === "__clear__" ? null : value)
              );
            }
          }}
          className={selectClass}
        >
          <option value="">設定{column.name}...</option>
          <option value="__clear__">— 清除 —</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
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
