"use client";

import { useEffect, useState } from "react";
import { explainItemSchedule } from "@/lib/actions/scheduleExplain";
import type { ItemScheduleExplanation } from "@/lib/scheduleExplain";

/**
 * 這個項目的開始日 / 完成日是怎麼來的,以及相關項目前置那一段(Lag、哪個前置決定了日期)。
 * 項目資料(儲存格、約束)一變就重新問伺服器——改了前置、Lag、天數,說明跟著換。
 * 還沒載入、載入失敗、或排不出日期的看板都是 null,畫面就照原本(沒有說明)顯示。
 *
 * 只認「這個項目」的結果:切換項目時,上一個項目的說明不會閃過去。
 */
export function useScheduleExplanation(
  boardId: string,
  item: {
    id: string;
    cellValues: unknown;
    constraintType?: string | null;
    constraintDate?: string | null;
    constraintRefItemId?: string | null;
    constraintRefEdge?: string | null;
    constraintRefDay?: number | null;
  } | null
): ItemScheduleExplanation | null {
  const [loaded, setLoaded] = useState<{ itemId: string; data: ItemScheduleExplanation | null } | null>(null);
  const itemId = item?.id ?? null;
  const signature = item
    ? JSON.stringify([
        item.cellValues,
        item.constraintType,
        item.constraintDate,
        item.constraintRefItemId,
        item.constraintRefEdge,
        item.constraintRefDay,
      ])
    : "";

  useEffect(() => {
    if (!itemId || !boardId) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await explainItemSchedule(boardId, itemId);
        if (!cancelled) setLoaded({ itemId, data });
      } catch {
        if (!cancelled) setLoaded({ itemId, data: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, itemId, signature]);

  return loaded && loaded.itemId === itemId ? loaded.data : null;
}
