"use client";

import { useEffect, useState } from "react";
import { formatMoney, formatIndex } from "@/lib/cost";
import {
  getBoardCostReport,
  getProgramCostReport,
  type BoardCostReport,
} from "@/lib/actions/boardCost";
import { HScrollPane } from "@/components/ui/HScrollPane";

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
      <p
        className={`mt-0.5 text-lg font-semibold tabular-nums ${
          tone === "bad" ? "text-red-600" : tone === "good" ? "text-green-600" : "text-neutral-800 dark:text-neutral-100"
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  );
}

/**
 * 成本與 EVM.
 *
 * The three EVM numbers are only worth anything together, so they are shown
 * together and each says what it is in words — CPI 0.83 means nothing to
 * most people, "花掉的比做出來的多" means something to everyone.
 */
export function CostReport({ boardId, programId }: { boardId?: string; programId?: string }) {
  const [report, setReport] = useState<BoardCostReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // One board, or every board in a 專案群組 as a single BAC/EV/AC.
      const result = programId
        ? await getProgramCostReport(programId)
        : boardId
          ? await getBoardCostReport(boardId)
          : null;
      if (!cancelled) {
        setReport(result);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, programId]);

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!report) return null;

  if (report.hidden) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        你沒有查看這裡預算與成本的權限。預算金額只給管理者、看板擁有者、專案負責角色(Team Leader、PMD、PM DM)、看板指名的人,
        以及系統設定裡指定的組織主管;需要的話請看板擁有者或管理者在「看板分享設定」把你加進「可以看預算的人」。
      </p>
    );
  }

  if (report.empty) {
    return (
      <p className="text-sm text-neutral-400 dark:text-neutral-500">
        還沒有成本資料。在工作項的「工時與費用」填直接費用預算,並在使用者管理設定成員時薪,
        人力成本會由甘特圖的配置比例自動算出。
      </p>
    );
  }

  const { evm, planned, actual } = report;
  const overspent = evm.costVariance < 0;
  const behind = evm.scheduleVariance < 0;
  // The worst offenders first — that is the list anyone opens this for.
  const worst = [...report.rows].sort((a, b) => b.overrun - a.overrun).filter((r) => r.overrun > 0).slice(0, 8);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="完工總預算 BAC"
          value={formatMoney(evm.bac)}
          hint={`人力 ${formatMoney(planned.labour)} + 直接 ${formatMoney(planned.direct)}`}
        />
        <Stat
          label="實際成本 AC"
          value={formatMoney(evm.ac)}
          hint={`人力 ${formatMoney(actual.labour)} + 直接 ${formatMoney(actual.direct)}`}
        />
        <Stat
          label="實獲值 EV"
          value={formatMoney(evm.ev)}
          hint="已完成的工作值多少錢"
        />
        <Stat
          label="計畫價值 PV"
          value={formatMoney(evm.pv)}
          hint="照計畫今天應該做完多少"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="成本效率 CPI"
          value={formatIndex(evm.cpi)}
          tone={evm.cpi === null ? undefined : evm.cpi < 1 ? "bad" : "good"}
          hint={evm.cpi === null ? "尚未有實際支出" : evm.cpi < 1 ? "花掉的比做出來的多" : "花得比做出來的少"}
        />
        <Stat
          label="進度效率 SPI"
          value={formatIndex(evm.spi)}
          tone={evm.spi === null ? undefined : evm.spi < 1 ? "bad" : "good"}
          hint={evm.spi === null ? "計畫尚未開始" : evm.spi < 1 ? "做得比計畫少" : "做得比計畫多"}
        />
        <Stat
          label="成本差異 CV"
          value={formatMoney(evm.costVariance)}
          tone={overspent ? "bad" : "good"}
          hint={overspent ? "超支" : "低於預算"}
        />
        <Stat
          label="完工預估 EAC"
          value={evm.eac === null ? "—" : formatMoney(evm.eac)}
          tone={evm.eac !== null && evm.eac > evm.bac ? "bad" : undefined}
          hint={evm.eac === null ? "尚未有實際支出" : `照目前效率跑完的總花費`}
        />
      </div>

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {behind ? "目前落後計畫" : "目前不落後計畫"},差異 {formatMoney(Math.abs(evm.scheduleVariance))}。
        人力成本 = 配置比例 × 天數 × 每日 {report.hoursPerDay} 小時 × 成員時薪。預算只算葉節點工作項(父項與子項的預算多半是同一筆錢寫兩次),實際支出則不分層級全部計入。
      </p>

      {report.ignoredParentBudgets.length > 0 && (
        <p className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          以下有子項的工作項填了直接費用預算,但沒有計入 BAC(避免與子項的預算重複計算):
          {report.ignoredParentBudgets.join("、")}。請把預算填在實際發生費用的子項上。
        </p>
      )}

      {report.missingRateNames.length > 0 && (
        <p className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          以下成員有登記工時但沒有設定時薪,他們的人力成本目前以 0 計:
          {report.missingRateNames.join("、")}。請到「使用者管理」設定。
        </p>
      )}

      {worst.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
            花得比做出來的多的工作項
          </h4>
          <HScrollPane className="rounded-md border border-neutral-200 dark:border-neutral-700">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">工作項</th>
                  <th className="px-3 py-2 text-right font-medium">預算</th>
                  <th className="px-3 py-2 text-right font-medium">實獲值</th>
                  <th className="px-3 py-2 text-right font-medium">實際</th>
                  <th className="px-3 py-2 text-right font-medium">差額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-700">
                {worst.map((row) => (
                  <tr key={row.id}>
                    <td className="max-w-[240px] truncate px-3 py-2 text-neutral-800 dark:text-neutral-100">
                      {row.name}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                      {formatMoney(row.budget)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                      {formatMoney(row.earned)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">
                      {formatMoney(row.actual)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-red-600">
                      +{formatMoney(row.overrun)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </HScrollPane>
        </section>
      )}
    </div>
  );
}
