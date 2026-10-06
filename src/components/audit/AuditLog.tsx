"use client";

import { useCallback, useEffect, useState } from "react";
import type { AuditCategory } from "@prisma/client";
import { listAuditLog, type AuditRow } from "@/lib/actions/audit";

const PAGE = 100;

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  ITEM: "工作項",
  BOARD: "看板",
  BASELINE: "基準線",
  VISIBILITY: "可見範圍",
  COST: "費率與成本",
  SETTINGS: "系統設定",
  ACCESS: "權限",
  GATE: "閘門",
  CHANGE: "變更單",
  APPROVAL: "審核",
  RISK: "風險議題",
};

const CATEGORY_CLASS: Record<AuditCategory, string> = {
  ITEM: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  BOARD: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  BASELINE: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-200",
  VISIBILITY: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  COST: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  SETTINGS: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  ACCESS: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  GATE: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  CHANGE: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  APPROVAL: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  RISK: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

/**
 * 稽核軌跡 — who did what, when.
 *
 * The item-level log was always there; what was missing were the operations
 * that move money and commitments — a rate change, a baseline switch, a
 * project made private, a board deleted. Those are the ones people come here
 * to look up, so they default to the top of the list rather than being buried
 * under every cell edit.
 */
export function AuditLog({
  boards,
  actors,
}: {
  boards: { id: string; name: string }[];
  actors: { id: string; name: string }[];
}) {
  // Item edits are by far the most numerous and the least often asked about,
  // so the page opens on everything else.
  const [category, setCategory] = useState<AuditCategory | "ALL" | "NON_ITEM">("NON_ITEM");
  const [boardId, setBoardId] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  // The state is set only after the await, never synchronously in the effect
  // body — a cascading render on every filter change is exactly what the
  // spinner would be paying for.
  const load = useCallback(
    async (nextOffset: number, append: boolean) => {
      // "NON_ITEM" is a view, not a category: it asks for everything and
      // drops the item rows, which keeps the filter honest about there being
      // no such category in the data.
      const result = await listAuditLog({
        category: category === "NON_ITEM" ? "ALL" : category,
        boardId: boardId || null,
        actorId: actorId || null,
        from: from || null,
        to: to || null,
        limit: PAGE,
        offset: nextOffset,
      });
      const filtered =
        category === "NON_ITEM" ? result.rows.filter((r) => r.category !== "ITEM") : result.rows;
      setRows((prev) => (append ? [...prev, ...filtered] : filtered));
      setHasMore(result.hasMore);
      setOffset(nextOffset);
      setLoading(false);
    },
    [category, boardId, actorId, from, to]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listAuditLog({
        category: category === "NON_ITEM" ? "ALL" : category,
        boardId: boardId || null,
        actorId: actorId || null,
        from: from || null,
        to: to || null,
        limit: PAGE,
        offset: 0,
      });
      if (cancelled) return;
      setRows(category === "NON_ITEM" ? result.rows.filter((r) => r.category !== "ITEM") : result.rows);
      setHasMore(result.hasMore);
      setOffset(0);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [category, boardId, actorId, from, to]);

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as AuditCategory | "ALL" | "NON_ITEM")}
          className={fieldClass}
        >
          <option value="NON_ITEM">管理操作(不含工作項編輯)</option>
          <option value="ALL">全部</option>
          {(Object.keys(CATEGORY_LABELS) as AuditCategory[]).map((key) => (
            <option key={key} value={key}>
              {CATEGORY_LABELS[key]}
            </option>
          ))}
        </select>
        <select value={boardId} onChange={(e) => setBoardId(e.target.value)} className={fieldClass}>
          <option value="">全部看板</option>
          {boards.map((board) => (
            <option key={board.id} value={board.id}>
              {board.name}
            </option>
          ))}
        </select>
        <select value={actorId} onChange={(e) => setActorId(e.target.value)} className={fieldClass}>
          <option value="">全部人員</option>
          {actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
        <span className="text-xs text-neutral-400 dark:text-neutral-500">~</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
      </div>

      {rows.length === 0 && !loading ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
          這個條件下沒有紀錄。
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-2 px-3 py-2 text-xs">
              <span className="w-32 shrink-0 tabular-nums text-neutral-400 dark:text-neutral-500">
                {row.createdAt.slice(0, 16).replace("T", " ")}
              </span>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${CATEGORY_CLASS[row.category]}`}
              >
                {CATEGORY_LABELS[row.category]}
              </span>
              <span className="w-24 shrink-0 truncate text-neutral-700 dark:text-neutral-200">
                {row.actorName ?? "(已刪除的帳號)"}
              </span>
              <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-200">{row.message}</span>
              {row.boardName && (
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{row.boardName}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        {loading && <span className="text-xs text-neutral-400 dark:text-neutral-500">載入中...</span>}
        {hasMore && !loading && (
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load(offset + PAGE, true);
            }}
            className="rounded border border-neutral-200 dark:border-neutral-700 px-3 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            載入更多
          </button>
        )}
      </div>
    </div>
  );
}
