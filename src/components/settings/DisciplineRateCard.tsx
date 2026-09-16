"use client";

import { useEffect, useState, useTransition } from "react";
import type { Discipline } from "@/lib/labourPlan";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { unitLabel, type OrgUnit } from "@/lib/orgUnits";
import { formatMoney } from "@/lib/cost";
import { listDisciplineRates, setDisciplineRate } from "@/lib/actions/labourPlan";
import { setWorkingDaysPerMonth } from "@/lib/actions/systemSettings";

/**
 * 單位標準月薪與人月換算。
 *
 * 編預算的時候還不知道會是誰做,所以人力規劃一律用單位的標準價;人身上的
 * 月薪/時薪只用在算實際成本。兩邊分開,是因為它們回答的是不同的問題。
 */
export function DisciplineRateCard({
  units,
  workingDaysPerMonth,
  hoursPerDay,
}: {
  /** 跟「公司組織單位」那張卡片同一份,由設定頁一次載入。 */
  units: OrgUnit[];
  workingDaysPerMonth: number;
  hoursPerDay: number;
}) {
  const { notify } = useDialogs();
  const [days, setDays] = useState(String(workingDaysPerMonth));
  const [rates, setRates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listDisciplineRates();
        if (!cancelled) {
          setRates(Object.fromEntries(rows.map((r) => [r.discipline, String(r.monthlySalary)])));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const currentDays = Number(days) > 0 ? Number(days) : workingDaysPerMonth;
  const hoursPerMonth = currentDays * hoursPerDay;

  function saveDays() {
    const value = Number(days);
    if (!Number.isFinite(value) || value < 1 || value > 31) {
      setDays(String(workingDaysPerMonth));
      return;
    }
    startTransition(async () => {
      await setWorkingDaysPerMonth(value);
    });
  }

  async function saveRate(discipline: Discipline) {
    const raw = (rates[discipline] ?? "").trim();
    const value = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setSavingId(discipline);
    try {
      const result = await setDisciplineRate(discipline, value);
      if (result.error) await notify(result.error, { title: "無法儲存" });
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "操作失敗",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法儲存" }
      );
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">
        單位標準月薪與人月換算
      </p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        人力預算用「幾個人月」談,所以這裡給每個單位一個標準月薪,人力規劃表就能在還不知道是誰做的
        時候算出金額。改了標準價,已經編出來的人力預算會跟著重算。
      </p>

      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-neutral-600 dark:text-neutral-300">一個人月算</span>
        <input
          type="number"
          min={1}
          max={31}
          value={days}
          disabled={isPending}
          onChange={(e) => setDays(e.target.value)}
          onBlur={saveDays}
          className="w-20 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <span className="text-xs text-neutral-600 dark:text-neutral-300">
          個工作天 = {hoursPerMonth} 小時(每日工時 {hoursPerDay} 小時)
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
              <th className="pb-1 font-normal">單位</th>
              <th className="pb-1 font-normal">標準月薪(元)</th>
              <th className="pb-1 text-right font-normal">換算時薪</th>
            </tr>
          </thead>
          <tbody>
            {units.map(({ code: discipline }) => {
              const monthly = Number(rates[discipline] ?? 0);
              return (
                <tr key={discipline} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-1.5 text-neutral-700 dark:text-neutral-200">
                    {unitLabel(units, discipline)}
                  </td>
                  <td className="py-1.5">
                    <input
                      value={rates[discipline] ?? ""}
                      disabled={savingId === discipline}
                      onChange={(e) => setRates({ ...rates, [discipline]: e.target.value })}
                      onBlur={() => saveRate(discipline)}
                      inputMode="numeric"
                      placeholder="未設定"
                      className="w-32 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-500 dark:text-neutral-400">
                    {monthly > 0 && hoursPerMonth > 0
                      ? `${formatMoney(Math.round(monthly / hoursPerMonth))} 元/時`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
