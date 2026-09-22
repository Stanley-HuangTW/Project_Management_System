"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import {
  listCsvBoards,
  exportBoardCsv,
  importBoardCsv,
  type CsvBoardOption,
  type CsvImportResult,
} from "@/lib/actions/boardCsv";

function downloadCsv(filename: string, content: string) {
  // 開頭補 UTF-8 BOM——Excel 開純文字 CSV 沒看到 BOM 常常會把中文猜成別的
  // 編碼,變成亂碼。大部分工具(包含這支程式自己的匯入)看到 BOM 都會正確
  // 略過,不影響內容。
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** 讀檔案文字,去掉開頭可能有的 BOM——保留的話那三個位元組會混進第一個
 *  欄位名稱,讓 "#boardId:" 的比對失敗。 */
async function readCsvFile(file: File): Promise<string> {
  const text = await file.text();
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 每個看板一個 CSV 的備份/還原。
 *
 * 匯出永遠開放(看得到看板就能備份它);匯入只有管理者能做——一次可能
 * 改動一整個看板幾百個工作項,權限比照既有的匯入精靈。
 */
export function DataExportView({ canImport }: { canImport: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [boards, setBoards] = useState<CsvBoardOption[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<CsvImportResult[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await listCsvBoards();
      if (!cancelled) setBoards(list);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function exportOne(board: CsvBoardOption) {
    setBusy(board.id);
    setError(null);
    try {
      const out = await exportBoardCsv(board.id);
      if ("error" in out) setError(`${board.name}:${out.error}`);
      else downloadCsv(out.filename, out.content);
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(null);
    }
  }

  async function exportAll() {
    if (!boards) return;
    setBusy("__all__");
    setError(null);
    try {
      // 依序一個個匯出——同時觸發很多個下載,瀏覽器常常會擋掉後面幾個。
      for (const board of boards) {
        const out = await exportBoardCsv(board.id);
        if ("error" in out) setError((prev) => (prev ? `${prev}；` : "") + `${board.name}:${out.error}`);
        else downloadCsv(out.filename, out.content);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(null);
    }
  }

  async function importFiles(files: File[]) {
    setBusy("__import__");
    setError(null);
    setResults([]);
    try {
      const next: CsvImportResult[] = [];
      for (const file of files) {
        const text = await readCsvFile(file);
        const result = await importBoardCsv(text);
        next.push(result.boardName ? result : { ...result, boardName: file.name });
      }
      setResults(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "匯入失敗");
    } finally {
      setBusy(null);
    }
  }

  const button =
    "flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";

  if (!boards) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportAll} disabled={busy !== null} className={button}>
          <Download size={13} /> {busy === "__all__" ? "匯出中..." : `全部匯出(${boards.length} 個看板)`}
        </button>
        {canImport && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy !== null}
              className={button}
            >
              <Upload size={13} /> {busy === "__import__" ? "匯入中..." : "匯入 CSV(可一次選多個檔案)"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              multiple
              className="hidden"
              onChange={(e) => {
                // e.target.files 是活的 FileList,綁在這顆 input 上——清空
                // value 讓同一批檔案能重選一次,會連帶把這裡抓到的參照也
                // 清空。先轉成一般陣列,拿到的就是獨立的 File 物件,不會
                // 被後面的清空動作波及。
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length > 0) importFiles(files);
              }}
            />
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
              用 Excel 編輯完存檔,請選「CSV UTF-8(逗號分隔)」——存成一般的「CSV(逗號分隔)」,
              Excel 會用系統內碼存檔,中文字匯入時會變亂碼。
            </span>
          </>
        )}
        {!canImport && (
          <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
            匯入需要管理者權限。
          </span>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          {results.map((r, i) => (
            <div
              key={i}
              className={`space-y-1 rounded-md border p-2 text-xs ${
                r.error
                  ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
                  : "border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200"
              }`}
            >
              <p className="font-medium">{r.boardName || "(未知檔案)"}</p>
              {r.error ? (
                <p>{r.error}</p>
              ) : (
                <>
                  <p>
                    新增 {r.created} 個工作項、更新 {r.updated} 個。
                  </p>
                  {r.untouched.length > 0 && (
                    <p>CSV 裡沒有提到的工作項({r.untouched.length} 個)維持原樣,沒有刪除。</p>
                  )}
                </>
              )}
              {r.warnings.map((w, wi) => (
                <p key={wi} className="text-amber-800 dark:text-amber-300">
                  {w}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700">
        <table className="w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
            <tr>
              <th className="px-3 py-2 text-left font-medium">看板</th>
              <th className="px-3 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {boards.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-3 py-8 text-center text-neutral-400 dark:text-neutral-500">
                  沒有看得到的看板。
                </td>
              </tr>
            ) : (
              boards.map((board) => (
                <tr key={board.id}>
                  <td className="px-3 py-1.5 text-neutral-800 dark:text-neutral-100">{board.name}</td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => exportOne(board)}
                      className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
                    >
                      {busy === board.id ? "匯出中..." : "匯出 CSV"}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
