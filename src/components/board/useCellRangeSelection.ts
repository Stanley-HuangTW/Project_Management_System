"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** 框選的結果:同一欄、由上到下的一段儲存格(畫面上看得到的列,收合的、被篩掉的不在裡面)。 */
export type CellRange = { columnId: string; itemIds: string[] };

/** 儲存格要帶這兩個屬性,選取才找得到它。 */
export const CELL_ITEM_ATTR = "data-cell-item";
export const CELL_COLUMN_ATTR = "data-cell-col";
const SELECTED_ATTR = "data-range-selected";
const DRAGGING_CLASS = "cell-range-dragging";
/** 垂直拖超過這麼多 px 才算框選;更短的是一般的點擊。 */
const DRAG_THRESHOLD_PX = 6;

function isEditable(el: Element | null): boolean {
  return !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);
}

/** 滑鼠的 Y 落在哪一格:同一欄的格子由上到下排,超出頭尾就取頭或尾,落在格子之間(分組之間)取上面那一格。 */
function indexAtY(cells: HTMLElement[], y: number): number {
  let found = 0;
  for (let i = 0; i < cells.length; i++) {
    const rect = cells[i].getBoundingClientRect();
    if (y >= rect.top) found = i;
    if (y < rect.bottom) break;
  }
  return found;
}

/**
 * 像試算表一樣在表格的某一欄框選一段儲存格:在同一欄垂直拖曳,或先點一格再按住 Shift 點另一格;
 * 框選之後按 Ctrl+V 就交給 onPaste(回傳 true 代表處理完了,框選就取消;回 false 保留框選,例如使用者按了取消)。
 * Esc、點別的地方也會取消框選。
 *
 * 單純的點擊還是原本的「點進去編輯」——只有垂直拖超過一小段距離才進入框選。框選的標示直接加在
 * DOM 上(data-range-selected,樣式在 globals.css),拖的時候不必讓整張表重畫。
 */
export function useCellRangeSelection(
  containerRef: RefObject<HTMLElement | null>,
  onPaste: (range: CellRange, text: string) => boolean | Promise<boolean>
) {
  const [range, setRange] = useState<CellRange | null>(null);
  const rangeRef = useRef<CellRange | null>(null);
  const onPasteRef = useRef(onPaste);
  useEffect(() => {
    onPasteRef.current = onPaste;
  });

  const clear = useCallback(() => {
    containerRef.current?.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((el) => el.removeAttribute(SELECTED_ATTR));
    rangeRef.current = null;
    setRange(null);
  }, [containerRef]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    /** Shift+點擊的起點:最後一次點的那一格。 */
    let anchor: { itemId: string; columnId: string } | null = null;
    let pending: { x: number; y: number; cell: HTMLElement } | null = null;
    let drag: { cells: HTMLElement[]; startIndex: number } | null = null;
    let suppressMouseDown = false;

    const cellOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>(`[${CELL_COLUMN_ATTR}]`) : null;
    const columnCells = (columnId: string) =>
      [...root.querySelectorAll<HTMLElement>(`[${CELL_COLUMN_ATTR}="${CSS.escape(columnId)}"]`)];
    const blurActive = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active)) active.blur();
    };

    function select(cells: HTMLElement[], from: number, to: number) {
      root!.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((el) => el.removeAttribute(SELECTED_ATTR));
      const picked = cells.slice(Math.min(from, to), Math.max(from, to) + 1);
      picked.forEach((c) => c.setAttribute(SELECTED_ATTR, "1"));
      const next: CellRange = {
        columnId: picked[0].getAttribute(CELL_COLUMN_ATTR)!,
        itemIds: picked.map((c) => c.getAttribute(CELL_ITEM_ATTR)!),
      };
      rangeRef.current = next;
      setRange(next);
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const cell = cellOf(e.target);
      if (!cell) {
        // 點在表格的別處:取消框選。
        if (rangeRef.current) clear();
        anchor = null;
        pending = null;
        return;
      }
      const columnId = cell.getAttribute(CELL_COLUMN_ATTR)!;
      const itemId = cell.getAttribute(CELL_ITEM_ATTR)!;
      if (e.shiftKey && anchor && anchor.columnId === columnId) {
        const cells = columnCells(columnId);
        const from = cells.findIndex((c) => c.getAttribute(CELL_ITEM_ATTR) === anchor!.itemId);
        const to = cells.indexOf(cell);
        if (from >= 0 && to >= 0) {
          e.preventDefault();
          suppressMouseDown = true;
          blurActive();
          select(cells, from, to);
          return;
        }
      }
      if (rangeRef.current) clear();
      anchor = { itemId, columnId };
      pending = { x: e.clientX, y: e.clientY, cell };
    };

    // 取消 pointerdown 之後,有些瀏覽器仍會送 mousedown 並把焦點給輸入框,這裡一併擋掉。
    const onMouseDown = (e: MouseEvent) => {
      if (suppressMouseDown) {
        e.preventDefault();
        suppressMouseDown = false;
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!pending && !drag) return;
      if (!(e.buttons & 1)) {
        pending = null;
        return;
      }
      if (!drag) {
        const dy = e.clientY - pending!.y;
        const dx = e.clientX - pending!.x;
        if (Math.abs(dy) < DRAG_THRESHOLD_PX || Math.abs(dy) < Math.abs(dx)) return;
        const cells = columnCells(pending!.cell.getAttribute(CELL_COLUMN_ATTR)!);
        const startIndex = cells.indexOf(pending!.cell);
        if (startIndex < 0) return;
        drag = { cells, startIndex };
        blurActive();
        document.body.classList.add(DRAGGING_CLASS);
        window.getSelection()?.removeAllRanges();
      }
      select(drag.cells, drag.startIndex, indexAtY(drag.cells, e.clientY));
    };

    const onPointerUp = () => {
      pending = null;
      if (drag) {
        drag = null;
        document.body.classList.remove(DRAGGING_CLASS);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rangeRef.current) clear();
    };

    const onPasteEvent = (e: ClipboardEvent) => {
      const current = rangeRef.current;
      if (!current) return;
      // 游標在輸入框裡(包含打開的對話框)就是一般的貼上文字。
      if (isEditable(document.activeElement)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      e.preventDefault();
      void Promise.resolve(onPasteRef.current(current, text)).then((done) => {
        if (done) clear();
      });
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPasteEvent);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPasteEvent);
      document.body.classList.remove(DRAGGING_CLASS);
    };
  }, [containerRef, clear]);

  return { range, clear };
}
