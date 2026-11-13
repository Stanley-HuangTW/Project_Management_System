"use client";

import { useEffect, useState } from "react";
import {
  getTimesheetStats,
  listViewableUsers,
  type TimesheetStatsResult,
} from "@/lib/actions/activityTime";
import {
  MAX_STATS_RANGE_DAYS,
  daysBetweenInclusive,
  isValidIsoDate,
  monthRangeOf,
  type TimesheetStats,
} from "@/lib/timesheet";
import { weekRangeOf } from "@/lib/weeklyReport";
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";
import { TimesheetPeopleSelect, type StatsPerson, type StatsUnit } from "./TimesheetPeopleSelect";

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

type Loaded = { key: string; data: TimesheetStatsResult };

export function TimesheetStatsView({ today }: { today: string }) {
  const initialWeek = weekRangeOf(today);
  const [from, setFrom] = useState(initialWeek.weekStart);
  const [to, setTo] = useState(initialWeek.weekEnd);
  const [includePending, setIncludePending] = useState(true);
  const [users, setUsers] = useState<StatsPerson[] | null>(null);
  const [units, setUnits] = useState<StatsUnit[]>([]);
  /** null = 我看得到的全部人。 */
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listViewableUsers();
      if (!cancelled) {
        setUsers(result.users);
        setUnits(result.units);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeError = !isValidIsoDate(from) || !isValidIsoDate(to)
    ? "請選擇起訖日期"
    : from > to
      ? "開始日期不能晚於結束日期"
      : daysBetweenInclusive(from, to) > MAX_STATS_RANGE_DAYS
        ? `一次最多統計 ${MAX_STATS_RANGE_DAYS} 天`
        : null;
  const nobodySelected = selectedIds !== null && selectedIds.length === 0;
  const canFetch = !rangeError && !nobodySelected && users !== null;
  const key = JSON.stringify({ from, to, includePending, selectedIds });

  useEffect(() => {
    if (!canFetch) return;
    let cancelled = false;
    (async () => {
      const data = await getTimesheetStats({
        from,
        to,
        // 畫面只看「各類別的工時(依專案分類)」,不用分時段;時段彙總是伺服器端的選項,這裡固定用依日。
        granularity: "day",
        includePending,
        userIds: selectedIds ?? undefined,
      });
      if (!cancelled) setLoaded({ key, data });
    })();
    return () => {
      cancelled = true;
    };
    // key 已經包含全部參數;列出來只會讓 selectedIds 的新陣列每次都重抓。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canFetch, key]);

  function applyPreset(preset: "day" | "week" | "month") {
    if (preset === "day") {
      setFrom(today);
      setTo(today);
    } else if (preset === "week") {
      const range = weekRangeOf(today);
      setFrom(range.weekStart);
      setTo(range.weekEnd);
    } else {
      const range = monthRangeOf(today);
      setFrom(range.monthStart);
      setTo(range.monthEnd);
    }
  }

  const result = loaded && loaded.key === key ? loaded.data : null;
  const showPeoplePicker = users !== null && users.length > 1;

  return (
    <div>
      <div className="mb-4 space-y-3 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ["day", "本日"],
              ["week", "本週"],
              ["month", "本月"],
            ] as const
          ).map(([preset, label]) => (
            <button
              key={preset}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              {label}
            </button>
          ))}
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          <DateWeekdayHint value={from} />
          <span className="text-sm text-neutral-400">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          <DateWeekdayHint value={to} />
          {showPeoplePicker && (
            <TimesheetPeopleSelect people={users!} units={units} value={selectedIds} onChange={setSelectedIds} />
          )}
          <label className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={includePending}
              onChange={(e) => setIncludePending(e.target.checked)}
            />
            含待審核的工時(專案工時與對應專案的會議)
          </label>
        </div>
      </div>

      {rangeError ? (
        <p className="text-sm text-red-600 dark:text-red-400">{rangeError}</p>
      ) : nobodySelected ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">請至少選擇一位成員。</p>
      ) : !result ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : "error" in result ? (
        <p className="text-sm text-red-600 dark:text-red-400">{result.error}</p>
      ) : (
        <StatsTables stats={result.stats} names={result.users} />
      )}
    </div>
  );
}

function StatsTables({ stats, names }: { stats: TimesheetStats; names: { id: string; name: string }[] }) {
  const nameById = new Map(names.map((u) => [u.id, u.name]));
  // 欄位已經依專案排好;同一個專案的欄連在一起,第一列用 colSpan 蓋住它們。
  const projectGroups: { project: string; columns: typeof stats.columns; total: number }[] = [];
  for (const column of stats.columns) {
    const last = projectGroups[projectGroups.length - 1];
    const hours = stats.totals.byColumn[column.key] ?? 0;
    if (last && last.project === column.project) {
      last.columns.push(column);
      last.total += hours;
    } else {
      projectGroups.push({ project: column.project, columns: [column], total: hours });
    }
  }
  const cell = (value: number | undefined) =>
    value ? (
      <span className="tabular-nums">{fmt(value)}</span>
    ) : (
      <span className="text-neutral-300 dark:text-neutral-600">–</span>
    );

  const th = "whitespace-nowrap px-3 py-1.5 text-right text-xs font-medium text-neutral-500 dark:text-neutral-400";
  const td = "whitespace-nowrap px-3 py-1.5 text-right text-sm text-neutral-700 dark:text-neutral-100";
  const nameTd = "whitespace-nowrap px-3 py-1.5 text-left text-sm text-neutral-800 dark:text-neutral-100";

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          各類別的工時(小時,依專案分類)
        </h2>
        {stats.columns.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">這段期間沒有登記任何工時。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            <table className="w-full border-collapse">
              <thead>
                {/* 第一列:專案(含該專案的工時合計);第二列:專案底下的類別 */}
                <tr className="border-b border-neutral-100 dark:border-neutral-800">
                  <th className={`${th} text-left`} rowSpan={2}>
                    人員
                  </th>
                  {projectGroups.map((g) => (
                    <th
                      key={g.project}
                      colSpan={g.columns.length}
                      className="whitespace-nowrap border-l border-neutral-200 px-3 py-1.5 text-center text-xs font-semibold text-neutral-700 dark:border-neutral-700 dark:text-neutral-200"
                    >
                      {g.project}
                      <span className="ml-1 font-normal text-neutral-400">{fmt(g.total)}h</span>
                    </th>
                  ))}
                  <th className={th} rowSpan={2}>
                    合計
                  </th>
                </tr>
                <tr className="border-b border-neutral-200 dark:border-neutral-700">
                  {stats.columns.map((c, i) => (
                    <th
                      key={c.key}
                      className={`${th} ${i === 0 || stats.columns[i - 1].project !== c.project ? "border-l border-neutral-200 dark:border-neutral-700" : ""}`}
                    >
                      {c.category}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.users.map((u) => (
                  <tr key={u.userId} className="border-b border-neutral-100 dark:border-neutral-800">
                    <td className={nameTd}>{nameById.get(u.userId) ?? u.userId}</td>
                    {stats.columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={`${td} ${i === 0 || stats.columns[i - 1].project !== c.project ? "border-l border-neutral-100 dark:border-neutral-800" : ""}`}
                      >
                        {cell(u.byColumn[c.key])}
                      </td>
                    ))}
                    <td className={`${td} font-semibold`}>{cell(u.total)}</td>
                  </tr>
                ))}
                <tr className="bg-neutral-50 font-semibold dark:bg-neutral-800/60">
                  <td className={nameTd}>合計</td>
                  {stats.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`${td} ${i === 0 || stats.columns[i - 1].project !== c.project ? "border-l border-neutral-100 dark:border-neutral-800" : ""}`}
                    >
                      {cell(stats.totals.byColumn[c.key])}
                    </td>
                  ))}
                  <td className={td}>{cell(stats.totals.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
