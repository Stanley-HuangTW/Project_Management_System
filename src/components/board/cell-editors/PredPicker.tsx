"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Search, X } from "lucide-react";
import {
  splitPredEntry,
  formatPredEntries,
  type RelationshipType,
} from "@/lib/predecessorLink";
import { formatEdgeSuffix } from "@/lib/predEdgeSummary";

import type { PredOption } from "@/types/board";

const RELATIONSHIPS: RelationshipType[] = ["FS", "SS", "FF", "SF"];

export type { PredOption };

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

  /**
   * 跨看板的選項預設收起來。
   *
   * 兄弟看板有將近四百項,全部混進來的話,本看板自己的幾十項就被淹掉了 ——
   * 而絕大多數的前置都是設在自己看板裡的。要跨看板是明確的決定,就讓它是
   * 一個明確的勾選。
   */
  const [crossBoard, setCrossBoard] = useState(false);
  const [boardFilter, setBoardFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");

  const crossOptions = useMemo(() => options.filter((o) => o.boardId), [options]);
  const localOptions = useMemo(() => options.filter((o) => !o.boardId), [options]);
  const hasCross = crossOptions.length > 0;

  /** 勾了跨看板之後可以挑哪些看板 —— 順序照選項本身的順序。 */
  const boardChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of crossOptions) {
      if (o.boardId && !seen.has(o.boardId)) seen.set(o.boardId, o.boardName ?? "");
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [crossOptions]);

  /** 選定看板之後可以挑哪些分組。沒選看板就列出全部看板的分組。 */
  const groupChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const o of crossOptions) {
      if (boardFilter && o.boardId !== boardFilter) continue;
      if (o.groupId && !seen.has(o.groupId)) seen.set(o.groupId, o.groupName ?? "");
    }
    return [...seen].map(([id, name]) => ({ id, name }));
  }, [crossOptions, boardFilter]);

  const visible = useMemo(() => {
    let pool = crossBoard ? crossOptions : localOptions;
    if (crossBoard) {
      if (boardFilter) pool = pool.filter((o) => o.boardId === boardFilter);
      if (groupFilter) pool = pool.filter((o) => o.groupId === groupFilter);
    }
    const needle = query.trim().toLowerCase();
    if (!needle) return pool;
    return pool.filter((o) => (o.code + " " + o.name).toLowerCase().includes(needle));
  }, [crossBoard, crossOptions, localOptions, boardFilter, groupFilter, query]);

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

  function chooseBoard(id: string) {
    setBoardFilter(id);
    // 換了看板,舊的分組多半不屬於它 —— 留著會篩出空清單。
    setGroupFilter("");
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

  // Each edge's own relationship/lag rides along in the summary — otherwise
  // a cell reading "1.3.2 底盤機構設計" hides the fact that this particular
  // dependency is SS-2 and not what the Link column says.
  const describe = (s: SelectedPred) => {
    const suffix = formatEdgeSuffix(s);
    return `${s.code} ${s.name}${suffix ? ` ${suffix}` : ""}`;
  };
  const summary =
    selected.length === 0
      ? null
      : selected.length === 1
        ? describe(selected[0])
        : `${describe(selected[0])} 等 ${selected.length} 項`;

  return (
    <Popover.Root onOpenChange={handleOpenChange}>
      <Popover.Trigger
        disabled={disabled}
        title={selected.map(describe).join("\n") || undefined}
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
          {hasCross && (
            <div className="shrink-0 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={crossBoard}
                  onChange={(e) => {
                    setCrossBoard(e.target.checked);
                    setBoardFilter("");
                    setGroupFilter("");
                  }}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                跨看板
                <span className="text-neutral-400 dark:text-neutral-500">
                  ({crossOptions.length} 項)
                </span>
              </label>

              {crossBoard && (
                <div className="mt-1.5 flex gap-1">
                  <select
                    value={boardFilter}
                    onChange={(e) => chooseBoard(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
                  >
                    <option value="">全部看板</option>
                    {boardChoices.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-1 py-0.5 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
                  >
                    <option value="">全部分組</option>
                    {groupChoices.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
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
                    {/* 跨看板模式下,看板與分組已經在上面挑過了,再重複一次
                        會把真正要看的名稱擠掉。 */}
                    {crossBoard ? `${o.wbsCode ?? ""} ${o.name}` : `${o.code} ${o.name}`}
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
