"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { previewIssueImport, runIssueImport, type IssueImportPreview, type IssueImportResult } from "@/lib/actions/issueImport";
import { issueOptionKindLabel } from "@/lib/issueOptions";
import { actionErrorMessage } from "@/lib/userError";
import { buttonClass, primaryButtonClass } from "./issueUi";

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * 從 Excel 匯入歷史案件(原 Sheet 的 2024 / 2025 / 2026CSTable 匯出的 .xlsx;用標題對欄位,三種版面都吃)。
 * 先預覽(不寫入),看過再按「確認匯入」。已經在系統裡的案件編號會略過,重複匯入不會產生重複案件。
 */
export function IssueImportPanel() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<IssueImportPreview | null>(null);
  const [result, setResult] = useState<IssueImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    setPreview(null);
    try {
      const b64 = toBase64(await file.arrayBuffer());
      setData(b64);
      setFileName(file.name);
      setPreview(await previewIssueImport(b64));
    } catch (err) {
      setData(null);
      setError(actionErrorMessage(err, "讀取失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await runIssueImport(data));
      setPreview(null);
      setData(null);
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "匯入失敗"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3" data-testid="import-panel">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        支援從原 Google Sheet 匯出的 .xlsx(2024CSTable、2025CSTable、2026CSTable 都可以,一個檔案裡有幾個案件分頁都會讀)。找不到的客戶、產品、問題類型、零件等選項會自動新增;
        Case No 沿用檔案裡的(已經存在的略過),沒有的重新產生。
      </p>
      <input ref={fileRef} type="file" accept=".xlsx" className="hidden" data-testid="import-file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={buttonClass}>
        <Upload size={14} /> {busy ? "處理中..." : "選擇 Excel 檔"}
      </button>
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

      {preview && (
        <div className="space-y-2 rounded-md border border-neutral-200 bg-white p-3 text-sm dark:border-neutral-700 dark:bg-neutral-900" data-testid="import-preview">
          <div className="font-medium">{fileName}</div>
          <ul className="text-xs text-neutral-600 dark:text-neutral-300">
            {preview.sheets.map((s) => (
              <li key={s.sheet}>
                {s.sheet}:{s.recognized ? `${s.rows} 筆可匯入${s.errors ? `、${s.errors} 列有問題` : ""}` : "不是案件表,略過"}
              </li>
            ))}
          </ul>
          <div>
            共 {preview.total} 筆,其中 <b>{preview.importable}</b> 筆會匯入{preview.duplicates > 0 && `(${preview.duplicates} 筆案件編號已存在,略過)`}。
          </div>
          {preview.newOptions.length > 0 && (
            <div className="text-xs text-neutral-600 dark:text-neutral-300">
              會自動新增的選項:{preview.newOptions.map((o) => `${issueOptionKindLabel(o.kind)} ${o.names.length} 個`).join("、")}
            </div>
          )}
          {preview.errors.length > 0 && (
            <ul className="max-h-32 overflow-auto rounded bg-red-50 px-3 py-2 text-xs text-red-700">
              {preview.errors.map((e, i) => <li key={i}>{e.where}:{e.message}</li>)}
            </ul>
          )}
          <button type="button" onClick={run} disabled={busy || preview.importable === 0} className={primaryButtonClass} data-testid="import-run">確認匯入 {preview.importable} 筆</button>
        </div>
      )}

      {result && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200" data-testid="import-result">
          匯入完成:{result.imported} 筆案件、新增 {result.createdOptions} 個選項{result.skipped > 0 && `、略過 ${result.skipped} 筆重複`}{result.errors.length > 0 && `、${result.errors.length} 列有問題沒有匯入`}。
        </div>
      )}
    </div>
  );
}
