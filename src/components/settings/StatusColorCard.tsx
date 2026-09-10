"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { getStatusOptions, type StatusOption } from "@/types/column";
import { updateStatusOptions } from "@/lib/actions/column";
import { defaultColorFor, DEFAULT_STATUS_COLORS } from "@/lib/statusDefaults";

export type StatusColorBoard = {
  id: string;
  name: string;
  columns: { id: string; name: string; type: string; options: unknown }[];
};

/**
 * 狀態欄位顏色 — the colour of every option of every STATUS column, in one
 * place.
 *
 * These colours are the board's whole visual language: Priority, Type,
 * Status and Link all read as colour first and text second, and until now
 * the only way to change one was to know it was set at board creation.
 */
export function StatusColorCard({ boards }: { boards: StatusColorBoard[] }) {
  const { notify, confirm } = useDialogs();
  const [boardId, setBoardId] = useState(boards[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  /** Unsaved edits, keyed by column id — so a slip of the colour picker is
   *  not a write to every board view at once. */
  const [drafts, setDrafts] = useState<Record<string, StatusOption[]>>({});

  const board = boards.find((b) => b.id === boardId);
  const statusColumns = (board?.columns ?? []).filter((c) => c.type === "STATUS");

  function optionsFor(column: { id: string; options: unknown }): StatusOption[] {
    return drafts[column.id] ?? getStatusOptions(column.options);
  }

  function setColor(columnId: string, optionId: string, color: string, current: StatusOption[]) {
    setDrafts({
      ...drafts,
      [columnId]: current.map((o) => (o.id === optionId ? { ...o, color } : o)),
    });
  }

  async function save(columnId: string) {
    const next = drafts[columnId];
    if (!next || !board) return;
    setBusy(true);
    try {
      await updateStatusOptions(board.id, columnId, next);
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[columnId];
        return rest;
      });
    } catch (e) {
      await notify(e instanceof Error ? e.message : "儲存失敗", { title: "無法儲存顏色" });
    } finally {
      setBusy(false);
    }
  }

  async function restoreDefaults(column: { id: string; name: string; options: unknown }) {
    const current = optionsFor(column);
    const restored = current.map((o) => ({ ...o, color: defaultColorFor(column.name, o.label) ?? o.color }));
    const changed = restored.filter((o, i) => o.color !== current[i].color).length;
    if (changed === 0) {
      await notify(`「${column.name}」目前就是預設顏色。`, { title: "沒有需要回復的項目" });
      return;
    }
    const ok = await confirm(`把「${column.name}」的 ${changed} 個選項改回預設顏色?`, {
      title: "回復預設顏色",
      confirmLabel: "回復",
    });
    if (!ok) return;
    setDrafts({ ...drafts, [column.id]: restored });
  }

  return (
    <section className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">狀態欄位顏色</h2>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        每個狀態欄位(Type / Priority / Status / Link 等)的每個選項顏色。改了之後表格、看板、
        甘特圖與報表都會跟著變——這些欄位在畫面上是先看顏色才看字的。
      </p>

      {boards.length > 1 && (
        <select
          value={boardId}
          onChange={(e) => {
            setBoardId(e.target.value);
            setDrafts({});
          }}
          className="mt-3 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
        >
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {statusColumns.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-400 dark:text-neutral-500">這個看板沒有狀態欄位。</p>
      ) : (
        <div className="mt-3 space-y-4">
          {statusColumns.map((column) => {
            const options = optionsFor(column);
            const dirty = !!drafts[column.id];
            return (
              <div key={column.id} className="rounded-md border border-neutral-100 dark:border-neutral-700 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-700 dark:text-neutral-100">{column.name}</span>
                  {DEFAULT_STATUS_COLORS[column.name.trim()] && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => restoreDefaults(column)}
                      className="flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-600 px-1.5 py-0.5 text-[11px] text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                    >
                      <RotateCcw size={11} /> 回復預設
                    </button>
                  )}
                  {dirty && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => save(column.id)}
                      className="ml-auto rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      儲存
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  {options.map((option) => {
                    const fallback = defaultColorFor(column.name, option.label);
                    return (
                      <label
                        key={option.id}
                        className="flex items-center gap-1.5 rounded border border-neutral-200 dark:border-neutral-700 px-1.5 py-1"
                        title={fallback && fallback !== option.color ? `預設 ${fallback}` : undefined}
                      >
                        <input
                          type="color"
                          value={option.color}
                          disabled={busy}
                          onChange={(e) => setColor(column.id, option.id, e.target.value, options)}
                          className="h-5 w-6 cursor-pointer rounded border-none bg-transparent p-0"
                        />
                        <span
                          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                          style={{ backgroundColor: option.color }}
                        >
                          {option.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-neutral-500 dark:text-neutral-400">
          預設顏色(新看板建立時使用,也是「回復預設」放回去的值)
        </summary>
        <div className="mt-2 space-y-1.5">
          {Object.entries(DEFAULT_STATUS_COLORS).map(([name, options]) => (
            <div key={name} className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{name}</span>
              {options.map((o) => (
                <span
                  key={o.id}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-white"
                  style={{ backgroundColor: o.color }}
                >
                  {o.label}
                </span>
              ))}
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
