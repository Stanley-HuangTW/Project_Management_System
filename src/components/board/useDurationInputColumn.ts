"use client";

import { useEffect, useState } from "react";
import { getDurationInputColumnId } from "@/lib/actions/predecessorSchedule";

// 同一個看板問一次就好(項目卡片一個一個打開,每次都問太浪費)。
const cache = new Map<string, Promise<string | null>>();

/** 這個看板上「改天數」的輸入欄的 id;還沒問到之前是 null。 */
export function useDurationInputColumnId(boardId: string): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let pending = cache.get(boardId);
    if (!pending) {
      pending = getDurationInputColumnId(boardId).catch(() => null);
      cache.set(boardId, pending);
    }
    void pending.then((value) => {
      if (!cancelled) setId(value);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId]);
  return id;
}
