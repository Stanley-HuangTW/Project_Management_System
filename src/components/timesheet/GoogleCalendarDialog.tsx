"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { TimesheetOptions } from "@/lib/actions/activityTime";
import {
  fetchGoogleCalendarRange,
  importGoogleCalendarEvents,
  type CalendarImportRow,
  type CalendarRangeResult,
} from "@/lib/actions/googleCalendar";
import {
  MAX_CALENDAR_RANGE_DAYS,
  SKIP_REASON_LABELS,
  calendarScopeRange,
  validateCalendarRange,
  type CalendarScope,
} from "@/lib/googleCalendar";
import { formatMinute } from "@/lib/timeOfDay";

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];
const selectClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-blue-500";

const SCOPE_LABELS: [CalendarScope, string][] = [
  ["week", "每週"],
  ["month", "每月"],
  ["range", "自訂區間"],
];

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

/** 訊息裡的 https 網址做成可以點的連結(例如啟用 Calendar API 的頁面)。 */
function linkify(text: string): React.ReactNode[] {
  return text.split(/(https:\/\/\S+)/).map((part, i) =>
    part.startsWith("https://") ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">
        {part}
      </a>
    ) : (
      part
    )
  );
}

function dayLabel(dateIso: string): string {
  return `${WEEKDAY_LABELS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()]} ${dateIso.slice(5)}`;
}

/**
 * 從 Google 日曆匯入:列出一週、一個月或自訂區間的行程,勾選要匯入的,每筆可以選類別與對應專案,確認後才建立工時。
 * 「每週」是行事曆正在看的那一週,「每月」是那一週所在的月份。已經匯入過的不會重複建立;日曆上改了時間的會標出來,可以只更新時間。
 */
export function GoogleCalendarDialog({
  open,
  onClose,
  weekStart,
  options,
  onAuthorize,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  weekStart: string;
  options: TimesheetOptions | null;
  /** 帶使用者去 Google 授權(整頁跳轉,回來後會重新開啟這個視窗)。forceConsent = 強制再顯示一次同意畫面。 */
  onAuthorize: (forceConsent?: boolean) => void;
  onImported: () => void;
}) {
  const { notify } = useDialogs();
  const [result, setResult] = useState<CalendarRangeResult | null>(null);
  const [scope, setScope] = useState<CalendarScope>("week");
  const [customFrom, setCustomFrom] = useState(weekStart);
  const [customTo, setCustomTo] = useState(() => calendarScopeRange("week", weekStart).to);
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [categoryOf, setCategoryOf] = useState<Record<string, string>>({});
  const [boardOf, setBoardOf] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const defaultCategoryId = options?.categories.find((c) => c.name === "例行會議")?.id ?? options?.categories[0]?.id ?? "";

  // 每次打開:回到「每週」,自訂區間預設是正在看的那一週。
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
    // 開啟(或換區間、重試)時重新抓,先回到載入中。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResult(null);
    (async () => {
      try {
        const r = await fetchGoogleCalendarRange(range.from, range.to);
        if (cancelled) return;
        setResult(r);
        if (r.status === "ok") {
          // 預設勾選:能匯入、而且還沒匯入(或時間有變)的。
          setSelected(new Set(r.rows.filter((x) => x.skip === null && x.state !== "imported").map((x) => x.externalId)));
          setCategoryOf({});
          setBoardOf({});
        }
      } catch (err) {
        if (!cancelled) setResult({ status: "error", message: err instanceof Error ? err.message : "讀取失敗" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, range.from, range.to, rangeError, reloadKey]);

  // 區間不合法時,上一個區間的行程不能留在清單與匯入按鈕上。
  const rows = useMemo(() => (!rangeError && result?.status === "ok" ? result.rows : []), [result, rangeError]);
  const importable = rows.filter((r) => r.skip === null && r.state !== "imported");
  const chosen = importable.filter((r) => selected.has(r.externalId));
  const skipped = rows.filter((r) => r.skip !== null);

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runImport() {
    setBusy(true);
    try {
      const response = await importGoogleCalendarEvents(
        chosen.map((r) => ({
          externalId: r.externalId,
          title: r.title,
          date: r.date,
          startMinute: r.startMinute,
          hours: r.hours,
          categoryId: categoryOf[r.externalId] || defaultCategoryId,
          boardId: boardOf[r.externalId] || null,
        }))
      );
      if ("error" in response) {
        await notify(response.error, { title: "無法匯入" });
        return;
      }
      const lines = [
        [response.created > 0 ? `新增 ${response.created} 筆` : "", response.updated > 0 ? `更新 ${response.updated} 筆` : ""]
          .filter(Boolean)
          .join(",") || "沒有建立或更新任何工時",
        ...response.failed,
      ];
      await notify(lines.join("\n"), { title: "從 Google 日曆匯入" });
      if (response.created + response.updated > 0) onImported();
      if (response.failed.length === 0) onClose();
      else setReloadKey((k) => k + 1);
    } catch (err) {
      await notify(err instanceof Error ? err.message : "匯入失敗", { title: "無法匯入" });
    } finally {
      setBusy(false);
    }
  }

  function renderRow(r: CalendarImportRow) {
    const locked = r.state === "imported";
    const category = options?.categories.find((c) => c.id === (categoryOf[r.externalId] || defaultCategoryId));
    return (
      <li key={r.externalId} className="flex items-start gap-3 px-3 py-2">
        <input
          type="checkbox"
          className="mt-1"
          checked={selected.has(r.externalId)}
          disabled={locked || busy}
          onChange={() => toggle(r.externalId)}
          aria-label={`匯入 ${r.title}`}
        />
        <div className="w-36 shrink-0 text-xs tabular-nums text-neutral-600 dark:text-neutral-300">
          <div>{dayLabel(r.date)}</div>
          <div className="text-neutral-400 dark:text-neutral-500">
            {formatMinute(r.startMinute)}–{formatMinute(r.startMinute + Math.round(r.hours * 60))}・{fmt(r.hours)}h
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm text-neutral-800 dark:text-neutral-100" title={r.title}>
              {r.title}
            </span>
            {r.link && (
              <a
                href={r.link}
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-400 hover:text-blue-600 dark:text-neutral-500"
                aria-label="在 Google 日曆開啟"
              >
                <ExternalLink size={12} />
              </a>
            )}
            {r.state === "imported" && (
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                已匯入
              </span>
            )}
            {r.state === "changed" && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                已匯入,日曆上的時間改了(只更新時間)
              </span>
            )}
          </div>
          {r.state === "new" && selected.has(r.externalId) && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                value={categoryOf[r.externalId] || defaultCategoryId}
                onChange={(e) => setCategoryOf((cur) => ({ ...cur, [r.externalId]: e.target.value }))}
                className={selectClass}
                aria-label="類別"
              >
                {(options?.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {category?.allowProject && (
                <SearchableSelect
                  options={(options?.boards ?? []).map((b) => ({ value: b.id, label: b.name }))}
                  value={boardOf[r.externalId] ?? ""}
                  onChange={(v) => setBoardOf((cur) => ({ ...cur, [r.externalId]: v }))}
                  emptyLabel="不屬於專案"
                  placeholder="對應專案"
                  className={`${selectClass} min-w-[10rem]`}
                  title="對應專案的工時要核准後才計入那個專案的成本"
                />
              )}
            </div>
          )}
        </div>
      </li>
    );
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="從 Google 日曆匯入" size="xl">
      <div className="space-y-3">
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          列出 Google 日曆在這段期間的行程,勾選要匯入成工時的。只讀取行程的標題與時間;授權只暫存在瀏覽器約一小時,
          系統不保存你的 Google 帳號、密碼或憑證。
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
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={selectClass} aria-label="開始日期" />
              <span>~</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={selectClass} aria-label="結束日期" />
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
          scope === "range" && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">一次最多 {MAX_CALENDAR_RANGE_DAYS} 天(約三個月)。</p>
          )
        )}

        {!rangeError && result === null && (
          <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">讀取 Google 日曆中...</p>
        )}

        {!rangeError && result?.status === "needsAuth" && (
          <div className="rounded-md bg-neutral-50 p-4 text-sm text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-200">
            <p className="mb-3">要先連結你的 Google 日曆(唯讀)。會跳到 Google 的同意畫面,同意後自動回到這裡。</p>
            <button
              type="button"
              onClick={() => onAuthorize()}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <CalendarDays size={14} /> 連結 Google 日曆
            </button>
          </div>
        )}

        {!rangeError && result?.status === "notConfigured" && (
          <p className="rounded-md bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
            伺服器還沒設定 Google 登入(GOOGLE_CLIENT_ID),請管理者先設定。
          </p>
        )}

        {!rangeError && result?.status === "error" && (
          <div className="rounded-md bg-red-50 p-4 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            <p className="mb-2 break-words">{linkify(result.message)}</p>
            {result.reauthorize ? (
              <button
                type="button"
                onClick={() => onAuthorize(true)}
                className="rounded-md border border-red-300 px-3 py-1 text-xs hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
              >
                重新連結 Google 日曆
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setReloadKey((k) => k + 1)}
                className="rounded-md border border-red-300 px-3 py-1 text-xs hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900"
              >
                重試
              </button>
            )}
          </div>
        )}

        {!rangeError && result?.status === "ok" && (
          <>
            {result.truncated && (
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                這段期間的行程太多,只列出前面的 {rows.length} 個。請縮小區間(例如改成每週)再匯入剩下的。
              </p>
            )}
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-400 dark:text-neutral-500">這段期間在 Google 日曆上沒有行程。</p>
            ) : (
              <>
                <div className="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
                  <button
                    type="button"
                    onClick={() => setSelected(new Set(importable.map((r) => r.externalId)))}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    全選
                  </button>
                  <button type="button" onClick={() => setSelected(new Set())} className="text-blue-600 hover:underline dark:text-blue-400">
                    清除
                  </button>
                  <span>
                    共 {rows.length} 個行程,可匯入 {importable.length} 個,已勾選 {chosen.length} 個
                  </span>
                </div>
                <ul className="max-h-[50vh] divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
                  {rows.filter((r) => r.skip === null).map(renderRow)}
                </ul>
                {skipped.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                    {skipped.map((r) => (
                      <li key={r.externalId}>
                        {dayLabel(r.date)} {r.title}:{SKIP_REASON_LABELS[r.skip!]}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            disabled={busy || chosen.length === 0 || !options}
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
        </div>
      </div>
    </Modal>
  );
}
