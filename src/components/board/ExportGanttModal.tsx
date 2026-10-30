"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { exportGanttWorkbook } from "@/lib/actions/export";
import { getExtraExportColumns } from "@/lib/export/exportFields";
import type { BoardWithData } from "@/types/board";
import { actionErrorMessage } from "@/lib/userError";

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

export function ExportGanttModal({
  board,
  open,
  onOpenChange,
}: {
  board: BoardWithData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = board.groups;
  const extraColumns = getExtraExportColumns(board);

  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [extraColumnIds, setExtraColumnIds] = useState<Set<string>>(
    () => new Set(extraColumns.map((c) => c.id))
  );
  const [maxLevel, setMaxLevel] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function toggleExtraColumn(columnId: string) {
    setExtraColumnIds((prev) => {
      const next = new Set(prev);
      if (next.has(columnId)) next.delete(columnId);
      else next.add(columnId);
      return next;
    });
  }

  async function handleExport() {
    if (!groupId) return;
    setSubmitting(true);
    setError(null);
    try {
      const { xlsxFilename, xlsxBase64, gsFilename, gsContent } = await exportGanttWorkbook(
        board.id,
        groupId,
        { extraColumnIds: [...extraColumnIds], maxLevel }
      );
      downloadBlob(
        xlsxFilename,
        new Blob([base64ToBytes(xlsxBase64)], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      downloadBlob(gsFilename, new Blob([gsContent], { type: "text/plain" }));
      setDone(true);
    } catch (err) {
      setError(actionErrorMessage(err, "匯出失敗"));
    } finally {
      setSubmitting(false);
    }
  }

  function reset(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setDone(false);
      setError(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={reset} title="匯出 Google Sheet(Gantt)">
      {error && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      {!done ? (
        <div className="space-y-3">
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            會下載兩個檔案:一個完整的 .xlsx(Settings/Lists/Holidays/Gantt Day·
            Week·Month/預算/燃盡圖/延遲追因 九個分頁,含甘特條、要徑標記、
            相依連線、階層顏色、日期約束與下拉選單,Start/Days/Finish 公式會
            自動避開 Holidays 分頁列出的國定假日),以及一份 Apps
            Script(.gs)範本。上傳 .xlsx 到 Google 雲端硬碟並以「Google
            試算表」開啟,即可直接使用;第一次使用需在該試算表的「擴充功能 →
            Apps Script」貼上下載的 .gs 內容並儲存,之後重新整理頁面即可看到
            「Gantt」選單(甘特條/階層顏色/彙總%/產生燃盡圖等)。
          </p>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              分組
            </label>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
              匯出深度
            </label>
            <select
              value={maxLevel ?? ""}
              onChange={(e) => setMaxLevel(e.target.value === "" ? null : Number(e.target.value))}
              className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
            >
              <option value="">全部層級</option>
              {[1, 2, 3, 4, 5, 6].map((lvl) => (
                <option key={lvl} value={lvl}>
                  只到 Lvl {lvl}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
              超過此深度的工作項不會匯出;保留下來的 Summary 列仍會顯示完整
              Start/Finish(依實際底下明細計算)。
            </p>
          </div>

          {extraColumns.length > 0 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-500 dark:text-neutral-400">
                額外欄位(看板自訂欄位,勾選才會匯出;人員欄位會寫入姓名)
              </label>
              <div className="max-h-40 space-y-1 overflow-auto rounded-md border border-neutral-200 dark:border-neutral-700 p-2">
                {extraColumns.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={extraColumnIds.has(c.id)}
                      onChange={() => toggleExtraColumn(c.id)}
                    />
                    <span className="text-neutral-700 dark:text-neutral-200">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={submitting || !groupId}
            onClick={handleExport}
            className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "匯出中..." : "匯出"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-neutral-700 dark:text-neutral-100">
            已下載 .xlsx 與 .gs 兩個檔案。
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-sm text-neutral-500 dark:text-neutral-400">
            <li>將 .xlsx 上傳到 Google 雲端硬碟,以「Google 試算表」開啟</li>
            <li>擴充功能 → Apps Script,貼上 .gs 檔內容並儲存</li>
            <li>重新整理試算表頁面,即可使用「Gantt」選單的所有功能</li>
          </ol>
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            此功能無法直接產生雲端上的 Google 試算表檔案(.gsheet
            只是雲端硬碟裡的捷徑,需要 Google API 授權才能建立),因此仍需要這
            一次性的上傳與貼上腳本步驟。
          </p>
          <button
            type="button"
            onClick={() => reset(false)}
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            關閉
          </button>
        </div>
      )}
    </Modal>
  );
}
