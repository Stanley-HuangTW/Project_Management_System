"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";

export type RangeDraft = {
  /** 里程碑才有:排在哪一排。 */
  typeId?: string;
  name: string;
  startDate: string;
  endDate: string;
  color: string;
};

export type MilestoneTypeOption = { id: string; name: string };

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
  /** 里程碑要多選一個類型;給了清單就是里程碑。 */
  types,
  onManageTypes,
  /** 編輯既有的才給 —— 刪除鍵跟著出現在同一個畫面上。 */
  onDelete,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: RangeDraft;
  types?: MilestoneTypeOption[];
  onManageTypes?: () => void;
  onDelete?: () => void;
  onSubmit: (draft: RangeDraft) => void;
}) {
  const [typeId, setTypeId] = useState("");
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
    setTypeId(initial?.typeId ?? types?.[0]?.id ?? "");
    setName(initial?.name ?? "");
    setStartDate(initial?.startDate ?? "");
    setEndDate(initial?.endDate ?? "");
    setColor(initial?.color ?? COLORS[0]);
    setError(null);
  }

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) return setError("名稱不可為空");
    if (types && !typeId) return setError("請先新增一個里程碑類型");
    if (!startDate || !endDate) return setError("起訖日期都要選");
    if (endDate < startDate) return setError("結束日不可早於開始日");
    onSubmit({
      ...(types ? { typeId } : {}),
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
        {types && (
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400">
              類型(同一個類型排在同一排)
              {onManageTypes && (
                <button
                  type="button"
                  onClick={onManageTypes}
                  className="rounded px-1 py-0.5 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/40"
                >
                  管理類型
                </button>
              )}
            </span>
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)} className={field}>
              {types.length === 0 && <option value="">(還沒有類型,請先新增)</option>}
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">名稱</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={types ? "例如 PCBA 打件、機構出圖" : "例如 EFS、EVT、DVT1"}
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

        <div className="flex items-center justify-between pt-1">
          {/* 刪除放在這裡,而不是只藏在表格右緣的小垃圾桶 —— 要刪的人是從
              這個畫面進來的。離「確定」有一段距離,不會順手按到。 */}
          {onDelete ? (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onDelete();
              }}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
            >
              刪除
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
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
      </div>
    </Modal>
  );
}
