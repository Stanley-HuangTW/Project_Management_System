"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { formatMoney } from "@/lib/cost";
import { parseBomPaste } from "@/lib/bomPaste";
import type { BomColumnDef } from "@/lib/bomColumns";

const PREVIEW_ROWS = 10;

/**
 * 從 Excel / Google 試算表貼上整張 BOM:把整張表複製、貼進這裡(或在 BOM 表格上直接按 Ctrl+V),
 * 先預覽會貼進哪幾列、哪幾列有問題,按「貼上」才寫入——接在這個產品、這個階段現有的列後面。
 */
export function BomPasteDialog({
  open,
  onOpenChange,
  initialText,
  product,
  phaseName,
  columns,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 在表格上按 Ctrl+V 進來的,文字先帶好。 */
  initialText: string;
  product: string;
  phaseName: string;
  /** 這個看板的 BOM 欄位設定:內建欄位的新名字、自訂欄位的名字,貼上的表頭寫那個名稱就對得上。 */
  columns: BomColumnDef[];
  /** 回傳錯誤說明就留在視窗;null = 成功,視窗關掉。 */
  onApply: (rows: ReturnType<typeof parseBomPaste>["rows"]) => Promise<string | null>;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const key = open ? initialText : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setText(initialText);
    setError(null);
  }

  const parsed = useMemo(() => (text.trim() === "" ? null : parseBomPaste(text, columns)), [text, columns]);

  async function apply() {
    if (!parsed || parsed.error || parsed.rows.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const message = await onApply(parsed.rows);
      if (message) setError(message);
      else onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="從 Excel 貼上 BOM" size="xl">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          貼到「<b>{product || "(先選產品)"}</b> / <b>{phaseName}</b>」,接在現有的列後面。欄位順序:<b>名稱、廠商、型號/料號、數量、單價、幣別、匯率、交期、備註</b>
          (有表頭的話照表頭的字找,順序不拘;表頭多一欄「階層」可以排出上下層;沒有表頭時,名稱前面縮排兩個空白就是子項目)。
          空白的欄位用預設:數量 1、單價 0、幣別 TWD。
          {columns.some((c) => !(["vendor", "partNumber", "delivery", "note", "money"] as string[]).includes(c.id)) && (
            <>
              {" "}
              這個看板的<b>自訂欄位</b>({columns.filter((c) => c.id.startsWith("c_")).map((c) => c.name).join("、")})也讀得到:表頭寫欄位名稱就對得上;表頭裡沒有的自訂欄位,新增的列帶它的預設值。
            </>
          )}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="在 Excel 選好範圍按 Ctrl+C,回到這裡按 Ctrl+V"
          rows={6}
          autoFocus
          className="w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
        />

        {parsed?.error && <p className="text-xs text-red-600 dark:text-red-400">{parsed.error}</p>}

        {parsed && !parsed.error && (
          <>
            <p className="text-xs text-neutral-600 dark:text-neutral-300">
              讀到 <b>{parsed.rows.length}</b> 列{parsed.hadHeader ? "(第一列當表頭)" : ""}
              {parsed.warnings.length > 0 && <span className="text-amber-700 dark:text-amber-400">,{parsed.warnings.length} 列有問題會略過</span>}
              。{parsed.customColumnNames.length > 0 && <span data-paste-custom-columns>也讀到自訂欄位:{parsed.customColumnNames.join("、")}。</span>}
            </p>
            {parsed.rows.length > 0 && (
              <div className="max-h-56 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                <table className="w-full text-xs">
                  <thead className="bg-neutral-50 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    <tr>
                      <th className="px-2 py-1 text-left font-medium">名稱</th>
                      <th className="px-2 py-1 text-left font-medium">廠商</th>
                      <th className="px-2 py-1 text-left font-medium">型號/料號</th>
                      <th className="px-2 py-1 text-right font-medium">數量</th>
                      <th className="px-2 py-1 text-right font-medium">單價</th>
                      <th className="px-2 py-1 text-center font-medium">幣別</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {parsed.rows.slice(0, PREVIEW_ROWS).map((r) => (
                      <tr key={r.sourceRow}>
                        <td className="px-2 py-1" style={{ paddingLeft: 8 + r.depth * 16 }}>
                          {r.name}
                        </td>
                        <td className="px-2 py-1 text-neutral-600 dark:text-neutral-300">{r.vendor}</td>
                        <td className="px-2 py-1 text-neutral-600 dark:text-neutral-300">{r.partNumber}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.qty}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{formatMoney(r.unitPrice)}</td>
                        <td className="px-2 py-1 text-center">{r.currency}</td>
                      </tr>
                    ))}
                    {parsed.rows.length > PREVIEW_ROWS && (
                      <tr>
                        <td colSpan={6} className="px-2 py-1 text-center text-neutral-400 dark:text-neutral-500">
                          ……還有 {parsed.rows.length - PREVIEW_ROWS} 列
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {parsed.warnings.length > 0 && (
              <ul className="max-h-28 space-y-0.5 overflow-auto rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {parsed.warnings.slice(0, 20).map((w, i) => (
                  <li key={i}>• {w}</li>
                ))}
                {parsed.warnings.length > 20 && <li>……還有 {parsed.warnings.length - 20} 則</li>}
              </ul>
            )}
          </>
        )}

        {error && <p className="whitespace-pre-line text-xs text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={busy || !parsed || !!parsed.error || parsed.rows.length === 0}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "貼上中..." : parsed && parsed.rows.length > 0 ? `貼上 ${parsed.rows.length} 列` : "貼上"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
