"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  exportLabourWorkbook,
  importLabourWorkbook,
  type LabourImportResult,
} from "@/lib/actions/labourExcel";
import { actionErrorMessage } from "@/lib/userError";

/**
 * 人力表的 Excel 進出口。
 *
 * 談人力的會議還是開著 Excel 在談 —— 匯出去讓人在熟悉的地方改,改完收回來。
 * 匯入只新增與更新,不刪:Excel 裡少一列的理由太多了,而刪掉一個名額會連
 * 它十幾個月的投入一起帶走。少掉的名額會在結果裡列出來,要刪在程式裡刪。
 *
 * 匯出一次拿兩個檔案:.xlsx 本身傳到 Google 雲端硬碟、用「Google 試算表」
 * 開就能用(公式、跨表參照兩邊都懂),另一份 .gs 是選用的補丁 —— 轉檔補回
 * Excel 那條「投入上限 0~1」的資料驗證,在名額區塊插新列時 Google 試算表
 * 不會自動幫新列繼承這條規則。跟甘特圖匯出同一套做法。
 */
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function base64ToBytes(base64: string): ArrayBuffer {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return bytes.buffer;
}

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
  const [exported, setExported] = useState(false);

  async function download() {
    setBusy("export");
    setError(null);
    setResult(null);
    setExported(false);
    try {
      const out = await exportLabourWorkbook(boardId);
      if ("error" in out) return setError(out.error);

      downloadBlob(
        out.xlsxFilename,
        new Blob([base64ToBytes(out.xlsxBase64)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      downloadBlob(out.gsFilename, new Blob([out.gsContent], { type: "text/plain" }));
      setExported(true);
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
                // 清掉,否則同一個檔案改完再選一次不會觸發 change。
                e.target.value = "";
                if (file) upload(file);
              }}
            />
          </>
        )}
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
          匯出的檔案帶公式與各階段的里程碑資訊,在 Excel 改完直接匯回來。匯入只新增與更新,不會刪掉名額。
        </span>
      </div>

      {exported && (
        <div className="space-y-1 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          <p>已下載 .xlsx 與 .gs 兩個檔案。.xlsx 可以直接在 Excel 開,也可以轉成 Google 試算表:</p>
          <ol className="list-decimal space-y-0.5 pl-4">
            <li>將 .xlsx 上傳到 Google 雲端硬碟,以「Google 試算表」開啟即可直接使用</li>
            <li>
              (選用)插入新的名額列想繼續套用投入上限,擴充功能 → Apps Script,貼上 .gs
              檔內容並儲存,重新整理後在選單按「人力表 → 重新套用投入上限驗證」
            </li>
          </ol>
        </div>
      )}

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
