"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { MAX_FTE } from "@/lib/labourSheet";

/**
 * 一整段月份填同一個投入值。
 *
 * 原本是連續三個文字提示,而且月份要自己照 "2026-03" 的格式打出來 ——
 * 填一列就得手打兩次月份,打錯了要整個重來。這裡月份用選的,選項就是表上
 * 真的有的那幾個月,選不出不存在的月份。
 */
export function FillRangeDialog({
  open,
  onOpenChange,
  slotLabel,
  months,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slotLabel: string;
  /** 表上實際有的月份,"YYYY-MM"。 */
  months: string[];
  onSubmit: (fromMonth: string, toMonth: string, fte: number) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [fte, setFte] = useState("1");
  const [error, setError] = useState<string | null>(null);

  // 在 render 當下對齊,不放進 effect —— effect 版本會先用上一次的值畫一次。
  const key = open ? slotLabel : null;
  const [prevKey, setPrevKey] = useState<string | null>(null);
  if (key !== prevKey) {
    setPrevKey(key);
    setFrom(months[0] ?? "");
    setTo(months[months.length - 1] ?? "");
    setFte("1");
    setError(null);
  }

  function submit() {
    if (!from || !to) return setError("起訖月份都要選");
    if (to < from) return setError("結束月份不可早於開始月份");
    const value = Number(fte);
    if (!Number.isFinite(value) || value < 0) return setError("投入必須是 0 或正數");
    if (value > MAX_FTE) {
      return setError(`一個名額一個月最多 ${MAX_FTE}(全職)。需要兩個人請開兩個名額。`);
    }
    onSubmit(from, to, value);
    onOpenChange(false);
  }

  const field =
    "w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900";

  const count = from && to && to >= from ? months.filter((m) => m >= from && m <= to).length : 0;

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`${slotLabel} — 整段填入`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">從</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">到</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} className={field}>
              {months.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">
            每個月投入(1 = 整個月全職,0 = 清空)
          </span>
          <input
            value={fte}
            onChange={(e) => setFte(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            inputMode="decimal"
            className={field}
          />
        </label>

        <div className="flex flex-wrap gap-1.5">
          {["1", "0.5", "0.25", "0"].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setFte(preset)}
              className={`rounded-md border px-2 py-0.5 text-xs ${
                fte === preset
                  ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                  : "border-neutral-300 text-neutral-600 dark:border-neutral-600 dark:text-neutral-300"
              }`}
            >
              {preset === "0" ? "清空" : preset}
            </button>
          ))}
        </div>

        {count > 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">會蓋掉 {count} 個月的現有值。</p>
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
            填入
          </button>
        </div>
      </div>
    </Modal>
  );
}
