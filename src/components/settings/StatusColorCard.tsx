"use client";

import { useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { DEFAULT_STATUS_PALETTE, getStatusOptions, type StatusOption } from "@/types/column";
import { saveStatusOptions } from "@/lib/actions/column";
import { MAX_STATUS_LABEL, MAX_STATUS_OPTIONS, REPORT_BUCKETS, newStatusId, type ReportBucketKey } from "@/lib/statusOptionsEdit";
import { defaultColorFor, DEFAULT_STATUS_COLORS } from "@/lib/statusDefaults";
import { actionErrorMessage } from "@/lib/userError";

export type StatusColorBoard = {
  id: string;
  name: string;
  columns: { id: string; name: string; type: string; options: unknown }[];
  /** 報表的狀態欄:新增的狀態要告訴報表算哪一類(尚未處理、暫停、已完成…)。 */
  reportStatusColumnId: string | null;
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
  /** 新增的狀態(還沒存)算報表的哪一類,key 是 column id → option id。 */
  const [placements, setPlacements] = useState<Record<string, Record<string, ReportBucketKey>>>({});
  const [newLabel, setNewLabel] = useState<Record<string, string>>({});

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

  function setLabel(columnId: string, optionId: string, label: string, current: StatusOption[]) {
    setDrafts({ ...drafts, [columnId]: current.map((o) => (o.id === optionId ? { ...o, label } : o)) });
  }

  function removeOption(columnId: string, optionId: string, current: StatusOption[]) {
    setDrafts({ ...drafts, [columnId]: current.filter((o) => o.id !== optionId) });
  }

  function addOption(columnId: string, current: StatusOption[]) {
    const label = (newLabel[columnId] ?? "").trim();
    if (!label) return;
    const id = newStatusId();
    const color = DEFAULT_STATUS_PALETTE[current.length % DEFAULT_STATUS_PALETTE.length];
    setDrafts({ ...drafts, [columnId]: [...current, { id, label, color }] });
    setPlacements({ ...placements, [columnId]: { ...placements[columnId], [id]: "inProgress" } });
    setNewLabel({ ...newLabel, [columnId]: "" });
  }

  async function save(columnId: string) {
    const next = drafts[columnId];
    if (!next || !board) return;
    setBusy(true);
    try {
      await saveStatusOptions(board.id, columnId, next, placements[columnId] ?? {});
      setDrafts((d) => {
        const rest = { ...d };
        delete rest[columnId];
        return rest;
      });
      setPlacements((p) => {
        const rest = { ...p };
        delete rest[columnId];
        return rest;
      });
    } catch (e) {
      await notify(actionErrorMessage(e, "儲存失敗"), { title: "無法儲存狀態" });
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
      <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">狀態欄位顏色與選項</h2>
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
        每個狀態欄位(Type / Priority / Status / Link 等)的選項:可以<b>新增自己的狀態</b>、改名、改顏色、刪除。
        改了之後表格、看板、甘特圖、篩選與報表都會跟著變。改名不影響已經選了它的工作項;還有工作項在用的狀態不能刪。
        報表的狀態欄(通常是 Status)新增狀態時要選它在報表裡算哪一類。
        預設的 Planned / In Progress / Completed 有些功能是用名字認的,建議不要改名。
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
                    const placement = placements[column.id]?.[option.id];
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
                        <input
                          value={option.label}
                          disabled={busy}
                          maxLength={MAX_STATUS_LABEL}
                          aria-label="狀態名稱"
                          onChange={(e) => setLabel(column.id, option.id, e.target.value, options)}
                          style={{ backgroundColor: option.color, width: `${Math.max(4, option.label.length * 1.1 + 1)}em` }}
                          className="rounded border-none px-1.5 py-0.5 text-[11px] font-medium text-white outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        {placement !== undefined && board?.reportStatusColumnId === column.id && (
                          <select
                            value={placement}
                            onChange={(e) =>
                              setPlacements({ ...placements, [column.id]: { ...placements[column.id], [option.id]: e.target.value as ReportBucketKey } })
                            }
                            aria-label="在報表裡算哪一類"
                            title="報表、週報、儀表板的進度統計把這個狀態算在哪一類"
                            className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-[11px] dark:border-neutral-600 dark:bg-neutral-900"
                          >
                            {REPORT_BUCKETS.map((b) => (
                              <option key={b.key} value={b.key}>
                                報表:{b.label}
                              </option>
                            ))}
                          </select>
                        )}
                        <button
                          type="button"
                          disabled={busy || options.length <= 1}
                          onClick={(e) => {
                            e.preventDefault();
                            removeOption(column.id, option.id, options);
                          }}
                          aria-label={`刪除狀態「${option.label}」`}
                          title="刪除這個狀態(還有工作項在用的,存檔時會擋下來)"
                          className="text-neutral-300 hover:text-red-600 disabled:opacity-30 dark:text-neutral-600"
                        >
                          <X size={12} />
                        </button>
                      </label>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    value={newLabel[column.id] ?? ""}
                    maxLength={MAX_STATUS_LABEL}
                    disabled={busy || options.length >= MAX_STATUS_OPTIONS}
                    placeholder="新狀態的名稱,例如 Pending"
                    aria-label="新狀態的名稱"
                    onChange={(e) => setNewLabel({ ...newLabel, [column.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addOption(column.id, options);
                      }
                    }}
                    className="w-56 rounded-md border border-neutral-300 px-2 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
                  />
                  <button
                    type="button"
                    disabled={busy || !(newLabel[column.id] ?? "").trim() || options.length >= MAX_STATUS_OPTIONS}
                    onClick={() => addOption(column.id, options)}
                    data-status-add
                    className="flex items-center gap-1 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    <Plus size={12} /> 新增狀態
                  </button>
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
