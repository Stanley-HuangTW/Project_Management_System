"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  splitPredEntry,
  formatPredEntries,
  type RelationshipType,
} from "@/lib/predecessorLink";

const RELATIONSHIPS: RelationshipType[] = ["FS", "SS", "FF", "SF"];

export type PredOption = { id: string; code: string; name: string };

/** A chosen predecessor plus, when this edge overrides them, its own
 *  relationship and lag. Null means "use the item's Link/Lag columns". */
type SelectedPred = PredOption & { relationship: RelationshipType | null; lag: number | null };

/**
 * The Pred field's item picker, shared by the table cell and the assignment
 * modal so both behave the same.
 *
 * A task can wait on more than one thing, so this selects several: the cell
 * stores their ids comma-separated. Ids rather than WBS codes because a code
 * is positional — an insert above the target would silently re-point the
 * reference at its neighbour. The list still shows the code beside the name,
 * since that is how people refer to these.
 */
export function PredPicker({
  value,
  options,
  parentCode,
  disabled = false,
  triggerClassName,
  onChange,
}: {
  /** The stored Pred cell: comma-separated item ids, or a legacy WBS code. */
  value: string | null;
  options: PredOption[];
  /** Opening the list jumps here — the item's own parent is the most likely
   *  predecessor — without selecting it. */
  parentCode?: string;
  disabled?: boolean;
  triggerClassName?: string;
  /** The new cell value: comma-separated ids, or null when nothing is left. */
  onChange: (value: string | null) => void;
}) {
  // Boards written before ids (and every spreadsheet import) store WBS codes
  // here; match those against the item they currently resolve to rather than
  // dropping them from the display.
  const selected = useMemo(() => {
    const parts = (value ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const resolved: SelectedPred[] = [];
    for (const part of parts) {
      const { ref, relationship, lag } = splitPredEntry(part);
      const match = options.find((o) => o.id === ref) ?? options.find((o) => o.code === ref);
      if (match && !resolved.some((r) => r.id === match.id)) {
        resolved.push({ ...match, relationship, lag });
      }
    }
    return resolved;
  }, [value, options]);

  // A group runs to a couple of hundred items, far too many to find anything
  // in by scrolling — so the list filters as you type, on the code and the
  // name alike, since people search by either.
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => (o.code + " " + o.name).toLowerCase().includes(needle));
  }, [options, query]);

  const viewportRef = useRef<HTMLDivElement>(null);

  function commit(entries: SelectedPred[]) {
    onChange(
      formatPredEntries(
        entries.map((e) => ({ itemId: e.id, relationship: e.relationship, lag: e.lag }))
      )
    );
  }

  function toggle(id: string) {
    if (selected.some((s) => s.id === id)) {
      commit(selected.filter((s) => s.id !== id));
      return;
    }
    const option = options.find((o) => o.id === id);
    if (option) commit([...selected, { ...option, relationship: null, lag: null }]);
  }

  /** Changes one edge without touching the others. */
  function updateEdge(id: string, patch: Partial<Pick<SelectedPred, "relationship" | "lag">>) {
    commit(selected.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }

  function handleOpenChange(open: boolean) {
    // Each opening starts a fresh search rather than reopening onto whatever
    // the last one was narrowed down to.
    if (!open) {
      setQuery("");
      return;
    }
    if (!parentCode) return;
    // Popover.Content mounts into its portal on a render commit after
    // onOpenChange fires, so the target may not exist yet on the very next
    // frame — poll a few frames instead of assuming one rAF is enough.
    let attempts = 0;
    function tryScroll() {
      const target = viewportRef.current?.querySelector('[data-code="' + CSS.escape(parentCode!) + '"]');
      if (target) {
        target.scrollIntoView({ block: "center" });
      } else if (attempts++ < 10) {
        requestAnimationFrame(tryScroll);
      }
    }
    requestAnimationFrame(tryScroll);
  }

  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? `${selected[0].code} ${selected[0].name}`
        : `${selected[0].code} ${selected[0].name} 等 ${selected.length} 項`;

  return (
    <Popover.Root onOpenChange={handleOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        title={selected.map((s) => `${s.code} ${s.name}`).join("、") || undefined}
        className={
          triggerClassName ??
          "flex w-full min-w-0 items-center justify-between gap-1 rounded border-none bg-transparent px-2 py-1 text-left text-sm outline-none hover:bg-neutral-50 dark:hover:bg-neutral-800 focus:bg-white dark:focus:bg-neutral-900 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
        }
      >
        <span
          className={`min-w-0 flex-1 truncate ${summary ? "" : "text-neutral-400 dark:text-neutral-500"}`}
        >
          {summary ?? "未設定"}
        </span>
        <ChevronDown size={14} className="shrink-0 text-neutral-400" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex max-h-72 w-72 flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md"
        >
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 dark:border-neutral-700 px-2 py-1.5">
            <Search size={13} className="shrink-0 text-neutral-400" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜尋 WBS 或名稱..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => commit([])}
                title="全部清除"
                className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700 dark:hover:text-neutral-100"
              >
                <X size={13} />
              </button>
            )}
          </div>
          {selected.length > 0 && (
            <div className="max-h-40 shrink-0 overflow-y-auto border-b border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-1">
              {selected.map((s) => (
                <div key={s.id} className="flex items-center gap-1 px-1 py-1 text-xs">
                  <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-100" title={`${s.code} ${s.name}`}>
                    {s.code} {s.name}
                  </span>
                  {/* Per edge, because one task can wait for the sample to
                      ship (FS) and for the rig to be free (SS) at once. */}
                  <select
                    value={s.relationship ?? ""}
                    onChange={(e) =>
                      updateEdge(s.id, {
                        relationship: (e.target.value || null) as RelationshipType | null,
                      })
                    }
                    title="這條依賴的關係型別;「預設」表示沿用此項目的 Link 欄位"
                    className="shrink-0 rounded border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-1 py-0.5 outline-none focus:border-blue-500"
                  >
                    <option value="">預設</option>
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={s.lag ?? ""}
                    onChange={(e) =>
                      updateEdge(s.id, { lag: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    placeholder="Lag"
                    title="這條依賴的 Lag(天);空白表示沿用此項目的 Lag 欄位"
                    className="w-12 shrink-0 rounded border border-neutral-200 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-1 py-0.5 outline-none focus:border-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => toggle(s.id)}
                    className="shrink-0 rounded p-0.5 text-neutral-400 hover:text-red-600"
                    aria-label="移除此前置"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto p-1">
            {visible.map((o) => {
              const isSelected = selected.some((s) => s.id === o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  data-code={o.code}
                  onClick={() => toggle(o.id)}
                  className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {o.code} {o.name}
                  </span>
                  {isSelected && <Check size={14} className="shrink-0 text-blue-600" />}
                </button>
              );
            })}
            {visible.length === 0 && (
              <p className="px-2 py-3 text-center text-sm text-neutral-400 dark:text-neutral-500">
                找不到符合的工作項
              </p>
            )}
          </div>
          {selected.length > 1 && (
            <p className="shrink-0 border-t border-neutral-100 dark:border-neutral-700 px-2 py-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              已選 {selected.length} 項,時程以把這個項目推得最晚的那一條為準
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
