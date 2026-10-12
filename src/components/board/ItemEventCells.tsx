"use client";

import { ITEM_EVENT_LABELS, eventTargetTab, formatEventTime, type ItemEventLine } from "@/lib/itemEvents";
import { useItemEvents } from "./ItemEventsContext";

const cellBase = "flex h-full min-w-0 items-center border-r border-neutral-100 px-2 dark:border-neutral-700";
const emptyText = <span className="text-xs text-neutral-300 dark:text-neutral-600">—</span>;

function TimeCell({
  iso,
  label,
  onOpen,
}: {
  iso: string | null | undefined;
  label: string;
  onOpen: () => void;
}) {
  return (
    <div className={cellBase}>
      {iso ? (
        <button
          type="button"
          onClick={onOpen}
          title={`切成${label}的時間(點開項目卡片)`}
          className="truncate rounded px-1 py-0.5 text-xs tabular-nums text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          {formatEventTime(iso)}
        </button>
      ) : (
        emptyText
      )}
    </div>
  );
}

function lastTitle(last: ItemEventLine): string {
  return `${last.actorName ?? "系統"}・${formatEventTime(last.at)}\n${last.summary}`;
}

/**
 * 表格最右邊三個唯讀的欄位:進行中時間(最近一次切成進行中)、完成時間(切成完成,切回別的狀態就清掉)、
 * 更新記錄(最近一筆更新或變化)。點下去跳出這個項目:更新、連結、待辦事項跳對應的分頁,狀態與其他欄位跳項目卡片。
 */
export function ItemEventCells({ itemId }: { itemId: string }) {
  const events = useItemEvents();
  const summary = events?.summaries[itemId];
  const open = (tab: Parameters<NonNullable<typeof events>["requestOpen"]>[1]) => events?.requestOpen(itemId, tab);
  const last = summary?.last;

  return (
    <>
      <TimeCell iso={summary?.startedAt} label="進行中" onOpen={() => open("card")} />
      <TimeCell iso={summary?.completedAt} label="完成" onOpen={() => open("card")} />
      <div className={cellBase}>
        {last ? (
          <button
            type="button"
            onClick={() => open(eventTargetTab(last.kind))}
            title={lastTitle(last)}
            className="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="shrink-0 rounded bg-neutral-100 px-1 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {ITEM_EVENT_LABELS[last.kind]}
            </span>
            <span className="min-w-0 truncate text-neutral-600 dark:text-neutral-300">
              {formatEventTime(last.at)}・{last.actorName ?? "系統"}
            </span>
          </button>
        ) : (
          emptyText
        )}
      </div>
    </>
  );
}
