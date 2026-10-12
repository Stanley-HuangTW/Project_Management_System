"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { MyWeek } from "@/lib/actions/activityTime";
import {
  buildEstimateTable,
  summarizeByDay,
  type ActualEntry,
  type Comparison,
  type DaySummary,
  type EstimateRow,
  type EstimateWeek,
} from "@/lib/timesheetEstimate";

const WEEKDAY_LABELS = ["週一", "週二", "週三", "週四", "週五", "週六", "週日"];

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

/** 差異:實際 − 預估,有正負號;0 顯示 0。 */
function signed(hours: number): string {
  if (hours === 0) return "0";
  return `${hours > 0 ? "+" : "−"}${fmt(Math.abs(hours))}`;
}

/** 實際比預估多是紅的(超出)、少是一般的灰(還沒做到)。 */
function diffClass(c: Comparison): string {
  if (c.estimate === 0) return c.actual > 0 ? "text-amber-600 dark:text-amber-400" : "text-neutral-400 dark:text-neutral-500";
  return c.diff > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-700 dark:text-neutral-200";
}

function Pct({ c }: { c: Comparison }) {
  if (c.pct === null) return <span className="text-neutral-400 dark:text-neutral-500">—</span>;
  return <span className={c.pct > 100 ? "text-red-600 dark:text-red-400" : ""}>{c.pct}%</span>;
}

function Remaining({ c }: { c: Comparison }) {
  if (c.remainingPct === null) return <span className="text-neutral-400 dark:text-neutral-500">—</span>;
  if (c.remainingPct < 0) return <span className="text-red-600 dark:text-red-400">超出 {-c.remainingPct}%</span>;
  return <span>{c.remainingPct}%</span>;
}

const th = "px-2 py-1.5 text-right font-medium";
const td = "px-2 py-1 text-right tabular-nums";

/** 從這一週的登記整理出實際工時:沒被退回的;有對應專案的算進那個專案(專案工作項的工時帶著工作項)。 */
function actualsOf(week: MyWeek): ActualEntry[] {
  const out: ActualEntry[] = [];
  for (const day of week.days) {
    for (const e of day.project) {
      if (e.status === "REJECTED") continue;
      out.push({ date: day.date, hours: e.hours, boardId: e.boardId, boardName: e.boardName, itemId: e.itemId, itemName: e.itemName });
    }
    for (const e of day.activity) {
      if (e.status === "REJECTED") continue;
      out.push({ date: day.date, hours: e.hours, boardId: e.boardId, boardName: e.boardName, itemId: null, itemName: null });
    }
  }
  return out;
}

/**
 * 「預估對照」:這一週每天的人力表預估、工作項預估、實際登記的工時,以及差異、達成率與剩餘。
 * 點某一天的表頭,下面的專案表就只看那一天;點「本週」回到整週。
 * 實際直接取自畫面上這一週的登記,所以改了工時馬上跟著變。
 */
export function EstimatePanel({
  estimates,
  week,
  days,
  today,
}: {
  estimates: EstimateWeek | { error: string } | null;
  week: MyWeek;
  days: string[];
  today: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const actuals = useMemo(() => actualsOf(week), [week]);
  const ready = estimates && !("error" in estimates) ? estimates : null;
  const daily = useMemo(() => (ready ? summarizeByDay(ready, actuals, days) : []), [ready, actuals, days]);
  const weekTotal = useMemo(() => (ready ? buildEstimateTable(ready, actuals, days) : null), [ready, actuals, days]);
  const dayTable = useMemo(
    () => (ready && selected ? buildEstimateTable(ready, actuals, [selected]) : null),
    [ready, actuals, selected]
  );
  const table = dayTable ?? weekTotal;

  if (estimates === null) return <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">載入預估中...</p>;
  if ("error" in estimates) return <p className="mt-4 text-xs text-red-600 dark:text-red-400">無法讀取預估:{estimates.error}</p>;
  if (!ready || !table || !weekTotal) return null;

  const otherWeek = weekTotal.other;
  const nothing = ready.projects.length === 0 && actuals.every((a) => !a.boardId);
  const scopeLabel = selected ? `${WEEKDAY_LABELS[days.indexOf(selected)]} ${selected.slice(5)}` : "本週";

  const metricRows: { label: string; cellOf: (d: DaySummary) => string; total: number; strong: boolean }[] = [
    { label: "人力表預估(小時)", cellOf: (d) => fmt(d.labour), total: weekTotal.total.labour, strong: false },
    { label: "工作項預估(小時)", cellOf: (d) => fmt(d.work), total: weekTotal.total.work, strong: false },
    { label: "實際(小時,有對應專案)", cellOf: (d) => fmt(d.actual), total: weekTotal.total.actual, strong: true },
  ];

  function toggle(key: string) {
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderRow(row: EstimateRow, depth: number) {
    const expandable = row.children.length > 0;
    const isOpen = open.has(row.key);
    return (
      <Fragment key={row.key}>
        <tr className={depth === 0 ? "border-t border-neutral-100 dark:border-neutral-800" : "bg-neutral-50/60 dark:bg-neutral-800/30"}>
          <td className="px-2 py-1 text-left">
            <div className={`flex items-center gap-1 ${depth > 0 ? "pl-5" : ""}`}>
              {depth === 0 &&
                (expandable ? (
                  <button
                    type="button"
                    onClick={() => toggle(row.key)}
                    className="rounded p-0.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    aria-label={isOpen ? `收合 ${row.label}` : `展開 ${row.label} 的工作項`}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                ) : (
                  <span className="inline-block w-[17px]" />
                ))}
              <span className={`truncate ${depth === 0 ? "font-medium text-neutral-800 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"}`} title={row.label}>
                {row.label}
              </span>
              {row.sublabel && <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">({row.sublabel})</span>}
            </div>
          </td>
          <td className={td}>{row.labour === null ? "" : fmt(row.labour)}</td>
          <td className={td}>{fmt(row.work)}</td>
          <td className={`${td} font-medium`}>{fmt(row.actual)}</td>
          {row.vsLabour ? (
            <>
              <td className={`${td} ${diffClass(row.vsLabour)}`}>{signed(row.vsLabour.diff)}</td>
              <td className={td}><Pct c={row.vsLabour} /></td>
              <td className={td}><Remaining c={row.vsLabour} /></td>
            </>
          ) : (
            <td colSpan={3} />
          )}
          <td className={`${td} ${diffClass(row.vsWork)}`}>{signed(row.vsWork.diff)}</td>
          <td className={td}><Pct c={row.vsWork} /></td>
          <td className={td}><Remaining c={row.vsWork} /></td>
        </tr>
        {isOpen && row.children.map((child) => renderRow(child, depth + 1))}
      </Fragment>
    );
  }

  return (
    <section className="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <header className="border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">預估對照</h3>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          <b>人力表預估</b>:人力表裡指到你的名額,每月投入 × 每日 {ready.hoursPerDay} 小時,攤到當月的工作日。
          <b>工作項預估</b>:指派給你的工作項,配置比例 × 每日 {ready.hoursPerDay} 小時,攤到工作項起訖之間的工作日。
          實際只算有對應專案的工時;差異 = 實際 − 預估,達成 = 實際 ÷ 預估,剩餘 = 100% − 達成。
        </p>
      </header>

      {nothing && (
        <p className="px-3 py-3 text-xs text-neutral-500 dark:text-neutral-400">
          這一週沒有預估:人力表沒有指到你的名額,也沒有指派給你(而且有排程)的工作項。
        </p>
      )}

      {/* 每天 */}
      <div className="overflow-x-auto px-1 py-2">
        <table className="w-full min-w-[760px] text-xs">
          <thead className="text-neutral-500 dark:text-neutral-400">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">每日</th>
              {days.map((d, i) => {
                const isSel = selected === d;
                return (
                  <th key={d} className={th}>
                    <button
                      type="button"
                      onClick={() => setSelected(isSel ? null : d)}
                      aria-pressed={isSel}
                      title={isSel ? "回到整週" : `只看 ${d} 的專案對照`}
                      className={`rounded px-1.5 py-0.5 ${
                        isSel
                          ? "bg-blue-600 text-white"
                          : d === today
                            ? "text-blue-600 hover:bg-neutral-100 dark:text-blue-400 dark:hover:bg-neutral-800"
                            : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      }`}
                    >
                      {WEEKDAY_LABELS[i]} {d.slice(5)}
                    </button>
                  </th>
                );
              })}
              <th className={th}>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-pressed={selected === null}
                  className={`rounded px-1.5 py-0.5 ${selected === null ? "bg-blue-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
                >
                  本週
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {metricRows.map(({ label, cellOf, total, strong }) => (
              <tr key={label}>
                <td className="px-2 py-1 text-left text-neutral-600 dark:text-neutral-300">{label}</td>
                {daily.map((d) => (
                  <td key={d.date} className={`${td} ${strong ? "font-medium" : ""} ${d.workday ? "" : "bg-neutral-50 dark:bg-neutral-800/40"}`}>
                    {cellOf(d)}
                  </td>
                ))}
                <td className={`${td} font-semibold`}>{fmt(total)}</td>
              </tr>
            ))}
            <tr>
              <td className="px-2 py-1 text-left text-neutral-400 dark:text-neutral-500" title="沒有對應專案的會議與其他,不拿去跟專案預估比">
                其他(未對應專案)
              </td>
              {daily.map((d) => (
                <td key={d.date} className={`${td} text-neutral-400 dark:text-neutral-500`}>
                  {d.other > 0 ? fmt(d.other) : ""}
                </td>
              ))}
              <td className={`${td} text-neutral-400 dark:text-neutral-500`}>{otherWeek > 0 ? fmt(otherWeek) : ""}</td>
            </tr>
            {(
              [
                ["對人力表", "vsLabour", weekTotal.total.vsLabour],
                ["對工作項", "vsWork", weekTotal.total.vsWork],
              ] as const
            ).map(([label, key, total]) => (
              <Fragment key={key}>
                <tr>
                  <td className="px-2 py-1 text-left text-neutral-600 dark:text-neutral-300">{label}:差異(實際 − 預估)</td>
                  {daily.map((d) => (
                    <td key={d.date} className={`${td} ${diffClass(d[key])}`}>
                      {d[key].estimate === 0 && d[key].actual === 0 ? "" : signed(d[key].diff)}
                    </td>
                  ))}
                  <td className={`${td} font-semibold ${diffClass(total)}`}>{signed(total.diff)}</td>
                </tr>
                <tr>
                  <td className="px-2 py-1 text-left text-neutral-600 dark:text-neutral-300">{label}:達成 / 剩餘</td>
                  {daily.map((d) => (
                    <td key={d.date} className={td}>
                      {d[key].pct === null ? (
                        ""
                      ) : (
                        <>
                          <Pct c={d[key]} /> <span className="text-neutral-400 dark:text-neutral-500">/</span> <Remaining c={d[key]} />
                        </>
                      )}
                    </td>
                  ))}
                  <td className={`${td} font-semibold`}>
                    {total.pct === null ? (
                      <span className="font-normal text-neutral-400 dark:text-neutral-500">—</span>
                    ) : (
                      <>
                        <Pct c={total} /> <span className="font-normal text-neutral-400 dark:text-neutral-500">/</span> <Remaining c={total} />
                      </>
                    )}
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {/* 各專案 */}
      <div className="overflow-x-auto border-t border-neutral-100 px-1 py-2 dark:border-neutral-800">
        <table className="w-full min-w-[880px] text-xs">
          <thead className="text-neutral-500 dark:text-neutral-400">
            <tr>
              <th rowSpan={2} className="px-2 py-1.5 text-left align-bottom font-medium">
                各專案({scopeLabel})
              </th>
              <th rowSpan={2} className={`${th} align-bottom`}>人力表預估</th>
              <th rowSpan={2} className={`${th} align-bottom`}>工作項預估</th>
              <th rowSpan={2} className={`${th} align-bottom`}>實際</th>
              <th colSpan={3} className="px-2 pt-1.5 text-center font-medium">對人力表</th>
              <th colSpan={3} className="px-2 pt-1.5 text-center font-medium">對工作項</th>
            </tr>
            <tr>
              {["差異", "達成", "剩餘", "差異", "達成", "剩餘"].map((h, i) => (
                <th key={i} className={th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => renderRow(row, 0))}
            {table.rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-2 py-4 text-center text-neutral-400 dark:text-neutral-500">
                  {scopeLabel}沒有預估,也沒有登記對應專案的工時。
                </td>
              </tr>
            )}
          </tbody>
          {table.rows.length > 0 && (
            <tfoot className="border-t-2 border-neutral-200 font-semibold dark:border-neutral-700">
              <tr>
                <td className="px-2 py-1.5 text-left">合計</td>
                <td className={td}>{fmt(table.total.labour)}</td>
                <td className={td}>{fmt(table.total.work)}</td>
                <td className={td}>{fmt(table.total.actual)}</td>
                <td className={`${td} ${diffClass(table.total.vsLabour)}`}>{signed(table.total.vsLabour.diff)}</td>
                <td className={td}><Pct c={table.total.vsLabour} /></td>
                <td className={td}><Remaining c={table.total.vsLabour} /></td>
                <td className={`${td} ${diffClass(table.total.vsWork)}`}>{signed(table.total.vsWork.diff)}</td>
                <td className={td}><Pct c={table.total.vsWork} /></td>
                <td className={td}><Remaining c={table.total.vsWork} /></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
