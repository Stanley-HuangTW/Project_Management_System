"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { describeEvent, eventTargetTab, formatEventTime } from "@/lib/itemEvents";
import type { UpdateFeedRow } from "@/lib/updateFeed";
import { EventBadge } from "@/components/board/EventBadge";

/** 每次點都不同的值——同一個項目連點兩次也會再打開一次。放在元件外面:Date.now() 是不純的呼叫,react-hooks/purity 不讓寫在元件裡(通知列表同一個做法)。 */
function nonce(): string {
  return String(Date.now());
}

const selectClass =
  "rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/**
 * 更新記錄頁:一筆一筆列出,格式跟通知列表一樣(類型標籤、看板 › 分組、WBS 與項目名稱、改了什麼、誰・什麼時候)。
 * 可以依看板、人、類型篩選;點一筆跳到那個看板、打開那個工作項並停在對應的分頁。
 */
export function UpdateFeed({ rows }: { rows: UpdateFeedRow[] }) {
  const router = useRouter();
  const [board, setBoard] = useState("");
  const [actor, setActor] = useState("");
  const [type, setType] = useState("");

  const shown = useMemo(
    () => rows.map((row) => ({ row, view: describeEvent(row) })),
    [rows]
  );
  const boards = useMemo(() => [...new Map(rows.map((r) => [r.boardId, r.boardName])).entries()], [rows]);
  const actors = useMemo(() => [...new Set(rows.map((r) => r.actorName).filter((n): n is string => !!n))].sort(), [rows]);
  const types = useMemo(() => [...new Set(shown.map((s) => s.view.label))], [shown]);

  const filtered = shown.filter(
    ({ row, view }) => (!board || row.boardId === board) && (!actor || row.actorName === actor) && (!type || view.label === type)
  );

  function open(row: UpdateFeedRow) {
    const tab = eventTargetTab(row.kind);
    router.push(`/boards/${row.boardId}?highlight=${row.itemId}&highlightAt=${nonce()}&highlightTab=${tab}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={board} onChange={(e) => setBoard(e.target.value)} className={selectClass} aria-label="看板">
          <option value="">全部看板</option>
          {boards.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={actor} onChange={(e) => setActor(e.target.value)} className={selectClass} aria-label="人">
          <option value="">所有人</option>
          {actors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass} aria-label="類型">
          <option value="">全部類型</option>
          {types.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{filtered.length} 筆</span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          沒有符合的更新記錄。
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900">
          {filtered.map(({ row, view }) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => open(row)}
                className="flex w-full flex-col gap-1 px-4 py-2.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <span className="flex items-center gap-1.5">
                  <EventBadge label={view.label} tone={view.tone} />
                  <span className="min-w-0 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    {row.boardName}
                    <span className="mx-1">›</span>
                    {row.groupName}
                  </span>
                </span>
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {row.wbsCode && <span className="mr-1.5 font-normal tabular-nums text-neutral-400 dark:text-neutral-500">{row.wbsCode}</span>}
                  {row.itemName}
                </span>
                <span className="break-words text-xs text-neutral-600 dark:text-neutral-300">{view.message}</span>
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {row.actorName ?? "系統"}・{formatEventTime(row.at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
