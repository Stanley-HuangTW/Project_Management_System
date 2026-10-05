"use client";

import { useEffect, useState } from "react";
import {
  getTimesheetStats,
  listViewableUsers,
  type TimesheetStatsResult,
} from "@/lib/actions/activityTime";
import {
  MAX_STATS_RANGE_DAYS,
  bucketLabel,
  daysBetweenInclusive,
  isValidIsoDate,
  monthRangeOf,
  type Granularity,
  type TimesheetStats,
} from "@/lib/timesheet";
import { weekRangeOf } from "@/lib/weeklyReport";

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

const GRANULARITY_LABELS: Record<Granularity, string> = { day: "依日", week: "依週", month: "依月" };

type Loaded = { key: string; data: TimesheetStatsResult };

export function TimesheetStatsView({ today }: { today: string }) {
  const initialWeek = weekRangeOf(today);
  const [from, setFrom] = useState(initialWeek.weekStart);
  const [to, setTo] = useState(initialWeek.weekEnd);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const [includePending, setIncludePending] = useState(true);
  const [users, setUsers] = useState<{ id: string; name: string }[] | null>(null);
  /** null = 我看得到的全部人。 */
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listViewableUsers();
      if (!cancelled) setUsers(result);
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
  const key = JSON.stringify({ from, to, granularity, includePending, selectedIds });

  useEffect(() => {
    if (!canFetch) return;
    let cancelled = false;
    (async () => {
      const data = await getTimesheetStats({
        from,
        to,
        granularity,
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
      setGranularity("day");
    } else if (preset === "week") {
      const range = weekRangeOf(today);
      setFrom(range.weekStart);
      setTo(range.weekEnd);
      setGranularity("day");
    } else {
      const range = monthRangeOf(today);
      setFrom(range.monthStart);
      setTo(range.monthEnd);
      setGranularity("week");
    }
  }

  function toggleUser(id: string) {
    if (!users) return;
    const current = selectedIds ?? users.map((u) => u.id);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setSelectedIds(next.length === users.length ? null : next);
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
          <span className="text-sm text-neutral-400">~</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as Granularity)}
            className={inputClass}
          >
            {(Object.keys(GRANULARITY_LABELS) as Granularity[]).map((g) => (
              <option key={g} value={g}>
                {GRANULARITY_LABELS[g]}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200">
            <input
              type="checkbox"
              checked={includePending}
              onChange={(e) => setIncludePending(e.target.checked)}
            />
            含待審核的專案工時
          </label>
        </div>

        {showPeoplePicker && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs text-neutral-500 dark:text-neutral-400">人員</span>
            {users!.map((u) => {
              const on = selectedIds === null || selectedIds.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => toggleUser(u.id)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${
                    on
                      ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                      : "border-neutral-200 text-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800"
                  }`}
                >
                  {u.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSelectedIds(null)}
              className="ml-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              全選
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              清除
            </button>
          </div>
        )}
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
        <StatsTables stats={result.stats} names={result.users} granularity={granularity} />
      )}
    </div>
  );
}

function StatsTables({
  stats,
  names,
  granularity,
}: {
  stats: TimesheetStats;
  names: { id: string; name: string }[];
  granularity: Granularity;
}) {
  const nameById = new Map(names.map((u) => [u.id, u.name]));
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
          各時段的工時(小時)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 dark:border-neutral-700">
                <th className={`${th} text-left`}>人員</th>
                {stats.buckets.map((b) => (
                  <th key={b} className={th}>
                    {bucketLabel(b, granularity)}
                  </th>
                ))}
                <th className={th}>合計</th>
              </tr>
            </thead>
            <tbody>
              {stats.users.map((u) => (
                <tr key={u.userId} className="border-b border-neutral-100 dark:border-neutral-800">
                  <td className={nameTd}>{nameById.get(u.userId) ?? u.userId}</td>
                  {stats.buckets.map((b) => (
                    <td key={b} className={td}>
                      {cell(u.byBucket[b])}
                    </td>
                  ))}
                  <td className={`${td} font-semibold`}>{cell(u.total)}</td>
                </tr>
              ))}
              <tr className="bg-neutral-50 font-semibold dark:bg-neutral-800/60">
                <td className={nameTd}>合計</td>
                {stats.buckets.map((b) => (
                  <td key={b} className={td}>
                    {cell(stats.totals.byBucket[b])}
                  </td>
                ))}
                <td className={td}>{cell(stats.totals.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          各類別的工時(小時)
        </h2>
        {stats.categories.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">這段期間沒有登記任何工時。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-neutral-200 dark:border-neutral-700">
                  <th className={`${th} text-left`}>人員</th>
                  {stats.categories.map((c) => (
                    <th key={c} className={th}>
                      {c}
                    </th>
                  ))}
                  <th className={th}>合計</th>
                </tr>
              </thead>
              <tbody>
                {stats.users.map((u) => (
                  <tr key={u.userId} className="border-b border-neutral-100 dark:border-neutral-800">
                    <td className={nameTd}>{nameById.get(u.userId) ?? u.userId}</td>
                    {stats.categories.map((c) => (
                      <td key={c} className={td}>
                        {cell(u.byCategory[c])}
                      </td>
                    ))}
                    <td className={`${td} font-semibold`}>{cell(u.total)}</td>
                  </tr>
                ))}
                <tr className="bg-neutral-50 font-semibold dark:bg-neutral-800/60">
                  <td className={nameTd}>合計</td>
                  {stats.categories.map((c) => (
                    <td key={c} className={td}>
                      {cell(stats.totals.byCategory[c])}
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
