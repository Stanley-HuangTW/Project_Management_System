"use client";

import { useMemo, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { compareNumericText } from "@/lib/wbs";
import {
  splitPredEntry,
  formatPredEntries,
  type RelationshipType,
} from "@/lib/predecessorLink";
import { formatEdgeSuffix } from "@/lib/predEdgeSummary";
import { listCrossBoardPredOptions } from "@/lib/actions/predOptions";

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
  boardId,
  value,
  options,
  current,
  getDefaultRelationship,
  parentCode,
  parentItemId,
  disabled = false,
  triggerClassName,
  onChange,
}: {
  /** 勾了跨看板之後,拿同群組其他看板的工作項要用。 */
  boardId: string;
  /** The stored Pred cell: comma-separated item ids, or a legacy WBS code. */
  value: string | null;
  options: PredOption[];
  /** 正在編輯前置的這個工作項自己。它不能是自己的前置,所以不在 options 裡;
   *  這裡另外給,清單照樣把它排在樹上原本的位置、標紅框(current task)、不能選,
   *  使用者才看得出「我在清單的哪裡」。 */
  current?: PredOption;
  /** 新選一個前置時,這條依賴的關聯類型:null = 沿用這個項目的 Link 欄(已經填了),
   *  否則是關係型別。每次選的當下才問(不是畫面重畫時),所以讀得到最新的 Link 欄。沒給就是 FS。 */
  getDefaultRelationship?: () => RelationshipType | null;
  /** Opening the list jumps here — the item's own parent is the most likely
   *  predecessor — without selecting it. */
  parentCode?: string;
  /** 目前這個項目的父項。同看板時預設展開它那一支。 */
  parentItemId?: string | null;
  disabled?: boolean;
  triggerClassName?: string;
  /** The new cell value: comma-separated ids, or null when nothing is left. */
  onChange: (value: string | null) => void;
}) {
  // Boards written before ids (and every spreadsheet import) store WBS codes
  // here; match those against the item they currently resolve to rather than
  // dropping them from the display.
  /** null = 還沒去拿過。拿過一次就留著,重開選單不必再等。 */
  const [fetched, setFetched] = useState<PredOption[] | null>(null);
  // 本看板的選項,加上勾了跨看板之後自己拿來的:挑選、解析已存的前置都要認得它們——
  // 只認 options 的話,項目卡片裡(沒有預先帶跨看板選項)點跨看板的項目會完全沒反應。
  const allOptions = useMemo(
    () => (fetched ? [...options, ...fetched.filter((f) => !options.some((o) => o.id === f.id))] : options),
    [options, fetched]
  );
  const selected = useMemo(() => {
    const parts = (value ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const resolved: SelectedPred[] = [];
    for (const part of parts) {
      const { ref, relationship, lag } = splitPredEntry(part);
      const match = allOptions.find((o) => o.id === ref) ?? allOptions.find((o) => o.code === ref);
      if (match && !resolved.some((r) => r.id === match.id)) {
        resolved.push({ ...match, relationship, lag });
      }
    }
    return resolved;
  }, [value, allOptions]);

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
  const [loadingCross, setLoadingCross] = useState(false);

  const crossOptions = useMemo(
    // 呼叫端已經帶了跨看板選項就用那份(表格的儲存格),否則用自己拿的。
    () => (options.some((o) => o.boardId) ? options.filter((o) => o.boardId) : (fetched ?? [])),
    [options, fetched]
  );
  const localOptions = useMemo(() => {
    const own = options.filter((o) => !o.boardId);
    if (!current) return own;
    return [...own, current].sort((a, b) => compareNumericText(a.code, b.code));
  }, [options, current]);

  async function toggleCrossBoard(next: boolean) {
    setCrossBoard(next);
    setBoardFilter("");
    setGroupFilter("");
    if (next) {
      // 跨看板:那是別人的看板,沒有哪一支特別可能,全部收起來讓使用者自己找。
      const pool = options.some((o) => o.boardId) ? options : (fetched ?? []);
      setCollapsed(collapseAllExcept(new Set(), pool));
    }
    if (!next || fetched !== null || options.some((o) => o.boardId)) return;
    setLoadingCross(true);
    try {
      const loaded = await listCrossBoardPredOptions(boardId);
      setFetched(loaded);
      setCollapsed(collapseAllExcept(new Set(), loaded));
    } catch {
      // 拿不到就當作沒有跨看板的選項,不要讓整個選單壞掉。
      setFetched([]);
    } finally {
      setLoadingCross(false);
    }
  }

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

  /**
   * 選單排成可收合的樹。
   *
   * 四百個項目平鋪的時候,要找的東西在哪一層、屬於哪一支完全看不出來。
   * 同看板時預設展開「目前這個項目的父項」那一支 —— 前置多半就在隔壁;
   * 跨看板時全部收起來,因為那是別人的看板,沒有哪一支特別可能。
   */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  /** 展開過一次就不再自動調整,否則使用者每收一支就被打開回去。 */
  const autoExpanded = useRef<string | null>(null);

  const childrenOf = useMemo(() => {
    const map = new Map<string, PredOption[]>();
    for (const o of visible) {
      const key = o.parentId ?? "";
      const list = map.get(key);
      if (list) list.push(o);
      else map.set(key, [o]);
    }
    return map;
  }, [visible]);

  /** 在這份清單裡找不到父項的,就是這一層的根 —— 篩選之後父項可能不在。 */
  const roots = useMemo(() => {
    const ids = new Set(visible.map((o) => o.id));
    return visible.filter((o) => !o.parentId || !ids.has(o.parentId));
  }, [visible]);

  /** 樹攤平成要畫的列,跳過被收起來的子樹。 */
  const treeRows = useMemo(() => {
    const out: { option: PredOption; depth: number; hasChildren: boolean }[] = [];
    const walk = (nodes: PredOption[], depth: number) => {
      for (const node of nodes) {
        const kids = childrenOf.get(node.id) ?? [];
        out.push({ option: node, depth, hasChildren: kids.length > 0 });
        if (kids.length > 0 && !collapsed.has(node.id)) walk(kids, depth + 1);
      }
    };
    walk(roots, 0);
    return out;
  }, [roots, childrenOf, collapsed]);

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
    const option = allOptions.find((o) => o.id === id);
    // 新加的前置:Link 欄已經填了關係就沿用它(預設),空白才預設 FS 並寫在這條依賴上。
    const relationship = getDefaultRelationship ? getDefaultRelationship() : "FS";
    if (option) commit([...selected, { ...option, relationship, lag: null }]);
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

  /** 全部收起來,只留下要展開的那條祖先鏈。 */
  function collapseAllExcept(keep: Set<string>, pool: PredOption[]) {
    const parents = new Set<string>();
    for (const o of pool) if (o.parentId) parents.add(o.parentId);
    for (const id of keep) parents.delete(id);
    return parents;
  }

  function handleOpenChange(open: boolean) {
    // Each opening starts a fresh search rather than reopening onto whatever
    // the last one was narrowed down to.
    if (!open) {
      setQuery("");
      autoExpanded.current = null;
      return;
    }
    // 同看板:展開目前項目父項的那一條鏈,其餘收起來。父項不在時全部收起。
    const chain = new Set<string>();
    if (parentItemId) {
      const parentOf = new Map(options.map((o) => [o.id, o.parentId ?? null]));
      let cursor: string | null = parentItemId;
      const seen = new Set<string>();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        chain.add(cursor);
        cursor = parentOf.get(cursor) ?? null;
      }
    }
    setCollapsed(collapseAllExcept(chain, options));
    autoExpanded.current = "local";
    const scrollTo = current?.code || parentCode;
    if (!scrollTo) return;
    // Popover.Content mounts into its portal on a render commit after
    // onOpenChange fires, so the target may not exist yet on the very next
    // frame — poll a few frames instead of assuming one rAF is enough.
    let attempts = 0;
    function tryScroll() {
      const target = viewportRef.current?.querySelector('[data-code="' + CSS.escape(scrollTo!) + '"]');
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
          collisionPadding={8}
          className="z-50 flex max-h-80 w-[34rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-md"
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
          {
            <div className="shrink-0 border-b border-neutral-100 px-2 py-1.5 dark:border-neutral-700">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-200">
                <input
                  type="checkbox"
                  checked={crossBoard}
                  onChange={(e) => void toggleCrossBoard(e.target.checked)}
                  className="h-3.5 w-3.5 accent-blue-600"
                />
                跨看板
                <span className="text-neutral-400 dark:text-neutral-500">
                  {loadingCross ? "(載入中...)" : crossBoard ? `(${crossOptions.length} 項)` : ""}
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
          }
          {selected.length > 0 && (
            <div
              className="max-h-40 shrink-0 overflow-y-auto border-b border-neutral-100 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-1"
              onWheel={(e) => {
                e.stopPropagation();
                e.currentTarget.scrollTop += e.deltaY;
              }}
            >
              {selected.map((s) => (
                <div key={s.id} className="flex items-center gap-1 px-1 py-1 text-xs">
                  <span className="min-w-0 flex-1 break-words text-neutral-700 dark:text-neutral-100" title={`${s.code} ${s.name}`}>
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
                    <option value="">預設(沿用 Link 欄)</option>
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
          <div
            ref={viewportRef}
            className="min-h-0 flex-1 overflow-y-auto p-1"
            onWheel={(e) => {
              e.stopPropagation();
              e.currentTarget.scrollTop += e.deltaY;
            }}
          >
            {/* 搜尋時攤平:打了字就是要直接找到那一個,樹狀反而礙事。 */}
            {(query.trim()
              ? visible.map((o) => ({ option: o, depth: 0, hasChildren: false }))
              : treeRows
            ).map(({ option: o, depth, hasChildren }) => {
              const isSelected = selected.some((s) => s.id === o.id);
              const isCollapsed = collapsed.has(o.id);
              const isCurrent = !!current && o.id === current.id;
              return (
                <div key={o.id} className="flex items-center">
                  <span style={{ width: depth * 12 }} className="shrink-0" />
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(o.id)) next.delete(o.id);
                          else next.add(o.id);
                          return next;
                        });
                      }}
                      aria-label={isCollapsed ? "展開" : "收合"}
                      className="shrink-0 rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-700 dark:hover:text-neutral-100"
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : (
                    // 沒有子項的列也讓出同樣的寬度,不然同一層的名稱會對不齊。
                    <span className="w-[18px] shrink-0" />
                  )}
                <button
                  type="button"
                  data-code={o.code}
                  data-current-task={isCurrent ? "" : undefined}
                  disabled={isCurrent}
                  title={isCurrent ? "目前這個工作項——不能選自己當前置" : undefined}
                  onClick={() => toggle(o.id)}
                  className={
                    isCurrent
                      ? "flex min-w-0 flex-1 cursor-not-allowed items-center justify-between gap-2 rounded border border-red-500 bg-red-50 px-2 py-1.5 text-left text-sm text-neutral-700 dark:bg-red-950/30 dark:text-neutral-100"
                      : "flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  }
                >
                  <span className="min-w-0 flex-1 break-words">
                    {/* 跨看板模式下,看板與分組已經在上面挑過了,再重複一次
                        會把真正要看的名稱擠掉 —— 但沒挑分組的時候就得標,
                        否則兩個分組的「1 POC Phase」分不出誰是誰。 */}
                    {crossBoard ? `${o.wbsCode ?? ""} ${o.name}` : `${o.code} ${o.name}`}
                    {crossBoard && !groupFilter && depth === 0 && o.groupName && (
                      <span className="ml-1.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                        {o.groupName}
                      </span>
                    )}
                  </span>
                  {isCurrent && <span className="shrink-0 text-[11px] font-medium text-red-600 dark:text-red-400">current task</span>}
                  {isSelected && <Check size={14} className="shrink-0 text-blue-600" />}
                </button>
                </div>
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
