"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

export type RangeDraft = {
  /** 里程碑才有:分類,只是標示用。 */
  track?: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
};

/** 挑好的一組顏色:丟一個完整色票給人選,選得出看不見的顏色。 */
const COLORS = ["#fdab3d", "#00c875", "#579bfc", "#a25ddc", "#e2445c", "#787d80"];

/**
 * 階段與里程碑的期間設定。
 *
 * 一個畫面問完,而且日期用 date 輸入 —— 原本是連續兩個文字提示,要自己
 * 記得格式,而且填到第二個才發現第一個打錯就得整個重來。起訖日本來就是
 * 一起決定的,拆成兩步只是把一件事變成兩件。
 */
export function PhaseRangeDialog({
  open,
  onOpenChange,
  title,
  /** 有值 = 編輯既有的;沒有 = 新增。 */
  initial,
  /** 里程碑要多問一個分類。 */
  withTrack = false,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: RangeDraft;
  withTrack?: boolean;
  onSubmit: (draft: RangeDraft) => void;
}) {
  const [track, setTrack] = useState("");
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  // 每次打開都對齊當下的 initial —— 沿用上一次開啟留下的值會把別的階段的
  // 日期帶進來。在 render 當下調整而不是放進 effect:effect 版本會先用舊值
  // 畫一次再改,而且 react-hooks 的規則也擋。
  const key = open ? `${title}|${initial?.name ?? ""}|${initial?.startDate ?? ""}` : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setTrack(initial?.track ?? "里程碑");
    setName(initial?.name ?? "");
    setStartDate(initial?.startDate ?? "");
    setEndDate(initial?.endDate ?? "");
    setColor(initial?.color ?? COLORS[0]);
    setError(null);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError("名稱不可為空");
    if (!startDate || !endDate) return setError("起訖日期都要選");
    if (endDate < startDate) return setError("結束日不可早於開始日");
    onSubmit({
      ...(withTrack ? { track: track.trim() || "里程碑" } : {}),
      name: trimmed,
      startDate,
      endDate,
      color,
    });
    onOpenChange(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="space-y-3">
        {withTrack && (
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
              分類
            </span>
            <input
              value={track}
              onChange={(e) => setTrack(e.target.value)}
              placeholder="例如 軟體、機構、認證"
              className={field}
            />
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">名稱</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={withTrack ? "例如 PCBA 打件、機構出圖" : "例如 EFS、EVT、DVT1"}
            className={field}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">開始日</span>
            <input
              type="date"
              value={startDate}
              // 結束日已經選了就不給選到它後面,錯誤在按下去之前就避開。
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
              className={field}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">結束日</span>
            <input
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
              className={field}
            />
          </label>
        </div>

        <div>
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">顏色</span>
          <div className="flex gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                title={c}
                className={`h-6 w-6 rounded ${
                  color === c ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-neutral-900" : ""
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {startDate && endDate && endDate >= startDate && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            共 {Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1} 天
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            確定
          </button>
        </div>
      </div>
    </Modal>
  );
}
