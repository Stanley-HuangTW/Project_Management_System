"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { BASE_CURRENCY } from "@/lib/currency";
import {
  listExchangeRates,
  setExchangeRate,
  deleteExchangeRate,
  type RateRow,
} from "@/lib/actions/exchangeRate";
import { withWeekday } from "@/lib/weekdayLabel";

/**
 * 匯率。
 *
 * Only ever used to pre-fill an input and to measure the drift on orders that
 * have not been paid yet. Changing a rate here never moves a figure that has
 * already been booked — each expense and PO carries the rate it was entered
 * with, frozen, or last month's closed accounts would quietly become different
 * numbers this month.
 */
export function ExchangeRateCard() {
  const { notify, confirm, prompt } = useDialogs();
  const [rates, setRates] = useState<RateRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [rate, setRate] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listExchangeRates();
      if (!cancelled) setRates(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      setRates(await listExchangeRates());
      return true;
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">匯率</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        1 單位外幣等於多少 {BASE_CURRENCY}。這裡設定的幣別會出現在預算的支出與訂單輸入框裡,
        並自動預填匯率。<b>改這裡不會動到任何已經記好的帳</b>
        ——每一筆存的是它自己當下的匯率,否則上個月結的帳這個月就變成另一個數字。
      </p>

      {rates.length > 0 && (
        <ul className="mb-2 divide-y divide-neutral-100 dark:divide-neutral-800 rounded-md border border-neutral-200 dark:border-neutral-700">
          {rates.map((row) => (
            <li key={row.code} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-12 shrink-0 font-medium text-neutral-800 dark:text-neutral-100">
                {row.code}
              </span>
              <span className="w-24 shrink-0 tabular-nums text-neutral-700 dark:text-neutral-200">
                {row.rate}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
                更新於 {withWeekday(row.updatedAt.slice(0, 10))}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const next = await prompt(`1 ${row.code} 等於多少台幣?`, {
                    title: `更新 ${row.code} 匯率`,
                    defaultValue: String(row.rate),
                    numeric: true,
                    required: true,
                  });
                  if (next === null) return;
                  await run(() => setExchangeRate(row.code, Number(next)), "無法更新匯率");
                }}
                className="shrink-0 rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
              >
                更新
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const ok = await confirm(`刪除 ${row.code} 的匯率?`, {
                    title: "刪除匯率",
                    confirmLabel: "刪除",
                    danger: true,
                  });
                  if (ok) await run(() => deleteExchangeRate(row.code), "無法刪除");
                }}
                className="shrink-0 rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-40"
                aria-label={`刪除 ${row.code}`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={code}
          disabled={busy}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="USD"
          maxLength={3}
          className={`${fieldClass} w-20`}
        />
        <input
          value={rate}
          disabled={busy}
          onChange={(e) => setRate(e.target.value)}
          placeholder="31.5"
          className={`${fieldClass} w-24 tabular-nums`}
        />
        <button
          type="button"
          disabled={busy || !code.trim() || !rate.trim()}
          onClick={async () => {
            const ok = await run(() => setExchangeRate(code, Number(rate)), "無法新增匯率");
            if (ok) {
              setCode("");
              setRate("");
            }
          }}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={14} /> 新增
        </button>
      </div>
    </div>
  );
}
