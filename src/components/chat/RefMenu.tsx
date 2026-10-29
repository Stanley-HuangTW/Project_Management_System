"use client";

import { useEffect, useRef } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RefKind } from "@/lib/chatLinks";
import type { RefMenuRow } from "@/lib/chatRefMention";
import { REF_KIND_LABELS } from "./BoardRefPicker";

const stopFocusLoss = (e: React.MouseEvent) => e.preventDefault();

/**
 * 輸入框打 # 跳出的選單:四個類別各一段(工作項依階層巢狀、有子項的有箭頭可以收放,類別標題也能收起來),
 * 輸入框裡打的字就是搜尋。焦點一直留在輸入框,所以全部用 onMouseDown(不搶焦點);鍵盤由輸入框處理。
 */
export function RefMenu({
  rows,
  activeKey,
  searching,
  onPick,
  onToggleItem,
  onToggleKind,
}: {
  rows: RefMenuRow[];
  /** 游標鍵目前停的那一筆(`kind:id`)。 */
  activeKey: string | null;
  /** 輸入框裡有打字:搜尋中,符合的項目連同上層一律展開,不能收放。 */
  searching: boolean;
  onPick: (ref: { kind: RefKind; id: string; name: string }) => void;
  onToggleItem: (id: string) => void;
  onToggleKind: (kind: RefKind) => void;
}) {
  const activeRow = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  return (
    <div
      data-ref-suggest
      className="absolute bottom-full left-3 z-10 mb-1 w-[34rem] max-w-[calc(100%-1.5rem)] overflow-hidden rounded-md border border-neutral-200 bg-white text-sm shadow-md dark:border-neutral-700 dark:bg-neutral-900"
    >
      <ul className="max-h-72 overflow-auto py-1">
        {rows.map((row) => {
          if (row.type === "section") {
            return (
              <li key={`section:${row.kind}`}>
                <button
                  type="button"
                  disabled={searching}
                  data-ref-section-toggle={row.kind}
                  onMouseDown={(e) => {
                    stopFocusLoss(e);
                    onToggleKind(row.kind);
                  }}
                  className="sticky top-0 z-[1] flex w-full items-center gap-1 bg-neutral-50 px-2 py-1 text-left text-xs font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >
                  {row.collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  {REF_KIND_LABELS[row.kind]}
                  <span className="font-normal text-neutral-400">({row.count})</span>
                </button>
              </li>
            );
          }
          if (row.type === "more") {
            return (
              <li key="more" className="px-3 py-1.5 text-xs text-neutral-400">
                還有 {row.count} 筆,請多打幾個字縮小範圍
              </li>
            );
          }
          const key = `${row.kind}:${row.id}`;
          const active = key === activeKey;
          return (
            <li
              key={key}
              ref={active ? activeRow : undefined}
              className={`flex items-center gap-0.5 pr-3 ${active ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"}`}
              style={{ paddingLeft: 8 + row.depth * 16 }}
            >
              {row.hasChildren ? (
                <button
                  type="button"
                  disabled={searching}
                  data-ref-toggle={row.id}
                  aria-label={row.expanded ? "收合" : "展開"}
                  onMouseDown={(e) => {
                    stopFocusLoss(e);
                    onToggleItem(row.id);
                  }}
                  className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                >
                  {row.expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
              ) : (
                <span className="w-5 shrink-0" />
              )}
              <button
                type="button"
                data-ref-suggest-item={row.id}
                onMouseDown={(e) => {
                  stopFocusLoss(e);
                  onPick({ kind: row.kind, id: row.id, name: row.name });
                }}
                className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              >
                <span className={`min-w-0 flex-1 truncate ${row.muted ? "text-neutral-400 dark:text-neutral-500" : ""}`}>{row.name}</span>
                {row.hint && <span className="shrink-0 text-[11px] text-neutral-400">{row.hint}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-neutral-100 px-3 py-1 text-[11px] text-neutral-400 dark:border-neutral-800">
        ↑ ↓ 選　→ 展開　← 收合　Enter 挑　Esc 關閉　(打字就是搜尋)
      </div>
    </div>
  );
}
