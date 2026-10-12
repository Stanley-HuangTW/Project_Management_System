"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { describeEvent, eventTargetTab, formatEventTime, type ItemDetailTab } from "@/lib/itemEvents";
import { listItemEvents, type ItemEventRow } from "@/lib/actions/itemEvents";
import { EventBadge } from "./EventBadge";

/** 視窗打開才會掛上這一塊,所以每次打開都是重新載入(不會閃出上一次的內容)。 */
function EventLogBody({ itemId, onPick }: { itemId: string; onPick: (tab: ItemDetailTab) => void }) {
  const [rows, setRows] = useState<ItemEventRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listItemEvents(itemId);
        if (!cancelled) setRows(result);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  if (failed) return <p className="py-6 text-center text-sm text-red-600">載入失敗,請重新整理後再試。</p>;
  if (rows === null) return <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">還沒有更新記錄。</p>;
  }

  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
      {rows.map((row) => {
        const shown = describeEvent({ kind: row.kind, at: row.at, actorName: row.actorName, summary: row.summary });
        return (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onPick(eventTargetTab(row.kind))}
              title="點一下:跳到對應的分頁"
              className="flex w-full flex-col gap-1 rounded px-2 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <span className="flex items-start gap-2">
                <EventBadge label={shown.label} tone={shown.tone} />
                <span className="min-w-0 break-words text-sm text-neutral-800 dark:text-neutral-100">{shown.message}</span>
              </span>
              <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                {row.actorName ?? "系統"}・{formatEventTime(row.at)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 一個工作項的「更新記錄」:照時間(新的在前)列出所有更新與變化,格式跟通知列表一樣——
 * 類型標籤、改了什麼、誰、什麼時候。點一筆跳到項目視窗的對應分頁:留言跳「更新」,連結、待辦事項跳對應分頁,
 * 狀態與其他欄位修改跳「項目卡片」。
 */
export function ItemEventLogModal({
  itemId,
  itemName,
  open,
  onOpenChange,
  onPick,
}: {
  itemId: string;
  itemName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (tab: ItemDetailTab) => void;
}) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`更新記錄:${itemName}`} size="lg">
      {open && <EventLogBody itemId={itemId} onPick={onPick} />}
    </Modal>
  );
}
