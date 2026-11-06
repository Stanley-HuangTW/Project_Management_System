"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { applyBomCellPaste, previewBomCellPaste, type CellPastePreview, type CellPasteRequest } from "@/lib/actions/bomCellPaste";
import { labelOfKey, type CellSelection } from "@/lib/bomCellPaste";
import { parseClipboardTable } from "@/lib/clipboardTable";
import type { BomColumnDef } from "@/lib/bomColumns";
import { actionErrorMessage } from "@/lib/userError";

const selectClass =
  "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

/**
 * 從 Excel 複製一欄、一列或一塊,貼上更新現有的列:先說明貼上的每一欄會對到表格的哪一欄、前幾格從什麼換成什麼、
 * 哪些格子不會動,按「更新」才寫入。起點(從哪一欄、哪一列開始)可以在這裡改——貼的是單欄資料(例如 41 列的數量),
 * 選「數量」欄、從第一列開始就好;貼上的第 1、2、3… 欄依序對到起點右邊的欄位。
 * 只貼一個值、框選了好幾格:框選的每一格都填同一個值(起點不能改)。
 */
export function BomCellPasteDialog({
  open,
  onOpenChange,
  boardId,
  product,
  phaseId,
  text,
  initial,
  rowOrder,
  colOrder,
  rowNames,
  columns,
  onSwitchToNewRows,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  boardId: string;
  product: string;
  phaseId: string;
  text: string;
  /** 一開始的框選(或游標所在的那一格);沒有就是從別的視窗切過來的,由使用者自己選起點。 */
  initial: CellSelection | null;
  /** 畫面上看得到的已存的列與資料欄的順序。 */
  rowOrder: string[];
  colOrder: string[];
  rowNames: Map<string, string>;
  columns: BomColumnDef[];
  /** 改成「貼成新的列」(打開原本的視窗)。 */
  onSwitchToNewRows: (text: string) => void;
  /** 寫入成功之後:重讀這份 BOM、取消框選。 */
  onApplied: () => Promise<void>;
}) {
  const { notify } = useDialogs();
  const [startRow, setStartRow] = useState("");
  const [startCol, setStartCol] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState<{ key: string; result: CellPastePreview | { error: string } } | null>(null);

  // 打開時重來。
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStartRow(initial?.rowIds[0] ?? rowOrder[0] ?? "");
      setStartCol(initial?.colKeys[0] ?? "");
      setError(null);
      setLoaded(null);
    }
  }

  const grid = parseClipboardTable(text);
  const single = grid.length === 1 && grid[0]?.length === 1;
  const fill = single && initial !== null && initial.rowIds.length * initial.colKeys.length > 1;
  const selection: CellSelection | null = fill ? initial : startRow && startCol ? { rowIds: [startRow], colKeys: [startCol] } : null;
  const key = open && selection ? JSON.stringify([selection, text]) : null;

  useEffect(() => {
    if (!key || !selection) return;
    let cancelled = false;
    (async () => {
      let result: CellPastePreview | { error: string };
      try {
        result = await previewBomCellPaste(boardId, product, phaseId, { rowOrder, colOrder, selection, text });
      } catch (e) {
        result = { error: actionErrorMessage(e, "預覽失敗") };
      }
      if (!cancelled) setLoaded({ key, result });
    })();
    return () => {
      cancelled = true;
    };
    // selection / rowOrder / colOrder 都包含在 key 或隨 open 重來,只在 key 變了才重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, product, phaseId, key]);

  const shown = key && loaded && loaded.key === key ? loaded.result : null;
  const preview = shown && !("error" in shown) ? shown : null;
  const loading = key !== null && shown === null;

  async function apply() {
    if (!selection || busy) return;
    setBusy(true);
    setError(null);
    try {
      const req: CellPasteRequest = { rowOrder, colOrder, selection, text };
      const result = await applyBomCellPaste(boardId, product, phaseId, req);
      if (result.error) {
        setError(result.error);
        return;
      }
      await onApplied();
      onOpenChange(false);
      const problems = result.problems ?? [];
      if (problems.length > 0) {
        setTimeout(
          () =>
            void notify([`已更新 ${result.applied ?? 0} 格(${result.rows ?? 0} 列)。`, "", `有 ${problems.length} 格沒有貼成:`, ...problems.slice(0, 10).map((p) => `• ${p}`)].join("\n"), {
              title: "貼上完成,但有些沒成功",
            }),
          250
        );
      }
    } catch (e) {
      setError(actionErrorMessage(e, "貼上失敗"));
    } finally {
      setBusy(false);
    }
  }

  const colLabel = (k: string) => labelOfKey(k, columns);

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="貼上更新現有的列" size="xl">
      <div data-bom-cell-paste className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          貼上的內容是 <b>{grid.length}</b> 列 × <b>{Math.max(0, ...grid.map((r) => r.length))}</b> 欄。這是<b>更新已經存在的格子</b>,不會新增列;貼得比表格長的部分不貼。
          {" "}要貼成新的列,按左下角的「改貼成新的列」。
        </p>

        {fill ? (
          <p data-bom-cell-paste-fill className="rounded-md bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            只貼了一個值「{grid[0][0]}」,會填進框選的 {initial!.rowIds.length * initial!.colKeys.length} 格。
          </p>
        ) : (
          <div className="flex gap-2">
            <label className="block flex-1 text-xs text-neutral-500 dark:text-neutral-400">
              從哪一欄開始(貼上的第 1 欄放這裡)
              <select data-bom-cell-paste-col value={startCol} onChange={(e) => setStartCol(e.target.value)} className={`${selectClass} mt-1`}>
                <option value="">請選要貼進哪一欄…</option>
                {colOrder.map((k) => (
                  <option key={k} value={k}>
                    {colLabel(k)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block flex-1 text-xs text-neutral-500 dark:text-neutral-400">
              從哪一列開始(貼上的第 1 列放這裡)
              <select data-bom-cell-paste-row value={startRow} onChange={(e) => setStartRow(e.target.value)} className={`${selectClass} mt-1`}>
                {rowOrder.map((id, i) => (
                  <option key={id} value={id}>
                    {i + 1}. {rowNames.get(id) ?? id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!selection && <p className="text-xs text-amber-700 dark:text-amber-400">先選要貼進哪一欄。</p>}
        {loading && <p className="text-xs text-neutral-400 dark:text-neutral-500">讀取預覽...</p>}
        {shown && "error" in shown && (
          <p data-bom-cell-paste-error className="whitespace-pre-line rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            {shown.error}
          </p>
        )}

        {preview && (
          <>
            {!fill && (
              <p data-bom-cell-paste-mapping className="text-xs text-neutral-600 dark:text-neutral-300">
                貼上的欄對應到:{preview.mapping.map((m, i) => `第 ${i + 1} 欄 → ${m}`).join(";")}
              </p>
            )}
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              會更新 <b data-bom-cell-paste-count>{preview.applicable}</b> 格(<b>{preview.rows}</b> 列)。
            </p>
            {preview.samples.length > 0 && (
              <div className="max-h-52 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">列</th>
                      <th className="px-2 py-1 text-left font-medium">欄</th>
                      <th className="px-2 py-1 text-left font-medium">舊值 → 新值</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {preview.samples.map((s, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1">{s.rowName}</td>
                        <td className="px-2 py-1 text-neutral-600 dark:text-neutral-300">{s.colLabel}</td>
                        <td className="px-2 py-1">
                          <span className="text-neutral-400 line-through dark:text-neutral-500">{s.before || "(空白)"}</span> → <b>{s.after || "(清空)"}</b>
                        </td>
                      </tr>
                    ))}
                    {preview.applicable > preview.samples.length && (
                      <tr>
                        <td colSpan={3} className="px-2 py-1 text-center text-neutral-400 dark:text-neutral-500">
                          ……還有 {preview.applicable - preview.samples.length} 格
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {preview.notes.length > 0 && (
              <ul className="space-y-0.5 rounded-md bg-neutral-50 p-2 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {preview.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            )}
            {preview.problems.length > 0 && (
              <ul data-bom-cell-paste-problems className="max-h-28 space-y-0.5 overflow-auto rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <li className="font-medium">有 {preview.problems.length} 格轉不過去或不能貼,那些格子不會動:</li>
                {preview.problems.slice(0, 12).map((p, i) => (
                  <li key={i}>• {p}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {error && <p className="whitespace-pre-line text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            data-bom-cell-paste-switch
            onClick={() => {
              onOpenChange(false);
              onSwitchToNewRows(text);
            }}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            改貼成新的列
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              data-bom-cell-paste-apply
              onClick={() => void apply()}
              disabled={busy || !preview || preview.applicable === 0}
              className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? "更新中..." : preview ? `更新 ${preview.applicable} 格` : "更新"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
