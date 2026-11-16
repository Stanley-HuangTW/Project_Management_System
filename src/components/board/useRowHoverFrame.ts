"use client";

import { useCallback, useRef, type MouseEvent } from "react";

/**
 * 表格:滑到某個工作項時,把整列框起來。
 *
 * 表格一列是左右兩塊各自的 DOM(左邊項目名稱、右邊資料欄),CSS 的 :hover 沒辦法讓兩塊一起亮,
 * 所以在最外層用一個委派的 mouseover:找到滑到的那一列(data-table-row=項目 id),把同一個項目的
 * 兩塊都標上 data-row-hover,框的樣式在 globals.css。直接動 DOM 屬性、不用 React state ——
 * 大看板有幾千列,滑一下就整張表重新渲染不行。換列或滑出表格時把舊的標記拿掉。
 */
export function useRowHoverFrame() {
  const current = useRef<string | null>(null);

  const mark = useCallback((container: HTMLElement, id: string | null) => {
    if (current.current === id) return;
    const rows = (rowId: string) => container.querySelectorAll(`[data-table-row="${CSS.escape(rowId)}"]`);
    if (current.current) rows(current.current).forEach((el) => el.removeAttribute("data-row-hover"));
    current.current = id;
    if (id) rows(id).forEach((el) => el.setAttribute("data-row-hover", ""));
  }, []);

  const onMouseOver = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const row = (e.target as HTMLElement).closest("[data-table-row]");
      mark(e.currentTarget, row?.getAttribute("data-table-row") ?? null);
    },
    [mark]
  );
  const onMouseLeave = useCallback((e: MouseEvent<HTMLElement>) => mark(e.currentTarget, null), [mark]);

  return { onMouseOver, onMouseLeave };
}
