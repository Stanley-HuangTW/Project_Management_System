"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PercentInput } from "@/components/ui/PercentInput";
import type { ColumnData, UserOption } from "@/types/board";
import { getDistinctTextValues, applyResourceMapping } from "@/lib/actions/resourceMapping";

export function ResourceMappingModal({
  boardId,
  columns,
  users,
  open,
  onOpenChange,
}: {
  boardId: string;
  columns: ColumnData[];
  users: UserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const textColumns = columns.filter((c) => c.type === "TEXT");
  const personColumns = columns.filter((c) => c.type === "PERSON");
  const defaultSourceId =
    textColumns.find((c) => c.name === "Resource")?.id ?? textColumns[0]?.id ?? "";

  const [sourceColumnId, setSourceColumnId] = useState(defaultSourceId);
  const [targetChoice, setTargetChoice] = useState<string>(personColumns[0]?.id ?? "new");
  const [newColumnName, setNewColumnName] = useState("負責人");
  const [assignAllocation, setAssignAllocation] = useState(true);
  const [allocationPct, setAllocationPct] = useState(10);
  const [values, setValues] = useState<{ value: string; count: number }[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ updatedCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !sourceColumnId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setResult(null);
      try {
        const rows = await getDistinctTextValues(boardId, sourceColumnId);
        if (!cancelled) {
          setValues(rows);
          setMapping({});
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sourceColumnId, boardId]);

  async function handleApply() {
    setSubmitting(true);
    setError(null);
    try {
      const entries = Object.entries(mapping).filter(([, userId]) => userId);
      const res = await applyResourceMapping(
        boardId,
        sourceColumnId,
        newColumnName,
        targetChoice === "new" ? null : targetChoice,
        entries.map(([value, userId]) => ({ value, userId })),
        assignAllocation,
        allocationPct
      );
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "套用失敗");
    } finally {
      setSubmitting(false);
    }
  }

  const mappedCount = Object.values(mapping).filter(Boolean).length;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Resource 對應到帳號" size="lg">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {textColumns.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">此看板沒有文字型欄位可供對應。</p>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <span className="shrink-0 text-neutral-500 dark:text-neutral-400">來源欄位</span>
            <select
              value={sourceColumnId}
              onChange={(e) => setSourceColumnId(e.target.value)}
              className="flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            >
              {textColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="shrink-0 text-neutral-500 dark:text-neutral-400">寫入欄位</span>
            <select
              value={targetChoice}
              onChange={(e) => setTargetChoice(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
            >
              <option value="new">➕ 新增欄位</option>
              {personColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {targetChoice === "new" && (
              <input
                value={newColumnName}
                onChange={(e) => setNewColumnName(e.target.value)}
                placeholder="新欄位名稱"
                className="w-28 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
              />
            )}
          </div>

          <div className="mb-4 flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={assignAllocation}
                onChange={(e) => setAssignAllocation(e.target.checked)}
              />
              同時設定人員分配
            </label>
            {assignAllocation && (
              <>
                <PercentInput
                  value={allocationPct}
                  onChange={setAllocationPct}
                  className="w-16 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 outline-none focus:border-blue-500"
                />
                <span className="text-neutral-500 dark:text-neutral-400">%</span>
              </>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
          ) : values.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">此欄位沒有任何文字值。</p>
          ) : (
            <div className="mb-4 max-h-80 space-y-1.5 overflow-auto">
              {values.map(({ value, count }) => (
                <div
                  key={value}
                  className="flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1.5"
                >
                  <span
                    className="min-w-0 flex-1 truncate text-sm text-neutral-800 dark:text-neutral-100"
                    title={value}
                  >
                    {value}
                  </span>
                  <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{count} 項目</span>
                  <select
                    value={mapping[value] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => ({ ...prev, [value]: e.target.value }))
                    }
                    className="w-40 shrink-0 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
                  >
                    <option value="">略過</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {result && (
            <p className="mb-3 text-sm text-green-700">已更新 {result.updatedCount} 個項目。</p>
          )}

          <button
            type="button"
            disabled={submitting || mappedCount === 0}
            onClick={handleApply}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "套用中..." : `套用對應(${mappedCount} 個值)`}
          </button>
        </>
      )}
    </Modal>
  );
}
