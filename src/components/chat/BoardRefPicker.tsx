"use client";

import { useEffect, useMemo, useState } from "react";
import { listChatBoardRefs, listChatBoards } from "@/lib/actions/chat";
import type { ChatBoardRefs } from "@/lib/chatTypes";

/** 工作項、風險、問題。(「議題」就是風險登記冊裡的「問題」,兩種之外沒有第三種。) */
export type RefKind = "item" | "risk" | "issue";

export type BoardRef = {
  kind: RefKind;
  id: string;
  boardId: string;
  boardName: string;
  name: string;
};

export const REF_KIND_LABELS: Record<RefKind, string> = { item: "工作項", risk: "風險", issue: "問題" };

/** 清單上一次畫出來的上限;再多就請使用者輸入文字縮小範圍,不畫幾千列。 */
const RENDER_LIMIT = 80;

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-900 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/**
 * 從一個看板的清單裡挑一個工作項、風險或問題——除了搜尋之外,可以直接翻清單選。
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
  const [kind, setKind] = useState<RefKind>(kinds[0]);
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

  const rows = useMemo(() => {
    if (!refs || loadedFor !== activeBoard) return [];
    const make = (k: RefKind, id: string, name: string, hint: string): BoardRef & { hint: string } => ({
      kind: k,
      id,
      boardId: refs.boardId,
      boardName: refs.boardName,
      name,
      hint,
    });
    if (kind === "item") {
      return refs.items
        .filter((i) => !q || i.name.toLowerCase().includes(q) || i.wbsCode.includes(q))
        .map((i) => make("item", i.id, i.name, `${i.wbsCode ? `${i.wbsCode} · ` : ""}${i.groupName}`));
    }
    const wanted = kind === "risk" ? "RISK" : "ISSUE";
    return refs.risks
      .filter((r) => r.kind === wanted && (!q || r.title.toLowerCase().includes(q)))
      .map((r) => make(kind, r.id, r.title, r.mantisId !== null ? `Mantis #${r.mantisId}` : statusLabel(r.status)));
  }, [refs, loadedFor, activeBoard, kind, q]);

  const counts = useMemo(() => {
    if (!refs) return { item: 0, risk: 0, issue: 0 };
    return {
      item: refs.items.length,
      risk: refs.risks.filter((r) => r.kind === "RISK").length,
      issue: refs.risks.filter((r) => r.kind === "ISSUE").length,
    };
  }, [refs]);

  return (
    <div className="space-y-2 text-sm" data-ref-picker>
      {boardId === null && (
        <select
          value={chosenBoard ?? ""}
          onChange={(e) => {
            setChosenBoard(e.target.value || null);
            setQuery("");
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
        <>
          {kinds.length > 1 && (
            <div className="flex gap-1" role="tablist">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={kind === k}
                  data-ref-kind={k}
                  onClick={() => setKind(k)}
                  className={`rounded-md px-2.5 py-1 text-xs ${
                    kind === k
                      ? "bg-blue-600 text-white"
                      : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`}
                >
                  {REF_KIND_LABELS[k]}({counts[k]})
                </button>
              ))}
            </div>
          )}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`在這個看板的${REF_KIND_LABELS[kind]}裡找…`}
            className={inputClass}
            data-ref-filter
          />
          <ul className="max-h-48 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700" data-ref-list>
            {loading && <li className="px-3 py-2 text-neutral-400">載入中…</li>}
            {!loading && !refs && <li className="px-3 py-2 text-neutral-400">看不到這個看板</li>}
            {!loading && refs && rows.length === 0 && (
              <li className="px-3 py-2 text-neutral-400">{q ? "找不到符合的" : `這個看板沒有${REF_KIND_LABELS[kind]}`}</li>
            )}
            {rows.slice(0, RENDER_LIMIT).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => onPick({ kind: row.kind, id: row.id, boardId: row.boardId, boardName: row.boardName, name: row.name })}
                  data-ref-option={row.id}
                  className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100">{row.name}</span>
                  <span className="shrink-0 text-xs text-neutral-400">{row.hint}</span>
                </button>
              </li>
            ))}
            {rows.length > RENDER_LIMIT && (
              <li className="px-3 py-1.5 text-xs text-neutral-400">還有 {rows.length - RENDER_LIMIT} 筆,輸入文字縮小範圍</li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  return { OPEN: "未處理", MITIGATING: "處理中", PENDING_REVIEW: "待審核", CLOSED: "已結案" }[status] ?? status;
}
