"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  exportLabourWorkbook,
  importLabourWorkbook,
  type LabourImportResult,
} from "@/lib/actions/labourExcel";

/**
 * 人力表的 Excel 進出口。
 *
 * 談人力的會議還是開著 Excel 在談 —— 匯出去讓人在熟悉的地方改,改完收回來。
 * 匯入只新增與更新,不刪:Excel 裡少一列的理由太多了,而刪掉一個名額會連
 * 它十幾個月的投入一起帶走。少掉的名額會在結果裡列出來,要刪在程式裡刪。
 */
export function LabourExcelButtons({
  boardId,
  canEdit,
  onImported,
}: {
  boardId: string;
  canEdit: boolean;
  /** 匯入成功後讓人力表重讀 —— 整張表都換了。 */
  onImported: () => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LabourImportResult | null>(null);

  async function download() {
    setBusy("export");
    setError(null);
    setResult(null);
    try {
      const out = await exportLabourWorkbook(boardId);
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
      setError(e instanceof Error ? e.message : "匯出失敗");
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
      // 一次 String.fromCharCode(...整個檔案) 在幾 MB 的檔案上會爆掉引數上限,
      // 所以分段。
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const out = await importLabourWorkbook(boardId, btoa(binary));
      if (out.error) setError(out.error);
      else {
        setResult(out);
        // 重讀而不是整頁重新整理 —— 重新整理會把剛剛那段「新增幾個、更新
        // 幾個、哪幾個沒動到」的結果一起沖掉,而那正是要給人看的東西。
        await onImported();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯入失敗");
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
                // 清掉,否則同一個檔案改完再選一次不會觸發 change。
                e.target.value = "";
                if (file) upload(file);
              }}
            />
          </>
        )}
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          匯出的檔案帶公式,在 Excel 改完直接匯回來。匯入只新增與更新,不會刪掉名額。
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
            匯入完成:新增 {result.created} 個名額、更新 {result.updated} 個。
          </p>
          {result.untouched.length > 0 && (
            <p>
              Excel 裡沒有提到的名額({result.untouched.join("、")})維持原樣,沒有刪除。
            </p>
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
