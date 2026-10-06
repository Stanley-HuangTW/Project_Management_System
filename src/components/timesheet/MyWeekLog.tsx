"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { addDaysIso } from "@/lib/timesheet";
import { isoWeekLabel, weekRangeOf } from "@/lib/weeklyReport";
import { EntryDialog, type EntryDialogTarget, type EntryDraft } from "./EntryDialog";
import { WeekCalendar } from "./WeekCalendar";
import { dayTotalHours, eventsOfWeek, moveEventInWeek, type CalendarEvent } from "./timesheetEvents";

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
      await notify(err instanceof Error ? err.message : "修改失敗", { title: "無法修改" });
    } finally {
      setBusy(false);
      reload();
    }
  }

  /** 對話框儲存:回傳錯誤訊息就留在對話框。 */
  async function saveFromDialog(draft: EntryDraft, editing: CalendarEvent | null): Promise<string | null> {
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
      await notify(err instanceof Error ? err.message : "刪除失敗", { title: "無法刪除" });
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
        </>
      )}

      <EntryDialog
        target={dialog}
        options={options}
        onClose={() => setDialog(null)}
        onSave={saveFromDialog}
        onDelete={deleteFromDialog}
      />
    </div>
  );
}
