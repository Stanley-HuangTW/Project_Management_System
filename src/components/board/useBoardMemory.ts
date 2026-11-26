"use client";

import { useCallback, useEffect, useRef } from "react";
import { saveUiPrefs } from "@/lib/actions/uiPrefs";
import type { BoardMemory } from "@/lib/uiPrefs";

const DELAY_MS = 1500;

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** 把一次更動併進原本的看板記憶(甘特圖的設定逐欄位併,捲動位置不會洗掉收合的列)。 */
function applyPatch(base: BoardMemory, patch: BoardMemory): BoardMemory {
  const next: BoardMemory = { ...base, ...patch };
  if (patch.gantt) next.gantt = { ...(base.gantt ?? {}), ...patch.gantt };
  if (patch.scroll) next.scroll = { ...(base.scroll ?? {}), ...patch.scroll };
  return next;
}

/**
 * 這個人在這塊看板上的畫面記憶(上次停在哪個分頁、表格與甘特圖捲到哪裡、甘特圖的刻度……)怎麼存:
 * 更動先累積起來,安靜 1.5 秒才送一次(捲動時每一格都會呼叫);離開看板時把剩下的送出去。
 * 跟已經存著的一樣就不送 —— 一打開看板、什麼都沒動,不會白寫一次資料庫。
 */
export function useBoardMemorySaver(boardId: string, initial: BoardMemory | null) {
  const known = useRef<BoardMemory>(initial ?? {});
  // 這次打開看板之後的最新狀態:切到別的分頁再切回來,重新掛上的表格 / 看板要從這裡讀,不是打開時的舊值。
  const live = useRef<BoardMemory>(initial ?? {});
  const pending = useRef<BoardMemory>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    const next = applyPatch(known.current, patch);
    if (sameJson(next, known.current)) return;
    known.current = next;
    void saveUiPrefs({ boards: { [boardId]: patch } }).catch(() => {});
  }, [boardId]);

  const save = useCallback(
    (patch: BoardMemory) => {
      live.current = applyPatch(live.current, patch);
      pending.current = applyPatch(pending.current, patch);
      if (!timer.current) timer.current = setTimeout(flush, DELAY_MS);
    },
    [flush]
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const getLive = useCallback(() => live.current, []);
  return { save, getLive };
}
