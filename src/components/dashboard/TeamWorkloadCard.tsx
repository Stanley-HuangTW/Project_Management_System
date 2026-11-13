"use client";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { TeamWorkloadEntry, WorkloadPeriod, MemberItemWorkloadEntry } from "@/lib/dashboard";
import { getCustomWorkload } from "@/lib/actions/workload";
import { actionErrorMessage } from "@/lib/userError";
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";

const PERIOD_LABELS: Record<WorkloadPeriod, string> = {
  day: "本日",
  week: "本週",
  month: "本月",
};

type Selection = WorkloadPeriod | "custom";

const PIE_COLORS = [
  "#00c875",
  "#579bfc",
  "#fdab3d",
  "#e2445c",
  "#a25ddc",
  "#037f4c",
  "#ff642e",
  "#66ccff",
];

const FREE_TIME_COLOR = "#d1d5db";

// Remembers the card's last view (chart type / period / selected member /
// custom range) per browser, so navigating away and back doesn't reset it
// to the defaults every time.
const STORAGE_KEY = "workloadCardView";

type StoredView = {
  chartType: "bar" | "pie";
  selection: Selection;
  pieUserId: string | null;
  customFrom: string;
  customTo: string;
};

function loadStoredView(): StoredView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredView) : null;
  } catch {
    return null;
  }
}

function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle) };
}

function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function TeamWorkloadCard({
  title,
  day,
  week,
  month,
  memberItemWorkload,
}: {
  title: string;
  day: TeamWorkloadEntry[];
  week: TeamWorkloadEntry[];
  month: TeamWorkloadEntry[];
  memberItemWorkload: Record<string, Record<WorkloadPeriod, MemberItemWorkloadEntry[]>>;
}) {
  const boardId = useSearchParams().get("board") ?? undefined;

  const [selection, setSelection] = useState<Selection>(() => loadStoredView()?.selection ?? "day");
  const [customFrom, setCustomFrom] = useState(() => loadStoredView()?.customFrom ?? "");
  const [customTo, setCustomTo] = useState(() => loadStoredView()?.customTo ?? "");
  const [customResult, setCustomResult] = useState<{
    team: TeamWorkloadEntry[];
    memberItemWorkload: Record<string, MemberItemWorkloadEntry[]>;
  } | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const [chartType, setChartType] = useState<"bar" | "pie">(() => loadStoredView()?.chartType ?? "bar");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [pieUserId, setPieUserId] = useState<string | null>(() => loadStoredView()?.pieUserId ?? null);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ chartType, selection, pieUserId, customFrom, customTo })
      );
    } catch {
      // localStorage unavailable (private browsing, etc.) — the view just won't persist.
    }
  }, [chartType, selection, pieUserId, customFrom, customTo]);

  // Restore a remembered custom range's result once on mount, so returning
  // to the dashboard with "自訂" already selected shows data immediately
  // instead of the "請選擇日期區間並按查詢" placeholder.
  const didAutoFetchCustom = useRef(false);
  useEffect(() => {
    if (didAutoFetchCustom.current) return;
    didAutoFetchCustom.current = true;
    if (selection !== "custom" || !customFrom || !customTo) return;
    let cancelled = false;
    (async () => {
      setCustomLoading(true);
      try {
        const result = await getCustomWorkload(customFrom, customTo, boardId);
        if (!cancelled) setCustomResult(result);
      } catch (err) {
        if (!cancelled) setCustomError(actionErrorMessage(err, "查詢失敗"));
      } finally {
        if (!cancelled) setCustomLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selection, customFrom, customTo, boardId]);

  const isCustom = selection === "custom";
  const data = isCustom ? (customResult?.team ?? []) : { day, week, month }[selection];
  const isEmpty = data.every((e) => e.avgPct === 0);
  const selectedPieUserId = pieUserId ?? data[0]?.userId ?? null;
  const pieEntries = selectedPieUserId
    ? isCustom
      ? (customResult?.memberItemWorkload[selectedPieUserId] ?? [])
      : (memberItemWorkload[selectedPieUserId]?.[selection] ?? [])
    : [];
  const pieAllocatedPct = pieEntries.reduce((sum, e) => sum + e.avgPct, 0);
  const pieFreePct = Math.max(0, 100 - pieAllocatedPct);
  const pieDenominator = pieAllocatedPct + pieFreePct;
  const expandedItems = isCustom
    ? (expandedUserId ? (customResult?.memberItemWorkload[expandedUserId] ?? []) : [])
    : (expandedUserId ? (memberItemWorkload[expandedUserId]?.[selection] ?? []) : []);

  function toggleExpanded(userId: string) {
    setExpandedUserId((prev) => (prev === userId ? null : userId));
  }

  async function applyCustomRange() {
    if (!customFrom || !customTo) return;
    setCustomLoading(true);
    setCustomError(null);
    try {
      setCustomResult(await getCustomWorkload(customFrom, customTo, boardId));
    } catch (err) {
      setCustomError(actionErrorMessage(err, "查詢失敗"));
    } finally {
      setCustomLoading(false);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-100">{title}</h2>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 text-xs">
            {(["bar", "pie"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setChartType(t)}
                className={`px-2.5 py-1 ${
                  chartType === t
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                    : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                }`}
              >
                {t === "bar" ? "長條圖" : "圓餅圖"}
              </button>
            ))}
          </div>
          <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700 text-xs">
            {(Object.keys(PERIOD_LABELS) as WorkloadPeriod[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelection(p)}
                className={`px-2.5 py-1 ${
                  selection === p
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                    : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setSelection("custom")}
              className={`px-2.5 py-1 ${
                isCustom ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900" : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              自訂
            </button>
          </div>
        </div>
      </div>

      {isCustom && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <input
            type="date"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 outline-none focus:border-blue-500"
          />
          <DateWeekdayHint value={customFrom} />
          <span className="text-neutral-400 dark:text-neutral-500">~</span>
          <input
            type="date"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 outline-none focus:border-blue-500"
          />
          <DateWeekdayHint value={customTo} />
          <button
            type="button"
            disabled={customLoading || !customFrom || !customTo}
            onClick={applyCustomRange}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {customLoading ? "查詢中..." : "查詢"}
          </button>
          {customError && <span className="text-xs text-red-600">{customError}</span>}
        </div>
      )}
      {isEmpty ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          {isCustom && !customResult
            ? "請選擇日期區間並按「查詢」。"
            : "尚無看板設定「開始日期欄位」與「天數欄位」,或此期間沒有任何人員分配。"}
        </p>
      ) : chartType === "bar" ? (
        <div className="space-y-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
          {data.map((entry) => (
            <button
              key={entry.userId}
              type="button"
              onClick={() => toggleExpanded(entry.userId)}
              className="flex w-full items-center gap-3 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <span className="w-20 shrink-0 truncate text-sm text-neutral-700 dark:text-neutral-100">
                {entry.userName}
              </span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, entry.avgPct)}%`,
                    backgroundColor: entry.avgPct > 100 ? "#e2445c" : "#00c875",
                  }}
                />
              </div>
              <span
                className={`w-12 shrink-0 text-right text-sm ${
                  entry.avgPct > 100 ? "font-medium text-red-600" : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                {entry.avgPct}%
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-4">
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-neutral-500 dark:text-neutral-400">成員</span>
            <SearchableSelect
              options={data.map((entry) => ({ value: entry.userId, label: entry.userName }))}
              value={selectedPieUserId ?? ""}
              onChange={setPieUserId}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
            />
          </div>
          {pieEntries.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500">此成員在所選期間沒有任何指派中的任務。</p>
          ) : (
            <div className="flex flex-wrap items-center gap-6">
              <svg viewBox="0 0 120 120" width={140} height={140} className="shrink-0">
                {(() => {
                  let cumulative = 0;
                  const slices = pieFreePct > 0
                    ? [...pieEntries, { itemId: "__free__", avgPct: pieFreePct, free: true }]
                    : pieEntries;
                  return slices.map((entry, i) => {
                    const fraction = pieDenominator > 0 ? entry.avgPct / pieDenominator : 0;
                    const startAngle = cumulative * 2 * Math.PI;
                    cumulative += fraction;
                    const endAngle = cumulative * 2 * Math.PI;
                    const color = "free" in entry ? FREE_TIME_COLOR : PIE_COLORS[i % PIE_COLORS.length];
                    if (fraction >= 0.999) {
                      return <circle key={entry.itemId} cx={60} cy={60} r={55} fill={color} />;
                    }
                    return (
                      <path
                        key={entry.itemId}
                        d={pieSlicePath(60, 60, 55, startAngle, endAngle)}
                        fill={color}
                      />
                    );
                  });
                })()}
              </svg>
              <div className="min-w-[240px] flex-1 space-y-1.5">
                {pieEntries.map((entry, i) => (
                  <div key={entry.itemId} className="flex items-center gap-2 px-1 py-0.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                    />
                    <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{entry.boardName}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-700 dark:text-neutral-100">
                      {entry.itemName}
                    </span>
                    <span className="shrink-0 text-sm text-neutral-500 dark:text-neutral-400">{entry.avgPct}%</span>
                  </div>
                ))}
                {pieFreePct > 0 && (
                  <div className="flex items-center gap-2 px-1 py-0.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: FREE_TIME_COLOR }}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-neutral-500 dark:text-neutral-400">空閒時間</span>
                    <span className="shrink-0 text-sm text-neutral-500 dark:text-neutral-400">{pieFreePct}%</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {chartType === "bar" && expandedUserId && (
        <div className="mt-2 overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 dark:bg-neutral-800 text-xs text-neutral-500 dark:text-neutral-400">
              <tr>
                <th className="px-3 py-1.5 text-left font-medium">工作專案</th>
                <th className="px-3 py-1.5 text-left font-medium">工作事項</th>
                <th className="px-3 py-1.5 text-right font-medium">占比</th>
              </tr>
            </thead>
            <tbody>
              {expandedItems.map((t) => (
                <tr key={`${t.boardId}-${t.itemId}`} className="border-t border-neutral-100 dark:border-neutral-700">
                  <td className="px-3 py-1.5 text-neutral-600 dark:text-neutral-400">{t.boardName}</td>
                  <td className="px-3 py-1.5 text-neutral-800 dark:text-neutral-100">{t.itemName}</td>
                  <td className="px-3 py-1.5 text-right text-neutral-600 dark:text-neutral-400">{t.avgPct}%</td>
                </tr>
              ))}
              {expandedItems.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-2 text-center text-neutral-400 dark:text-neutral-500">
                    目前沒有指派中的任務
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
