"use client";

import { useSyncExternalStore } from "react";

/**
 * 「選取元素」模式的開關。按鈕(右下角「?」的小視窗、對話視窗的標題列)只負責叫它開始,
 * 真正的選取畫面與結果視窗在 ElementPicker 元件裡(掛在整個版面上)——兩邊靠這個模組層級的小 store 溝通,
 * 跟 helpHint.ts 同一個做法。
 */
let picking = false;
let mounted = 0;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** ElementPicker 掛上去時登記(沒掛的地方,例如登入頁,就不顯示「選取元素」的按鈕)。 */
export function registerElementPicker(): () => void {
  mounted++;
  emit();
  return () => {
    mounted--;
    picking = false;
    emit();
  };
}

export function startElementPicker() {
  if (mounted === 0 || picking) return;
  picking = true;
  emit();
}

export function stopElementPicker() {
  if (!picking) return;
  picking = false;
  emit();
}

export const useElementPicking = (): boolean =>
  useSyncExternalStore(subscribe, () => picking, () => false);

export const useElementPickerAvailable = (): boolean =>
  useSyncExternalStore(subscribe, () => mounted > 0, () => false);
