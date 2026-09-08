"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";

export type PredOption = { id: string; code: string; name: string };

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
    const resolved: PredOption[] = [];
    for (const part of parts) {
      const match = options.find((o) => o.id === part) ?? options.find((o) => o.code === part);
      if (match && !resolved.some((r) => r.id === match.id)) resolved.push(match);
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

  function commit(ids: string[]) {
    const unique = [...new Set(ids)];
    onChange(unique.length > 0 ? unique.join(",") : null);
  }

  function toggle(id: string) {
    const ids = selected.map((s) => s.id);
    commit(ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id]);
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
              已選 {selected.length} 項,時程以最晚完成的那一項為準
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
