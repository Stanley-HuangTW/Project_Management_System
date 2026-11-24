"use client";

import { useState } from "react";
import { describeDateChange } from "@/lib/dateChange";

/**
 * 日期輸入框上方的一行小字:上次設定的日期,以及調整之後差幾天。
 * saved 是存檔的值(打開時的)、current 是畫面上現在的值。
 */
export function DateChangeHint({
  saved,
  current,
  label,
  className = "",
}: {
  saved: string | null | undefined;
  current: string | null | undefined;
  /** 欄位名稱:提示不是緊貼在欄位上方時,用它說這是哪個日期。 */
  label?: string;
  className?: string;
}) {
  const change = describeDateChange(saved, current);
  if (!change) return null;
  return (
    <span data-date-change className={`mb-1 block text-[11px] text-neutral-500 dark:text-neutral-400 ${className}`}>
      {label ? `${label} ` : ""}上次設定:<span className="tabular-nums">{change.savedLabel}</span>
      {change.adjusted && (
        <>
          {" → "}
          <span className="tabular-nums">{change.adjusted.label}</span>
          {change.adjusted.delta && <span className="ml-1 font-medium text-amber-600 dark:text-amber-400">({change.adjusted.delta})</span>}
        </>
      )}
    </span>
  );
}

/**
 * 「上次設定」的值:這個欄位(key)第一次出現時存檔的值。欄位一改就存的地方(沒有「儲存」鍵),
 * 存檔後 value 會跟著變,所以要另外記住打開時的那一份才比得出差距;key 換了(換一個工作項)就重記。
 */
export function useSavedBaseline<T>(key: string, value: T): T {
  const [base, setBase] = useState({ key, value });
  if (base.key !== key) {
    setBase({ key, value });
    return value;
  }
  return base.value;
}
