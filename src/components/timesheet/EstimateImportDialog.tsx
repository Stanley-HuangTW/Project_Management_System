"use client";

import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  importWorkItemEstimates,
  listEstimateImport,
  type EstimateImportList,
  type EstimateImportListRow,
} from "@/lib/actions/estimateImport";
import { MAX_CALENDAR_RANGE_DAYS, calendarScopeRange, validateCalendarRange, type CalendarScope } from "@/lib/googleCalendar";

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500";

const SCOPE_LABELS: [CalendarScope, string][] = [
  ["week", "每週"],
  ["month", "每月"],
  ["range", "自訂區間"],
];

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

function dayLabel(dateIso: string): string {
  return `${WEEKDAY_LABELS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()]} ${dateIso.slice(5)}`;
}

/**
 * 從工作項預估匯入工時:列出指派給你的工作項每一天的預估(配置比例 × 每日工時),勾選要匯入的;
 * 實際時數預設就是預估,可以直接改成實際花的時間——匯入後工時會記著「原預估」,並排顯示預估與實際。
 * 今天以後的日子預設不勾(還沒發生);這一天這個工作項已經登記過的不能重複匯入。
 */
export function EstimateImportDialog({
  open,
  onClose,
  weekStart,
  today,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  /** 行事曆正在看的那一週的週一。 */
  weekStart: string;
  today: string;
  onImported: () => void;
}) {
  const { notify } = useDialogs();
  const [scope, setScope] = useState<CalendarScope>("week");
  const [customFrom, setCustomFrom] = useState(weekStart);
  const [customTo, setCustomTo] = useState(() => calendarScopeRange("week", weekStart).to);
  const [result, setResult] = useState<EstimateImportList | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** 使用者改過的實際時數;沒改就是預估。 */
  const [hoursText, setHoursText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setScope("week");
    setCustomFrom(weekStart);
    setCustomTo(calendarScopeRange("week", weekStart).to);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [open, weekStart]);

  const range = scope === "range" ? { from: customFrom, to: customTo } : calendarScopeRange(scope, weekStart);
  const rangeError = validateCalendarRange(range.from, range.to);

  useEffect(() => {
    if (!open || rangeError) return;
    let cancelled = false;
    // 開啟(或換區間)時重新抓,先回到載入中。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    (async () => {
      try {
        const r = await listEstimateImport(range.from, range.to);
        if (cancelled) return;
        setResult(r);
        if (r.status === "ok") {
          setSelected(new Set(r.rows.filter((x) => x.state === "new" && x.date <= today).map((x) => x.key)));
          setHoursText({});
        }
      } catch (err) {
        if (!cancelled) setResult({ status: "error", message: err instanceof Error ? err.message : "讀取失敗" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, range.from, range.to, rangeError, reloadKey, today]);

  const rows = useMemo(() => (!rangeError && result?.status === "ok" ? result.rows : []), [result, rangeError]);
  const importable = rows.filter((r) => r.state === "new");
  const chosen = importable.filter((r) => selected.has(r.key));
  const actualOf = (r: EstimateImportListRow) => {
    const n = Number(hoursText[r.key] ?? r.estimateHours);
    return Number.isFinite(n) ? n : 0;
  };
  const sumEstimate = chosen.reduce((s, r) => s + r.estimateHours, 0);
  const sumActual = chosen.reduce((s, r) => s + actualOf(r), 0);
  const invalidChosen = chosen.filter((r) => !(actualOf(r) > 0 && actualOf(r) <= 24));

  const byDate = useMemo(() => {
    const map = new Map<string, EstimateImportListRow[]>();
    for (const r of rows) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return [...map.entries()];
  }, [rows]);

  function toggle(key: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function runImport() {
    setBusy(true);
    try {
      const response = await importWorkItemEstimates(chosen.map((r) => ({ itemId: r.itemId, date: r.date, hours: actualOf(r) })));
      if ("error" in response) {
        await notify(response.error, { title: "無法匯入" });
        return;
      }
      const lines = [
        [response.created > 0 ? `新增 ${response.created} 筆工時` : "", response.skipped > 0 ? `略過 ${response.skipped} 筆(已經登記過)` : ""]
          .filter(Boolean)
          .join(",") || "沒有建立任何工時",
        ...response.failed,
      ];
      await notify(lines.join("\n"), { title: "從工作項預估匯入" });
      if (response.created > 0) onImported();
      if (response.failed.length === 0) onClose();
      else setReloadKey((k) => k + 1);
    } catch (err) {
      await notify(err instanceof Error ? err.message : "匯入失敗", { title: "無法匯入" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="從工作項預估匯入工時" size="xl">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          列出指派給你的工作項<b>每一天的預估</b>(配置比例 × 每日工時,只在工作項起訖之間的工作日)。勾選要匯入的;
          <b>實際時數預設就是預估</b>,可以直接改成你實際花的時間,匯入後工時會記著原預估,並排顯示預估與實際。
          今天以後的日子預設不勾;這一天這個工作項已經登記過的不能重複匯入。
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-neutral-200 text-xs dark:border-neutral-700" role="group" aria-label="匯入的範圍">
            {SCOPE_LABELS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                aria-pressed={scope === key}
                disabled={busy}
                className={`px-3 py-1 ${
                  scope === key
                    ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                    : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {scope === "range" ? (
            <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={inputClass} aria-label="開始日期" />
              <span>~</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={inputClass} aria-label="結束日期" />
            </div>
          ) : (
            <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              {range.from} ~ {range.to}
            </span>
          )}
        </div>
        {rangeError ? (
          <p className="text-xs text-red-600 dark:text-red-400">{rangeError}</p>
        ) : (
          scope === "range" && <p className="text-xs text-neutral-400 dark:text-neutral-500">一次最多 {MAX_CALENDAR_RANGE_DAYS} 天(約三個月)。</p>
        )}

        {!rangeError && result === null && <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">讀取預估中...</p>}
        {!rangeError && result?.status === "error" && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="mb-2">{result.message}</p>
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className="rounded-md border border-red-300 px-3 py-1 text-xs hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
            >
              重試
            </button>
          </div>
        )}

        {!rangeError && result?.status === "ok" && (
          <>
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
                這段期間沒有可以匯入的預估:沒有指派給你(而且有排程)的工作項落在這段期間的工作日。
              </p>
            ) : (
              <>
                <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                  <button type="button" onClick={() => setSelected(new Set(importable.map((r) => r.key)))} className="text-blue-600 hover:underline dark:text-blue-400">
                    全選
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(importable.filter((r) => r.date <= today).map((r) => r.key)))}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    只選今天以前
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} className="text-blue-600 hover:underline dark:text-blue-400">
                    清除
                  </button>
                  <span>
                    共 {rows.length} 筆,可匯入 {importable.length} 筆,已勾選 {chosen.length} 筆
                  </span>
                </div>
                <div className="max-h-[50vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-neutral-50 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      <tr>
                        <th className="w-8 px-2 py-1.5" />
                        <th className="px-2 py-1.5 text-left font-medium">工作項</th>
                        <th className="px-2 py-1.5 text-right font-medium">原預估(小時)</th>
                        <th className="px-2 py-1.5 text-right font-medium">實際(小時)</th>
                        <th className="px-2 py-1.5" />
                      </tr>
                    </thead>
                    <tbody>
                      {byDate.map(([date, dayRows]) => (
                        <FragmentRows key={date} date={date} dayRows={dayRows} today={today} selected={selected} busy={busy} hoursText={hoursText} setHoursText={setHoursText} toggle={toggle} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            disabled={busy || chosen.length === 0 || invalidChosen.length > 0}
            onClick={runImport}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "匯入中..." : chosen.length > 0 ? `匯入 ${chosen.length} 筆` : "匯入"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            關閉
          </button>
          {chosen.length > 0 && (
            <span className="text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
              原預估 {fmt(sumEstimate)} 小時 → 實際 {fmt(sumActual)} 小時
              {invalidChosen.length > 0 && <span className="ml-2 text-red-600 dark:text-red-400">有 {invalidChosen.length} 筆實際時數不對(要大於 0、不超過 24)</span>}
            </span>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** 一天的幾列:先是日期那一列(合計),再是各工作項。 */
function FragmentRows({
  date,
  dayRows,
  today,
  selected,
  busy,
  hoursText,
  setHoursText,
  toggle,
}: {
  date: string;
  dayRows: EstimateImportListRow[];
  today: string;
  selected: Set<string>;
  busy: boolean;
  hoursText: Record<string, string>;
  setHoursText: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  toggle: (key: string) => void;
}) {
  const future = date > today;
  return (
    <>
      <tr className="bg-neutral-50/70 dark:bg-neutral-800/40">
        <td colSpan={5} className="px-2 py-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
          {dayLabel(date)}
          {date === today && <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">今天</span>}
          {future && <span className="ml-1.5 text-[10px] font-normal text-neutral-400 dark:text-neutral-500">還沒到</span>}
        </td>
      </tr>
      {dayRows.map((r) => {
        const locked = r.state === "logged";
        return (
          <tr key={r.key} className="border-t border-neutral-100 dark:border-neutral-800">
            <td className="px-2 py-1 text-center">
              <input type="checkbox" checked={selected.has(r.key)} disabled={locked || busy} onChange={() => toggle(r.key)} aria-label={`匯入 ${dayLabel(r.date)} ${r.itemName}`} />
            </td>
            <td className="px-2 py-1">
              <div className="truncate text-neutral-800 dark:text-neutral-100" title={r.itemName}>
                {r.itemName}
              </div>
              <div className="truncate text-[10px] text-neutral-400 dark:text-neutral-500">{r.boardName}</div>
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-neutral-600 dark:text-neutral-300">{fmt(r.estimateHours)}</td>
            <td className="px-2 py-1 text-right">
              {locked ? (
                <span className="tabular-nums text-neutral-400 dark:text-neutral-500">{fmt(r.loggedHours ?? 0)}</span>
              ) : (
                <input
                  type="number"
                  min={0.25}
                  max={24}
                  step={0.25}
                  value={hoursText[r.key] ?? String(r.estimateHours)}
                  onChange={(e) => setHoursText((cur) => ({ ...cur, [r.key]: e.target.value }))}
                  disabled={busy}
                  className={`${inputClass} w-20 text-right tabular-nums`}
                  aria-label={`${dayLabel(r.date)} ${r.itemName} 的實際時數`}
                />
              )}
            </td>
            <td className="px-2 py-1 text-[10px] text-neutral-400 dark:text-neutral-500">{locked ? "已登記" : ""}</td>
          </tr>
        );
      })}
    </>
  );
}
