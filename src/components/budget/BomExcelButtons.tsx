"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  exportBomWorkbook,
  importBomWorkbook,
  type BomImportResult,
} from "@/lib/actions/bomExcel";
import { actionErrorMessage } from "@/lib/userError";

/**
 * 樣機 BOM 的 Excel 進出口。
 *
 * 匯入是整個(產品,階段)區塊換掉,不是逐列比對——樹的形狀變了沒辦法逐列
 * 對應。Excel 裡沒提到的(產品,階段)維持原樣,不會被刪除。
 */
export function BomExcelButtons({
  boardId,
  canEdit,
  onImported,
}: {
  boardId: string;
  canEdit: boolean;
  /** 匯入成功後讓 BOM 重讀——連產品/階段的候選清單都可能變了。 */
  onImported: () => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BomImportResult | null>(null);

  async function download() {
    setBusy("export");
    setError(null);
    setResult(null);
    try {
      const out = await exportBomWorkbook(boardId);
      if ("error" in out) return setError(out.error);

      const bytes = Uint8Array.from(atob(out.base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = out.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(actionErrorMessage(e, "匯出失敗"));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("import");
    setError(null);
    setResult(null);
    try {
      const buffer = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const out = await importBomWorkbook(boardId, btoa(binary));
      if (out.error) setError(out.error);
      else {
        setResult(out);
        await onImported();
      }
    } catch (e) {
      setError(actionErrorMessage(e, "匯入失敗"));
    } finally {
      setBusy(null);
    }
  }

  const button =
    "flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={download} disabled={busy !== null} className={button}>
          <Download size={13} /> {busy === "export" ? "匯出中..." : "匯出 Excel"}
        </button>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className={button}
            >
              <Upload size={13} /> {busy === "import" ? "匯入中..." : "匯入 Excel"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) upload(file);
              }}
            />
          </>
        )}
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          帶公式(子集單價、小計自動算)。匯入時 Excel 裡提到的每個產品/階段區塊整個換掉,沒提到的維持原樣。
        </span>
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {result && (
        <div className="space-y-1 rounded-md border border-green-300 bg-green-50 p-2 text-xs text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <p>
            匯入完成:{result.blocksWritten} 個產品/階段區塊、{result.linesWritten} 列。
          </p>
          {result.untouched.length > 0 && (
            <p>Excel 裡沒有提到的區塊({result.untouched.join("、")})維持原樣,沒有刪除。</p>
          )}
          {result.warnings.map((w, i) => (
            <p key={i} className="text-amber-800 dark:text-amber-300">
              {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
