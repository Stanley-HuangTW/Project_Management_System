"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CellSelection } from "@/lib/bomCellPaste";

/** 已存的列的資料格要帶這兩個屬性(空白列的格子不帶);資料欄的表頭帶 COL_HEADER_ATTR。 */
export const CELL_ROW_ATTR = "data-bom-cell-row";
export const CELL_COL_ATTR = "data-bom-cell-col";
export const COL_HEADER_ATTR = "data-bom-col-header";
/** 跟看板表格框選共用的標示(樣式在 globals.css),直接加在 DOM 上,拖的時候不必讓整張表重畫。 */
const SELECTED_ATTR = "data-range-selected";
const DRAGGING_CLASS = "cell-range-dragging";

export type BomLayout = { rowOrder: string[]; colOrder: string[] };

export type PasteTrigger = BomLayout & { selection: CellSelection; text: string };

function isEditable(el: Element | null): boolean {
  return !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);
}

const quote = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * BOM 表格像 Excel 一樣框選、複製、貼上更新:
 * - 框選:在格子上拖曳到別的格子(同一格裡拖還是選文字)、先點一格再按住 Shift 點另一格、點資料欄的表頭選整欄、Ctrl+A 全選。
 * - Ctrl+C:框選的格子複製成 Excel 看得懂的文字(整張表會多一列表頭)。
 * - Ctrl+V:有框選,或游標在已存的列的格子裡而貼上的是多格的內容 → onPasteUpdate(更新現有的列);
 *   游標在最下面的空白列、或表格外沒有框選 → onPasteNewRows(照原本貼成新的列)。貼一個值就是一般的貼進輸入框。
 * Esc、點別的格子都會取消框選。
 */
export function useBomCellSelection(
  containerRef: RefObject<HTMLElement | null>,
  options: {
    enabled: boolean;
    /** 回傳 true 代表處理完了(框選就取消);false 保留框選(例如使用者按了取消)。 */
    onPasteUpdate: (trigger: PasteTrigger) => boolean | Promise<boolean>;
    onPasteNewRows: (text: string) => void;
  }
) {
  const [range, setRange] = useState<CellSelection | null>(null);
  const rangeRef = useRef<CellSelection | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const clear = useCallback(() => {
    containerRef.current?.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((el) => el.removeAttribute(SELECTED_ATTR));
    rangeRef.current = null;
    setRange(null);
  }, [containerRef]);

  /** 畫面上現在的列與資料欄的順序(收起來的列不在畫面上,也就不在裡面)。 */
  const getLayout = useCallback((): BomLayout => {
    const root = containerRef.current;
    if (!root) return { rowOrder: [], colOrder: [] };
    const rowOrder: string[] = [];
    const seen = new Set<string>();
    root.querySelectorAll<HTMLElement>(`td[${CELL_ROW_ATTR}]`).forEach((td) => {
      const id = td.getAttribute(CELL_ROW_ATTR)!;
      if (!seen.has(id)) {
        seen.add(id);
        rowOrder.push(id);
      }
    });
    const colOrder = [...root.querySelectorAll<HTMLElement>(`th[${COL_HEADER_ATTR}]`)].map((h) => h.getAttribute(COL_HEADER_ATTR)!);
    return { rowOrder, colOrder };
  }, [containerRef]);

  const enabled = options.enabled;
  useEffect(() => {
    const root = containerRef.current;
    if (!root || !enabled) return;

    type CellRef = { rowId: string; colKey: string };
    let anchor: CellRef | null = null;
    let pending: { x: number; y: number; cell: HTMLElement } | null = null;
    let drag: { start: CellRef } | null = null;
    let suppressMouseDown = false;
    /** 最近一次按下滑鼠是在表格裡:Ctrl+A 才是「全選這張表」,不是整頁。 */
    let engaged = false;

    const cellRef = (td: HTMLElement): CellRef => ({ rowId: td.getAttribute(CELL_ROW_ATTR)!, colKey: td.getAttribute(CELL_COL_ATTR)! });
    const cellOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(`td[${CELL_ROW_ATTR}]`) : null);
    const headerOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>(`th[${COL_HEADER_ATTR}]`) : null);
    const blurActive = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active)) active.blur();
    };
    const cellEl = (rowId: string, colKey: string) =>
      root.querySelector<HTMLElement>(`td[${CELL_ROW_ATTR}="${CSS.escape(rowId)}"][${CELL_COL_ATTR}="${CSS.escape(colKey)}"]`);

    function select(rowIds: string[], colKeys: string[]) {
      root!.querySelectorAll(`[${SELECTED_ATTR}]`).forEach((el) => el.removeAttribute(SELECTED_ATTR));
      for (const r of rowIds) for (const c of colKeys) cellEl(r, c)?.setAttribute(SELECTED_ATTR, "1");
      const next: CellSelection = { rowIds, colKeys };
      rangeRef.current = next;
      setRange(next);
    }

    const between = (order: string[], a: string, b: string) => {
      const i = order.indexOf(a);
      const j = order.indexOf(b);
      if (i < 0 || j < 0) return null;
      return order.slice(Math.min(i, j), Math.max(i, j) + 1);
    };
    function selectRect(from: CellRef, to: CellRef) {
      const { rowOrder, colOrder } = getLayout();
      const rows = between(rowOrder, from.rowId, to.rowId);
      const cols = between(colOrder, from.colKey, to.colKey);
      if (rows && cols) select(rows, cols);
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      engaged = true;
      const header = headerOf(e.target);
      if (header) {
        const { rowOrder, colOrder } = getLayout();
        if (rowOrder.length === 0) return;
        const key = header.getAttribute(COL_HEADER_ATTR)!;
        blurActive();
        if (e.shiftKey && anchor) {
          const cols = between(colOrder, anchor.colKey, key);
          if (cols) {
            select(rowOrder, cols);
            return;
          }
        }
        anchor = { rowId: rowOrder[0], colKey: key };
        select(rowOrder, [key]);
        return;
      }
      const cell = cellOf(e.target);
      if (!cell) {
        if (rangeRef.current) clear();
        anchor = null;
        pending = null;
        return;
      }
      const here = cellRef(cell);
      if (e.shiftKey && anchor) {
        e.preventDefault();
        suppressMouseDown = true;
        blurActive();
        selectRect(anchor, here);
        return;
      }
      if (rangeRef.current) clear();
      anchor = here;
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
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const over = under instanceof Element ? under.closest<HTMLElement>(`td[${CELL_ROW_ATTR}]`) : null;
      if (!drag) {
        // 還在同一格裡拖是選文字;拖到別的格子才算框選。
        if (!pending || !over || over === pending.cell) return;
        drag = { start: cellRef(pending.cell) };
        blurActive();
        document.body.classList.add(DRAGGING_CLASS);
        window.getSelection()?.removeAllRanges();
      }
      if (over) selectRect(drag.start, cellRef(over));
    };

    const onPointerUp = () => {
      pending = null;
      if (drag) {
        drag = null;
        document.body.classList.remove(DRAGGING_CLASS);
      }
    };

    /** 在表格外按下滑鼠:Ctrl+A 不再是這張表的全選(框選本身保留,讓人可以去點工具列)。 */
    const onOutsideDown = (e: PointerEvent) => {
      if (!root.contains(e.target as Node)) engaged = false;
    };

    const dialogOpen = () => !!document.querySelector('[role="dialog"][data-state="open"]');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && rangeRef.current) {
        clear();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        if (dialogOpen() || isEditable(document.activeElement)) return;
        if (!rangeRef.current && !engaged) return;
        const { rowOrder, colOrder } = getLayout();
        if (rowOrder.length === 0 || colOrder.length === 0) return;
        e.preventDefault();
        select(rowOrder, colOrder);
      }
    };

    /** 框選的格子複製成 Excel 看得懂的文字:欄用 Tab、列用換行;整張表會多一列表頭。 */
    const onCopy = (e: ClipboardEvent) => {
      const current = rangeRef.current;
      if (!current || isEditable(document.activeElement) || dialogOpen()) return;
      const { rowOrder, colOrder } = getLayout();
      const valueOf = (rowId: string, colKey: string): string => {
        const control = cellEl(rowId, colKey)?.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
        if (!control) return ""; // 例如有子項目的列的單價(子項目加總)
        if (control instanceof HTMLSelectElement) {
          const option = control.selectedOptions[0];
          return option && option.value !== "" ? (option.textContent ?? "").trim() : "";
        }
        if (control.type === "checkbox") return control.checked ? "是" : "";
        return control.value;
      };
      const lines = current.rowIds.map((r) => current.colKeys.map((c) => quote(valueOf(r, c))).join("\t"));
      if (current.rowIds.length === rowOrder.length && current.colKeys.length === colOrder.length) {
        const heads = current.colKeys.map((k) => {
          const th = root.querySelector<HTMLElement>(`th[${COL_HEADER_ATTR}="${CSS.escape(k)}"]`);
          return quote((th?.innerText ?? k).replace(/\*\s*$/, "").trim());
        });
        lines.unshift(heads.join("\t"));
      }
      e.clipboardData?.setData("text/plain", lines.join("\n") + "\n");
      e.preventDefault();
    };

    const onPaste = (e: ClipboardEvent) => {
      if (dialogOpen()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      const active = document.activeElement;
      const current = rangeRef.current;
      const { onPasteUpdate, onPasteNewRows } = optionsRef.current;

      if (current && !isEditable(active)) {
        e.preventDefault();
        void Promise.resolve(onPasteUpdate({ ...getLayout(), selection: current, text })).then((done) => {
          if (done) clear();
        });
        return;
      }
      if (active && isEditable(active) && root.contains(active)) {
        // 一個值:照常貼進輸入框。
        if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return;
        const td = active.closest<HTMLElement>("td");
        e.preventDefault();
        if (td?.hasAttribute(CELL_ROW_ATTR)) {
          const here = cellRef(td);
          void onPasteUpdate({ ...getLayout(), selection: { rowIds: [here.rowId], colKeys: [here.colKey] }, text });
        } else {
          onPasteNewRows(text);
        }
      }
    };

    root.addEventListener("pointerdown", onPointerDown, true);
    root.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("pointerdown", onOutsideDown, true);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    return () => {
      root.removeEventListener("pointerdown", onPointerDown, true);
      root.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("pointerdown", onOutsideDown, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.body.classList.remove(DRAGGING_CLASS);
    };
  }, [containerRef, enabled, clear, getLayout]);

  return { range, clear, getLayout };
}
