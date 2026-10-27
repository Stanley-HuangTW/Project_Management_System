"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { listChatBoardRefs, listChatBoards } from "@/lib/actions/chat";
import type { ChatBoardRefs } from "@/lib/chatTypes";
import type { RefKind } from "@/lib/chatLinks";
import { filterItemsKeepingAncestors, riskKindOf } from "@/lib/chatRefs";

export type { RefKind };

export type BoardRef = {
  kind: RefKind;
  id: string;
  boardId: string;
  boardName: string;
  name: string;
};

/** 議題:從 MantisBT 同步來的問題單;風險、問題:在風險登記冊裡自己登記的。 */
export const REF_KIND_LABELS: Record<RefKind, string> = { item: "工作項", risk: "風險", issue: "問題", mantis: "議題" };

/** 清單上一次畫出來的上限;再多就請使用者輸入文字縮小範圍,不畫幾千列。 */
const RENDER_LIMIT = 200;

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

type Row = { key: string; kind: RefKind; id: string; name: string; hint: string; depth: number; muted: boolean; group: string | null };
type Section = { kind: RefKind; rows: (Row & { header: string | null })[]; total: number; more: number };

function statusLabel(status: string): string {
  return { OPEN: "未處理", MITIGATING: "處理中", PENDING_REVIEW: "待審核", CLOSED: "已結案" }[status] ?? status;
}

/**
 * 從一個看板挑一個工作項、風險、問題或議題:下拉選單,打開有搜尋框,
 * 清單分成「工作項 / 風險 / 問題 / 議題」四個類別(議題 = Mantis 同步來的),工作項依階層縮排成巢狀。
 * 搜尋時符合的工作項連同它的上層一起顯示(上層用淡色),才看得出在階層裡的位置。
 * boardId 給了(看板頻道)就固定是那個看板;沒給(私訊、聊天室)就先挑看板。
 * 清單由伺服器出,看板進不去、私人工作項都已經擋掉。
 */
export function BoardRefPicker({
  boardId,
  kinds,
  onPick,
}: {
  /** 固定看板;null = 讓使用者先挑看板。 */
  boardId: string | null;
  kinds: RefKind[];
  onPick: (ref: BoardRef) => void;
}) {
  const [boards, setBoards] = useState<{ id: string; name: string }[] | null>(null);
  const [chosenBoard, setChosenBoard] = useState<string | null>(null);
  const [refs, setRefs] = useState<ChatBoardRefs | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  /** 只看某一類;null = 全部類別。 */
  const [only, setOnly] = useState<RefKind | null>(null);
  const [query, setQuery] = useState("");

  const activeBoard = boardId ?? chosenBoard;

  useEffect(() => {
    if (boardId !== null) return;
    let stale = false;
    void listChatBoards().then((list) => {
      if (!stale) setBoards(list);
    });
    return () => {
      stale = true;
    };
  }, [boardId]);

  useEffect(() => {
    if (!activeBoard) return;
    let stale = false;
    void listChatBoardRefs(activeBoard).then((result) => {
      if (stale) return;
      setRefs(result);
      setLoadedFor(activeBoard);
    });
    return () => {
      stale = true;
    };
  }, [activeBoard]);

  const loading = !!activeBoard && loadedFor !== activeBoard;
  const q = query.trim().toLowerCase();

  /** 每個類別的全部筆數(不受搜尋影響),顯示在類別標籤上。 */
  const counts = useMemo(() => {
    const c: Record<RefKind, number> = { item: 0, risk: 0, issue: 0, mantis: 0 };
    if (!refs) return c;
    c.item = refs.items.length;
    for (const r of refs.risks) c[riskKindOf(r)]++;
    return c;
  }, [refs]);

  /** 依類別排好的列:工作項依階層(搜尋時留下符合的與它們的上層),其他類別各一段。 */
  const sections = useMemo(() => {
    if (!refs || loadedFor !== activeBoard) return [] as Section[];
    const built = kinds
      .filter((k) => only === null || only === k)
      .map((kind) => {
        if (kind === "item") {
          const kept = filterItemsKeepingAncestors(refs.items, q);
          const rows: Row[] = kept.map(({ item: i, muted }) => ({
            key: `item:${i.id}`,
            kind: "item" as const,
            id: i.id,
            name: i.name,
            hint: i.wbsCode,
            depth: i.depth,
            muted,
            group: i.groupName,
          }));
          return { kind, rows, total: q ? kept.filter((k) => !k.muted).length : rows.length };
        }
        const rows: Row[] = refs.risks
          .filter((r) => riskKindOf(r) === kind && (!q || r.title.toLowerCase().includes(q)))
          .map((r) => ({
            key: `${kind}:${r.id}`,
            kind,
            id: r.id,
            name: r.title,
            hint: r.mantisId !== null ? `Mantis #${r.mantisId} · ${statusLabel(r.status)}` : statusLabel(r.status),
            depth: 0,
            muted: false,
            group: null,
          }));
        return { kind, rows, total: rows.length };
      });
    // 畫面上一次最多畫 RENDER_LIMIT 列(各類別共用);超過的只提示還有幾筆。分組標題(工作項跨好幾個分組時)一起算好。
    let remaining = RENDER_LIMIT;
    return built
      .filter((section) => section.rows.length > 0)
      .map((section): Section => {
        const take = section.rows.slice(0, Math.max(0, remaining));
        remaining -= take.length;
        const multiGroup = new Set(take.map((r) => r.group)).size > 1;
        const rows = take.map((row, i) => ({
          ...row,
          header: multiGroup && row.group && row.group !== take[i - 1]?.group ? row.group : null,
        }));
        return { kind: section.kind, rows, total: section.total, more: section.rows.length - take.length };
      });
  }, [refs, loadedFor, activeBoard, kinds, only, q]);

  const shown = sections.reduce((sum, section) => sum + section.rows.length, 0);

  return (
    <div className="space-y-2 text-sm" data-ref-picker>
      {boardId === null && (
        <select
          value={chosenBoard ?? ""}
          onChange={(e) => {
            setChosenBoard(e.target.value || null);
            setRefs(null);
            setLoadedFor(null);
            setQuery("");
            setOnly(null);
            setOpen(false);
          }}
          className={inputClass}
          data-ref-board-select
          aria-label="選看板"
        >
          <option value="">先選一個看板…</option>
          {(boards ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {activeBoard && (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            data-ref-trigger
            className={`${inputClass} flex items-center justify-between text-left text-neutral-500 dark:text-neutral-400`}
          >
            <span>
              選擇{kinds.map((k) => REF_KIND_LABELS[k]).join("、")}…
            </span>
            <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>

          {open && (
            <div className="mt-1 rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900" data-ref-dropdown>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋…"
                autoFocus
                className={inputClass}
                data-ref-filter
              />
              {kinds.length > 1 && (
                <div className="mt-2 flex flex-wrap gap-1" role="tablist">
                  {([null, ...kinds] as (RefKind | null)[]).map((k) => (
                    <button
                      key={k ?? "all"}
                      type="button"
                      role="tab"
                      aria-selected={only === k}
                      data-ref-kind={k ?? "all"}
                      onClick={() => setOnly(k)}
                      className={`rounded-md px-2 py-0.5 text-xs ${
                        only === k
                          ? "bg-blue-600 text-white"
                          : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {k ? `${REF_KIND_LABELS[k]}(${counts[k]})` : "全部"}
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2 max-h-64 overflow-y-auto" data-ref-list>
                {loading && <p className="px-2 py-2 text-neutral-400">載入中…</p>}
                {!loading && !refs && <p className="px-2 py-2 text-neutral-400">看不到這個看板</p>}
                {!loading && refs && shown === 0 && (
                  <p className="px-2 py-2 text-neutral-400">{q ? "找不到符合的" : "這個看板沒有可選的項目"}</p>
                )}
                {sections.map((section) => {
                    return (
                      <div key={section.kind} data-ref-section={section.kind}>
                        <p className="sticky top-0 z-10 bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                          {REF_KIND_LABELS[section.kind]}
                          <span className="ml-1 font-normal text-neutral-400">({section.total})</span>
                        </p>
                        {section.rows.map((row) => {
                          return (
                            <div key={row.key}>
                              {row.header && <p className="px-2 pt-1.5 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">{row.header}</p>}
                              <button
                                type="button"
                                onClick={() => {
                                  onPick({ kind: row.kind, id: row.id, boardId: refs!.boardId, boardName: refs!.boardName, name: row.name });
                                  setOpen(false);
                                }}
                                data-ref-option={row.id}
                                data-ref-depth={row.depth}
                                style={{ paddingLeft: 8 + row.depth * 16 }}
                                className={`flex w-full items-baseline gap-2 py-1 pr-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 ${
                                  row.muted ? "text-neutral-400 dark:text-neutral-500" : "text-neutral-800 dark:text-neutral-100"
                                }`}
                              >
                                {row.kind === "item" && row.hint && (
                                  <span className="shrink-0 tabular-nums text-xs text-neutral-400 dark:text-neutral-500">{row.hint}</span>
                                )}
                                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                {row.kind !== "item" && <span className="shrink-0 text-xs text-neutral-400">{row.hint}</span>}
                              </button>
                            </div>
                          );
                        })}
                        {section.more > 0 && <p className="px-2 py-1 text-xs text-neutral-400">還有 {section.more} 筆,輸入文字縮小範圍</p>}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
