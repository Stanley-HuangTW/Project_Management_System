"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * 畫面向「說明」按鈕登記自己現在在哪:看板的分頁(表格、甘特圖、預算…)切換不會改網址,
 * 按鈕光看路徑分不出來,所以由 BoardView 登記 board:<分頁>。
 *
 * 用一個模組層級的小 store、不用 React 的 state:登記是「畫面掛上去 / 換分頁 / 離開」時才發生的事,
 * 按鈕只在被打開時讀一次最新的值。
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  if (current === next) return;
  current = next;
  for (const listener of listeners) listener();
}

/** 在這個元件掛著的期間,說明按鈕的提示是 key(例如 "board:gantt");離開就清掉。 */
export function useHelpHint(key: string | null) {
  useEffect(() => {
    if (!key) return;
    set(key);
    return () => set(null);
  }, [key]);
}

export function useCurrentHelpHint(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => null
  );
}
