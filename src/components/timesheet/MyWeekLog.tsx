"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Copy, LayoutTemplate, ListChecks } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  deleteActivityTime,
  getTimesheetOptions,
  listMyWeek,
  logActivityTime,
  updateActivityTime,
  type MyWeek,
  type TimesheetOptions,
} from "@/lib/actions/activityTime";
import { deleteTimeEntry, logTime, updateTimeEntry } from "@/lib/actions/timeEntry";
import { copyPreviousWeek } from "@/lib/actions/timeTemplate";
import { createRecurringEntries, deleteSeriesFrom } from "@/lib/actions/recurringTime";
import { describeApplyResult } from "@/lib/timeTemplates";
import { addDaysIso, isValidIsoDate } from "@/lib/timesheet";
import { explainGoogleAuthFailure } from "@/lib/googleCalendar";
import { isoWeekLabel, weekRangeOf } from "@/lib/weeklyReport";
import { EntryDialog, type EntryDialogTarget, type EntryDraft } from "./EntryDialog";
import { GoogleCalendarDialog } from "./GoogleCalendarDialog";
import { TemplateDialog, type TemplatePrefill } from "./TemplateDialog";
import { EstimateImportDialog } from "./EstimateImportDialog";
import { EstimatePanel } from "./EstimatePanel";
import { WeekCalendar } from "./WeekCalendar";
import { getMyEstimates } from "@/lib/actions/timesheetEstimate";
import type { EstimateWeek } from "@/lib/timesheetEstimate";
import { dayTotalHours, eventsOfWeek, moveEventInWeek, type CalendarEvent } from "./timesheetEvents";
import { actionErrorMessage } from "@/lib/userError";

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

/** 工時頁「我的工時」:週行事曆。點/拖出時段新增、點一筆開啟編輯、拖曳換時間換天、拖下緣改時數。 */
export function MyWeekLog({ today }: { today: string }) {
  const { notify, confirm } = useDialogs();
  const [weekStart, setWeekStart] = useState(() => weekRangeOf(today).weekStart);
  const [loaded, setLoaded] = useState<MyWeek | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [options, setOptions] = useState<TimesheetOptions | null>(null);
  const [dialog, setDialog] = useState<EntryDialogTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templatePrefill, setTemplatePrefill] = useState<TemplatePrefill | null>(null);
  const [gcalOpen, setGcalOpen] = useState(false);
  const [estimateImportOpen, setEstimateImportOpen] = useState(false);
  const [estimates, setEstimates] = useState<{ weekStart: string; data: EstimateWeek | { error: string } } | null>(null);

  // 從 Google 授權頁回來:回到原本看的那一週,成功就重新打開匯入視窗,失敗說一聲。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("googleCalendarAuth");
    if (!status) return;
    const reason = params.get("googleAuthReason");
    const detail = params.get("googleAuthDetail");
    const uri = params.get("googleAuthUri");
    for (const key of ["googleCalendarAuth", "googleAuthReason", "googleAuthDetail", "googleAuthUri"]) params.delete(key);
    const search = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (search ? `?${search}` : ""));
    const savedWeek = sessionStorage.getItem("gcalReturnWeek");
    sessionStorage.removeItem("gcalReturnWeek");
    // 反應的是瀏覽器剛從 OAuth 跳轉回來這件事,不是 React 狀態的變化。
    /* eslint-disable react-hooks/set-state-in-effect */
    if (savedWeek && isValidIsoDate(savedWeek)) setWeekStart(weekRangeOf(savedWeek).weekStart);
    if (status === "success") setGcalOpen(true);
    else void notify(explainGoogleAuthFailure(reason, detail, uri), { title: "無法連結 Google 日曆" });
    /* eslint-enable react-hooks/set-state-in-effect */
    // 只在載入時處理一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listMyWeek(weekStart);
      if (!cancelled && !("error" in result)) setLoaded(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart, refreshKey]);

  // 預估只跟著週變(改工時不會改預估);實際直接取自畫面上這一週的登記。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyEstimates(weekStart);
        if (!cancelled) setEstimates({ weekStart, data });
      } catch {
        if (!cancelled) setEstimates({ weekStart, data: { error: "讀取失敗,請重新整理後再試一次。" } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await getTimesheetOptions();
      if (!cancelled) setOptions(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loading = !loaded || loaded.weekStart !== weekStart;
  const week = loading ? null : loaded;
  const events = useMemo(() => (week ? eventsOfWeek(week) : []), [week]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)), [weekStart]);
  const weekEnd = days[6];
  const weekTotal = days.reduce((sum, d) => sum + dayTotalHours(events, d), 0);
  const weekEstimate = estimates && estimates.weekStart === weekStart ? estimates.data : null;
  const estimateByDay = useMemo(() => {
    if (!weekEstimate || "error" in weekEstimate) return undefined;
    const out: Record<string, { labour: number; work: number }> = {};
    for (const d of days) {
      out[d] = {
        labour: weekEstimate.projects.reduce((s, p) => s + (p.labour[d] ?? 0), 0),
        work: weekEstimate.projects.reduce((s, p) => s + p.items.reduce((t, i) => t + (i.hours[d] ?? 0), 0), 0),
      };
    }
    return out;
  }, [weekEstimate, days]);
  const currentWeekStart = weekRangeOf(today).weekStart;

  function goToWeek(next: string) {
    setDialog(null);
    setWeekStart(next);
  }

  function reload() {
    setRefreshKey((k) => k + 1);
  }

  /** 把一筆行事曆上的工時改成新的日期/開始時間/時數,存到伺服器。 */
  function saveChange(
    event: CalendarEvent,
    change: { date: string; startMinute: number | null; hours: number },
    note: string = (event.project ?? event.activity)?.note ?? ""
  ): Promise<{ error?: string }> {
    if (event.project) {
      return updateTimeEntry(event.id, { itemId: event.project.itemId, note, ...change });
    }
    const a = event.activity!;
    return updateActivityTime(event.id, {
      categoryId: a.categoryId,
      riskEntryId: a.riskEntryId,
      boardId: a.boardId,
      note,
      ...change,
    });
  }

  /** 拖曳或拉長:先在畫面上套用,存到伺服器後重新讀取(失敗也重新讀取,畫面就回到原樣)。 */
  async function changeOnCalendar(event: CalendarEvent, change: { date: string; startMinute: number | null; hours: number }) {
    // 已核准、會計入成本的工時,改了日期或時數就得重新送審(免審核的人除外,但這邊看不出來,所以照實說明)。
    const affectsCost = change.date !== event.date || change.hours !== event.hours;
    if (event.status === "APPROVED" && event.needsApproval && affectsCost) {
      const ok = await confirm("這筆工時已經核准,改了日期或時數後會重新送審(免審核的人除外),核准前不會計入成本。確定要改嗎?", {
        title: "修改已核准的工時",
        confirmLabel: "確定修改",
      });
      if (!ok) return;
    }
    if (week) setLoaded(moveEventInWeek(week, event, change));
    setBusy(true);
    try {
      const result = await saveChange(event, change);
      if (result.error) await notify(result.error, { title: "無法修改" });
    } catch (err) {
      await notify(actionErrorMessage(err, "修改失敗"), { title: "無法修改" });
    } finally {
      setBusy(false);
      reload();
    }
  }

  /** 對話框儲存:回傳錯誤訊息就留在對話框。 */
  async function saveFromDialog(draft: EntryDraft, editing: CalendarEvent | null): Promise<string | null> {
    // 新增時選了「重複」:一次建立一批。
    if (!editing && draft.repeat) {
      const result = await createRecurringEntries({
        spec:
          draft.kind === "project"
            ? { kind: "project", itemId: draft.itemId, startMinute: draft.startMinute, hours: draft.hours, note: draft.note }
            : {
                kind: "activity",
                categoryId: draft.categoryId,
                boardId: draft.boardId || null,
                riskEntryId: draft.riskEntryId || null,
                startMinute: draft.startMinute,
                hours: draft.hours,
                note: draft.note,
              },
        startDate: draft.date,
        rule: draft.repeat.rule,
        until: draft.repeat.until,
        label: draft.kind === "project" ? "專案工作項" : (options?.categories.find((c) => c.id === draft.categoryId)?.name ?? "工時"),
      });
      if ("error" in result) return result.error;
      // 一筆都沒建、而且不是因為「本來就有」:全部都失敗,留在對話框讓使用者改。
      if (result.created === 0 && result.existing === 0 && result.failed.length > 0) return result.failed.join("\n");
      setDialog(null);
      reload();
      // 有略過或失敗的要說清楚,不然使用者以為整批都建好了。
      if (result.failed.length > 0 || result.existing > 0) {
        await notify([describeApplyResult(result), ...result.failed].join("\n"), { title: "重複登記" });
      }
      return null;
    }
    let error: string | undefined;
    if (draft.kind === "project") {
      error = editing
        ? (
            await updateTimeEntry(editing.id, {
              itemId: draft.itemId,
              date: draft.date,
              hours: draft.hours,
              note: draft.note,
              startMinute: draft.startMinute,
            })
          ).error
        : (await logTime(draft.itemId, draft.date, draft.hours, draft.note, undefined, draft.startMinute)).error;
    } else {
      const input = {
        date: draft.date,
        hours: draft.hours,
        categoryId: draft.categoryId,
        note: draft.note,
        riskEntryId: draft.riskEntryId || null,
        boardId: draft.boardId || null,
        startMinute: draft.startMinute,
      };
      error = editing ? (await updateActivityTime(editing.id, input)).error : (await logActivityTime(input)).error;
    }
    if (error) return error;
    setDialog(null);
    // 存到不在這一週的日期,就跟著跳過去,不然新增的那筆看起來像不見了。
    const targetWeek = weekRangeOf(draft.date).weekStart;
    if (targetWeek !== weekStart) setWeekStart(targetWeek);
    else reload();
    return null;
  }

  /** 這筆工時存成範本:關掉編輯對話框,打開範本對話框並帶入這筆的內容。 */
  function saveAsTemplate(event: CalendarEvent) {
    const weekday = ((new Date(`${event.date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    setTemplatePrefill({
      name: event.title,
      kind: event.kind,
      categoryId: event.activity?.categoryId ?? "",
      itemId: event.project?.itemId ?? "",
      boardId: event.activity?.boardId ?? "",
      startMinute: event.startMinute,
      hours: event.hours,
      note: (event.project ?? event.activity)?.note ?? "",
      weekday,
    });
    setDialog(null);
    setTemplateOpen(true);
  }

  function authorizeGoogleCalendar(forceConsent = false) {
    sessionStorage.setItem("gcalReturnWeek", weekStart);
    // 要整頁跳轉,瀏覽器才會真的走完到 Google 再回來的轉址。
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/api/auth/google/calendar/start?returnTo=${encodeURIComponent(window.location.pathname)}${forceConsent ? "&consent=1" : ""}`;
  }

  async function copyLastWeek() {
    const ok = await confirm(
      `把上一週(${addDaysIso(weekStart, -7)} 起)的工時複製到這週?同一個星期、同一個時間,已經有一樣的會略過。專案工時與對應專案的會議複製後要重新核准。`,
      { title: "複製上週", confirmLabel: "複製" }
    );
    if (!ok) return;
    setBusy(true);
    try {
      const result = await copyPreviousWeek(weekStart);
      if ("error" in result) {
        await notify(result.error, { title: "無法複製" });
        return;
      }
      const empty = result.created === 0 && result.existing === 0 && result.failed.length === 0;
      const lines = [empty ? "上週沒有可以複製的工時" : describeApplyResult(result), ...result.failed];
      await notify(lines.join("\n"), { title: "複製上週" });
      if (result.created > 0) reload();
    } catch (err) {
      await notify(actionErrorMessage(err, "複製失敗"), { title: "無法複製" });
    } finally {
      setBusy(false);
    }
  }

  async function deleteSeriesFromDialog(event: CalendarEvent) {
    const ok = await confirm(
      "確定要刪除「" + event.title + "」這一筆,以及它之後(" + event.date + " 起)同一批用「重複」建立的工時嗎?",
      { title: "刪除重複的工時", confirmLabel: "刪除", danger: true }
    );
    if (!ok) return;
    try {
      const result = await deleteSeriesFrom(event.kind, event.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除" });
        return;
      }
      setDialog(null);
      reload();
      await notify("已刪除 " + result.deleted + " 筆。", { title: "刪除重複的工時" });
    } catch (err) {
      await notify(actionErrorMessage(err, "刪除失敗"), { title: "無法刪除" });
    }
  }

  async function deleteFromDialog(event: CalendarEvent) {
    const ok = await confirm(`確定要刪除「${event.title}」這筆工時嗎?`, {
      title: "刪除工時",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    try {
      const result = await (event.kind === "project" ? deleteTimeEntry(event.id) : deleteActivityTime(event.id));
      if (result.error) {
        await notify(result.error, { title: "無法刪除" });
        return;
      }
      setDialog(null);
      reload();
    } catch (err) {
      await notify(actionErrorMessage(err, "刪除失敗"), { title: "無法刪除" });
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => goToWeek(addDaysIso(weekStart, -7))}
          className="rounded-md border border-neutral-300 p-1.5 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          aria-label="上一週"
        >
          <ChevronLeft size={14} />
        </button>
        <div className="min-w-[11rem] text-center">
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{isoWeekLabel(weekStart)}</div>
          <div className="text-[11px] text-neutral-400 dark:text-neutral-500">
            {weekStart} ~ {weekEnd}
          </div>
        </div>
        <button
          type="button"
          onClick={() => goToWeek(addDaysIso(weekStart, 7))}
          className="rounded-md border border-neutral-300 p-1.5 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          aria-label="下一週"
        >
          <ChevronRight size={14} />
        </button>
        {weekStart !== currentWeekStart && (
          <button
            type="button"
            onClick={() => goToWeek(currentWeekStart)}
            className="rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          >
            回到本週
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setTemplatePrefill(null);
            setTemplateOpen(true);
          }}
          className="ml-2 flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          title="例行會議等重複的工時,存成範本一次套用"
        >
          <LayoutTemplate size={13} /> 範本
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={copyLastWeek}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          title="把上一週的工時複製到這週"
        >
          <Copy size={13} /> 複製上週
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEstimateImportOpen(true)}
          className="flex items-center gap-1 rounded-md border border-blue-300 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
          title="用指派給你的工作項的每日預估當工時,實際時數預設就是預估,可以再改成實際花的時間"
        >
          <ListChecks size={13} /> 匯入預估
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setGcalOpen(true)}
          className="flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
          title="把 Google 日曆的行程匯入成工時(可選每週、每月或自訂區間)"
        >
          <CalendarDays size={13} /> Google 日曆
        </button>
        <span className="ml-auto text-sm text-neutral-600 dark:text-neutral-300">
          本週合計 <span className="font-semibold tabular-nums">{fmt(weekTotal)}</span> 小時
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <>
          <WeekCalendar
            days={days}
            events={events}
            today={today}
            busy={busy}
            estimateByDay={estimateByDay}
            onCreate={(slot) => setDialog({ mode: "new", ...slot })}
            onOpen={(event) => setDialog({ mode: "edit", event })}
            onMove={(event, to) => changeOnCalendar(event, { ...to, hours: event.hours })}
            onResize={(event, hours) => changeOnCalendar(event, { date: event.date, startMinute: event.startMinute, hours })}
          />
          <p className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
            點一下或拖出一段時間新增;拖曳整塊換時間或換天,拖下緣改時數。
            <span className="ml-2 inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-blue-500" /> 專案工作項
            </span>
            <span className="ml-2 inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-violet-500" /> 對應專案的會議(要核准)
            </span>
            <span className="ml-2 inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm bg-emerald-600" /> 其他(登記即生效)
            </span>
            <span className="ml-2">虛線 = 待審</span>
          </p>
          {week && <EstimatePanel key={weekStart} estimates={weekEstimate} week={week} days={days} today={today} />}
        </>
      )}

      <EntryDialog
        target={dialog}
        options={options}
        onClose={() => setDialog(null)}
        onSave={saveFromDialog}
        onDelete={deleteFromDialog}
        onDeleteSeries={deleteSeriesFromDialog}
        onSaveAsTemplate={saveAsTemplate}
      />
      <EstimateImportDialog
        open={estimateImportOpen}
        onClose={() => setEstimateImportOpen(false)}
        weekStart={weekStart}
        today={today}
        onImported={reload}
      />
      <GoogleCalendarDialog
        open={gcalOpen}
        onClose={() => setGcalOpen(false)}
        weekStart={weekStart}
        options={options}
        onAuthorize={authorizeGoogleCalendar}
        onImported={reload}
      />
      <TemplateDialog
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        options={options}
        weekStart={weekStart}
        weekLabel={isoWeekLabel(weekStart)}
        prefill={templatePrefill}
        onApplied={reload}
      />
    </div>
  );
}
