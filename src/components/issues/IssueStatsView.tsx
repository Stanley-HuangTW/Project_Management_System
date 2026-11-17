"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { IssueStatsResult } from "@/lib/actions/issueStats";
import type { ParetoRow, ProductSummary } from "@/lib/issueStats";
import { ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import { StatusBadge, inputClass } from "./issueUi";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number | null, digits = 1) => (n === null ? "—" : n.toFixed(digits));

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900">
      <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{value}</div>
      {hint && <div className="text-[10px] text-neutral-400">{hint}</div>}
    </div>
  );
}

/** 柏拉圖表:由多到少,長條 = 佔比,右邊是累計佔比(跟原 Sheet 的「佔比 / 累計佔比」欄同一個意思)。 */
function ParetoTable({ title, rows, limit = 15, testId, note }: { title: string; rows: ParetoRow[]; limit?: number; testId: string; note?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, limit);
  const max = rows[0]?.count ?? 1;
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid={testId} data-issue-pareto>
      <h3 className="mb-0.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h3>
      {note && <p className="mb-2 text-[11px] text-neutral-400">{note}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">沒有資料。</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-neutral-400">
              <th className="py-1 pr-2 font-normal">項目</th>
              <th className="w-1/3 py-1 pr-2 font-normal">次數</th>
              <th className="py-1 pr-2 text-right font-normal">佔比</th>
              <th className="py-1 text-right font-normal">累計</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.name} className="border-t border-neutral-100 dark:border-neutral-800" data-testid="pareto-row">
                <td className="max-w-[16rem] truncate py-1 pr-2 text-neutral-800 dark:text-neutral-100" title={r.name}>{r.name}</td>
                <td className="py-1 pr-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded bg-blue-500" style={{ width: `${Math.max(4, (r.count / max) * 100)}%` }} />
                    <span className="tabular-nums text-neutral-600 dark:text-neutral-300">{r.count}</span>
                  </div>
                </td>
                <td className="py-1 pr-2 text-right tabular-nums text-neutral-600 dark:text-neutral-300">{pct(r.pct)}</td>
                <td className="py-1 text-right tabular-nums text-neutral-400">{pct(r.cumPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > limit && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-xs text-blue-600 hover:underline">
          {all ? "收合" : `顯示全部 ${rows.length} 項`}
        </button>
      )}
    </section>
  );
}

function Months({ months }: { months: ProductSummary["months"] }) {
  const max = Math.max(1, ...months.map((m) => m.count));
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="months">
      <h3 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">每月案件數</h3>
      {months.length === 0 ? (
        <p className="text-sm text-neutral-400">沒有資料。</p>
      ) : (
        <div className="flex h-28 items-end gap-1.5 overflow-x-auto">
          {months.map((m) => (
            <div key={m.month} className="flex min-w-8 flex-col items-center justify-end gap-1">
              <span className="text-[10px] tabular-nums text-neutral-500">{m.count}</span>
              <div className="w-5 rounded-t bg-emerald-500" style={{ height: `${Math.max(3, (m.count / max) * 80)}px` }} />
              <span className="text-[10px] text-neutral-400">{m.month.slice(2)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function IssueStatsView({ stats, from, to }: { stats: IssueStatsResult; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(0);
  const s = stats.summaries[Math.min(tab, stats.summaries.length - 1)];
  const dayLabel = stats.dayMode === "WORKDAY" ? "工作天" : "日曆天";

  function setRange(next: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    const f = next.from ?? from;
    const t = next.to ?? to;
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6" data-testid="issue-stats">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">各產品統整</h1>
        <span className="flex flex-wrap items-center gap-1 whitespace-nowrap text-xs text-neutral-500">
          發生日
          <input type="date" value={from} onChange={(e) => setRange({ from: e.target.value })} className={`${inputClass} w-auto`} aria-label="起" />
          ~
          <input type="date" value={to} onChange={(e) => setRange({ to: e.target.value })} className={`${inputClass} w-auto`} aria-label="迄" />
        </span>
        {(from || to) && (
          <button type="button" onClick={() => router.push(pathname)} className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100">清除區間</button>
        )}
      </div>

      {stats.empty ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-400 dark:border-neutral-600">這個區間沒有案件。</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" data-testid="product-tabs">
            {stats.summaries.map((p, i) => (
              <button
                key={p.product}
                type="button"
                role="tab"
                aria-selected={i === tab}
                onClick={() => setTab(i)}
                className={`rounded-full border px-3 py-1 text-xs ${i === tab ? "border-blue-600 bg-blue-600 text-white" : "border-neutral-300 text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"}`}
              >
                {p.product} <span className="opacity-70">({p.total})</span>
              </button>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" data-testid="kpis">
            <Kpi label="案件數" value={String(s.total)} />
            <Kpi label="處理中" value={String(s.open)} />
            <Kpi label="暫時解決 / 永久解決" value={`${s.tc} / ${s.pc}`} />
            <Kpi label="RMA" value={String(s.rma)} hint={`刀盤造成 ${s.rmaCuttingDisk}`} />
            <Kpi label={`平均處理(${dayLabel})`} value={num(s.avgDays)} hint="MTTR,有結案日期的案件" />
            <Kpi label={`中位數(${dayLabel})`} value={num(s.medianDays)} />
            <Kpi label="平均首次回覆(小時)" value={num(s.avgFirstResponseHours)} hint="FRT" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ParetoTable title="最常發生的問題類型" rows={s.errorTypes} testId="pareto-errors" note="對應原 Sheet「Data Sheet」的 Error Type 次數與佔比" />
            <ParetoTable title="問題大類" rows={s.categories} testId="pareto-categories" note="SW 軟體 / HW 硬體 / CN 查無問題 / LM 設計限制 / OP 安裝操作" />
            <ParetoTable title="零件更換排行" rows={s.parts} testId="pareto-parts" note="以零件簡稱歸類;對應原 Sheet「Repair Parts」" />
            <ParetoTable title="保固狀態" rows={s.warranty} testId="pareto-warranty" />
            <ParetoTable title="案件最多的客戶" rows={s.customers} testId="pareto-customers" />
            <Months months={s.months} />
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold text-neutral-900 dark:text-neutral-100">最近的案件(不受上面的區間限制)</h2>
          <div className="mb-4 grid gap-3 md:grid-cols-3" data-testid="windows">
            {stats.windows
              .filter((w) => w.key !== "all")
              .map((w) => (
                <div key={w.key} className="rounded-md border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{w.label}</span>
                    <span className="text-lg font-semibold tabular-nums">{w.total}</span>
                  </div>
                  <div className="mb-2 text-xs text-neutral-500">
                    保固:{w.warranty.length ? w.warranty.map((x) => `${x.name} ${x.count}`).join("、") : "—"}
                  </div>
                  <ul className="space-y-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                    {w.customerErrors.slice(0, 5).map((c) => (
                      <li key={`${c.customer}-${c.errorType}`} className="truncate" title={`${c.customer} / ${c.errorType}`}>
                        {c.count}× {c.customer} — {c.errorType}
                      </li>
                    ))}
                    {w.customerErrors.length === 0 && <li className="text-neutral-400">沒有案件</li>}
                  </ul>
                </div>
              ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {([["近 30 天仍在處理中", stats.recent.open, "recent-open"], ["近 30 天已解決(暫時 / 永久)", stats.recent.resolved, "recent-resolved"]] as const).map(([title, list, id]) => (
              <section key={id} className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid={id}>
                <h3 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title} <span className="font-normal text-neutral-400">({list.length})</span></h3>
                <ul className="space-y-1 text-xs">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <Link href={`/issues/${c.id}`} className="text-blue-700 hover:underline dark:text-blue-400">{c.caseNo}</Link>
                      <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300">{c.customer ?? "—"} · {c.product ?? "—"} · {c.errorType ?? "未判定"}</span>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                  {list.length === 0 && <li className="text-neutral-400">沒有案件</li>}
                </ul>
              </section>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-neutral-400">狀態:{Object.entries(ISSUE_STATUS_LABELS).map(([k, l]) => `${k}=${l}`).join("、")}。處理天數依「系統設定」算{dayLabel}(含頭尾)。</p>
        </>
      )}
    </div>
  );
}
