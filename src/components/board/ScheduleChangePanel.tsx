"use client";

import type { SchedulePreview } from "@/lib/predecessorLink";
import { withWeekday } from "@/lib/weekdayLabel";

/**
 * 改天數(duration)時,貼在那一欄正下方的小面板:Start day / Finish day 原來是哪天、改完會是哪天(都帶星期幾),
 * 底下是「確認套用 / 取消」。跟輸入框同一欄,移開(取消或確認)就消失,不佔別的地方。
 */
export function ScheduleChangePanel({
  currentStart,
  currentEnd,
  preview,
  loading,
  error,
  onConfirm,
  onCancel,
}: {
  currentStart: string | null;
  currentEnd: string | null;
  /** null = 還沒算出來(loading)、或算不出來。 */
  preview: SchedulePreview | null;
  loading: boolean;
  /** 存檔被伺服器擋下時的原因。 */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const show = (iso: string | null) => (iso ? withWeekday(iso) : "未設定");
  const row = (label: string, before: string | null, after: string | null | undefined) => {
    const changed = after !== undefined && after !== null && after !== before;
    return (
      <>
        <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
        <span className="tabular-nums text-neutral-600 dark:text-neutral-300">{show(before)}</span>
        <span
          className={`tabular-nums ${changed ? "font-medium text-blue-700 dark:text-blue-300" : "text-neutral-600 dark:text-neutral-300"}`}
        >
          {preview ? (after ? show(after) : "—") : loading ? "計算中…" : "—"}
        </span>
      </>
    );
  };
  return (
    // 按面板裡的按鈕時輸入框不要先失焦(失焦等於取消);Safari 點按鈕不會把焦點給按鈕,所以不能靠 relatedTarget。
    <div
      data-schedule-preview
      onMouseDown={(e) => e.preventDefault()}
      className="mt-1.5 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-neutral-700 dark:border-blue-800 dark:bg-blue-950 dark:text-neutral-200"
    >
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-1">
        <span />
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">原來</span>
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">更改後</span>
        {row("Start day", currentStart, preview?.start)}
        {row("Finish day", currentEnd, preview?.end)}
      </div>
      {!loading && !preview && (
        <p className="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">算不出更改後的日期(缺開始日或前置任務的日期),仍可以套用這個天數。</p>
      )}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-neutral-400 dark:text-neutral-500">按 Enter 或「確認套用」才會儲存;離開這一欄會取消。</span>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            data-schedule-cancel
            onClick={onCancel}
            className="rounded px-2 py-1 text-neutral-600 hover:bg-white dark:text-neutral-300 dark:hover:bg-neutral-900"
          >
            取消
          </button>
          <button
            type="button"
            data-schedule-confirm
            onClick={onConfirm}
            className="rounded bg-blue-600 px-2 py-1 font-medium text-white hover:bg-blue-700"
          >
            確認套用
          </button>
        </div>
      </div>
    </div>
  );
}
