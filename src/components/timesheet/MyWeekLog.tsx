"use client";

import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  deleteActivityTime,
  getTimesheetOptions,
  listMyWeek,
  logActivityTime,
  updateActivityTime,
  type ActivityDayEntry,
  type MyWeek,
  type TimesheetDay,
  type TimesheetOptions,
} from "@/lib/actions/activityTime";
import { deleteTimeEntry, logTime } from "@/lib/actions/timeEntry";
import { addDaysIso } from "@/lib/timesheet";
import { isoWeekLabel, weekRangeOf } from "@/lib/weeklyReport";

const WEEKDAY_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

function weekdayLabel(dateIso: string): string {
  return WEEKDAY_LABELS[new Date(`${dateIso}T00:00:00Z`).getUTCDay()];
}

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

/** 退回的專案工時不算數——跟統計、24 小時上限同一個規則。 */
function dayTotal(day: TimesheetDay): number {
  return (
    day.project.filter((e) => e.status !== "REJECTED").reduce((sum, e) => sum + e.hours, 0) +
    day.activity.reduce((sum, e) => sum + e.hours, 0)
  );
}

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

type FormTarget = { date: string; editing: ActivityDayEntry | null };

export function MyWeekLog({ today }: { today: string }) {
  const { notify, confirm } = useDialogs();
  const [weekStart, setWeekStart] = useState(() => weekRangeOf(today).weekStart);
  const [loaded, setLoaded] = useState<MyWeek | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [options, setOptions] = useState<TimesheetOptions | null>(null);
  const [form, setForm] = useState<FormTarget | null>(null);

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
  const weekEnd = addDaysIso(weekStart, 6);
  const weekTotal = week ? week.days.reduce((sum, d) => sum + dayTotal(d), 0) : 0;
  const currentWeekStart = weekRangeOf(today).weekStart;

  function goToWeek(next: string) {
    setForm(null);
    setWeekStart(next);
  }

  function reload() {
    setRefreshKey((k) => k + 1);
  }

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      reload();
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: failTitle });
    }
  }

  async function removeProject(id: string, label: string) {
    const ok = await confirm(`確定要刪除「${label}」這筆專案工時嗎?`, {
      title: "刪除工時",
      confirmLabel: "刪除",
      danger: true,
    });
    if (ok) await run(() => deleteTimeEntry(id), "無法刪除");
  }

  async function removeActivity(id: string, label: string) {
    const ok = await confirm(`確定要刪除「${label}」這筆工時嗎?`, {
      title: "刪除工時",
      confirmLabel: "刪除",
      danger: true,
    });
    if (ok) await run(() => deleteActivityTime(id), "無法刪除");
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
        <div className="space-y-2">
          {week!.days.map((day) => {
            const total = dayTotal(day);
            const isToday = day.date === today;
            const formOpen = form?.date === day.date;
            return (
              <section
                key={day.date}
                className={`rounded-lg border bg-white px-3 py-2 dark:bg-neutral-900 ${
                  isToday ? "border-blue-300 dark:border-blue-800" : "border-neutral-200 dark:border-neutral-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">
                    {weekdayLabel(day.date)} {day.date.slice(5)}
                  </span>
                  {isToday && (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      今天
                    </span>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-neutral-500 dark:text-neutral-400">
                    {total > 0 ? `${fmt(total)} 小時` : "—"}
                  </span>
                  <button
                    type="button"
                    onClick={() => setForm(formOpen && !form?.editing ? null : { date: day.date, editing: null })}
                    className="flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-0.5 text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    <Plus size={12} /> 登記
                  </button>
                </div>

                {(day.project.length > 0 || day.activity.length > 0) && (
                  <ul className="mt-2 divide-y divide-neutral-100 dark:divide-neutral-800">
                    {day.project.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                          專案
                        </span>
                        <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-100">
                          <span className="text-neutral-400 dark:text-neutral-500">{e.boardName} / </span>
                          {e.itemName}
                          {e.note && <span className="ml-2 text-xs text-neutral-400">{e.note}</span>}
                        </span>
                        {e.status === "PENDING" && (
                          <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                            待審
                          </span>
                        )}
                        {e.status === "REJECTED" && (
                          <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
                            已退回
                          </span>
                        )}
                        <span className="w-14 shrink-0 text-right tabular-nums text-neutral-700 dark:text-neutral-100">
                          {fmt(e.hours)} h
                        </span>
                        <button
                          type="button"
                          onClick={() => removeProject(e.id, e.itemName)}
                          className="shrink-0 text-neutral-400 hover:text-red-600 dark:text-neutral-500"
                          aria-label="刪除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                    {day.activity.map((e) => (
                      <li key={e.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                          {e.categoryName}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-100">
                          {e.riskTitle && <span className="text-neutral-500 dark:text-neutral-400">議題:{e.riskTitle}</span>}
                          {e.note && <span className="ml-2 text-xs text-neutral-400">{e.note}</span>}
                        </span>
                        <span className="w-14 shrink-0 text-right tabular-nums text-neutral-700 dark:text-neutral-100">
                          {fmt(e.hours)} h
                        </span>
                        <button
                          type="button"
                          onClick={() => setForm({ date: day.date, editing: e })}
                          className="shrink-0 text-neutral-400 hover:text-blue-600 dark:text-neutral-500"
                          aria-label="修改"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeActivity(e.id, e.categoryName)}
                          className="shrink-0 text-neutral-400 hover:text-red-600 dark:text-neutral-500"
                          aria-label="刪除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {formOpen && (
                  <EntryForm
                    // 換一筆要修改的、或從修改切成新增,表單內的欄位都要重來。
                    key={form.editing?.id ?? "new"}
                    date={day.date}
                    editing={form.editing}
                    options={options}
                    onCancel={() => setForm(null)}
                    onSaved={() => {
                      setForm(null);
                      reload();
                    }}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EntryForm({
  date,
  editing,
  options,
  onCancel,
  onSaved,
}: {
  date: string;
  editing: ActivityDayEntry | null;
  options: TimesheetOptions | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { notify } = useDialogs();
  const [kind, setKind] = useState<"project" | "activity">("activity");
  const [itemId, setItemId] = useState("");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [riskEntryId, setRiskEntryId] = useState(editing?.riskEntryId ?? "");
  const [hours, setHours] = useState(editing ? String(editing.hours) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);

  // 修改一筆舊紀錄時,它的類別可能後來被停用了——選單裡還是要有它自己。
  const categories = options
    ? options.categories.some((c) => c.id === editing?.categoryId) || !editing
      ? options.categories
      : [
          ...options.categories,
          { id: editing.categoryId, name: `${editing.categoryName}(已停用)`, linkIssue: editing.riskEntryId !== null },
        ]
    : [];
  const effectiveCategoryId = categoryId || categories[0]?.id || "";
  const category = categories.find((c) => c.id === effectiveCategoryId);
  const effectiveItemId = itemId || options?.items[0]?.id || "";

  async function submit() {
    const parsed = Number(hours);
    setBusy(true);
    try {
      let error: string | undefined;
      if (kind === "project") {
        if (!effectiveItemId) {
          error = "請選擇工作項";
        } else {
          ({ error } = await logTime(effectiveItemId, date, parsed, note));
        }
      } else if (editing) {
        ({ error } = await updateActivityTime(editing.id, {
          date,
          hours: parsed,
          categoryId: effectiveCategoryId,
          note,
          riskEntryId: category?.linkIssue && riskEntryId ? riskEntryId : null,
        }));
      } else {
        ({ error } = await logActivityTime({
          date,
          hours: parsed,
          categoryId: effectiveCategoryId,
          note,
          riskEntryId: category?.linkIssue && riskEntryId ? riskEntryId : null,
        }));
      }
      if (error) {
        await notify(error, { title: "無法儲存" });
        return;
      }
      onSaved();
    } catch (err) {
      await notify(err instanceof Error ? err.message : "儲存失敗", { title: "無法儲存" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-800/60">
      {!editing && (
        <div className="flex w-fit overflow-hidden rounded-md border border-neutral-200 text-xs dark:border-neutral-700">
          {(
            [
              ["activity", "非專案"],
              ["project", "專案工作項"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setKind(key)}
              className={`px-3 py-1 ${
                kind === key
                  ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                  : "bg-white text-neutral-600 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {kind === "project" ? (
          options && options.items.length === 0 ? (
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              沒有指派給你的工作項。可以到項目卡片的「工時與費用」分頁登記。
            </span>
          ) : (
            <SearchableSelect
              options={(options?.items ?? []).map((i) => ({ value: i.id, label: `${i.boardName} / ${i.name}` }))}
              value={effectiveItemId}
              onChange={setItemId}
              disabled={!options}
              className={`${inputClass} min-w-0 flex-1`}
            />
          )
        ) : (
          <select
            value={effectiveCategoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={!options}
            className={inputClass}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <input
          type="number"
          min={0}
          max={24}
          step={0.5}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          placeholder="小時"
          className={`${inputClass} w-20 tabular-nums`}
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備註(選填)"
          className={`${inputClass} min-w-[8rem] flex-1`}
        />
      </div>

      {kind === "activity" && category?.linkIssue && (
        <SearchableSelect
          options={(options?.issues ?? []).map((i) => ({
            value: i.id,
            label: `${i.closed ? "(已結案) " : ""}${i.boardName} / ${i.title}`,
          }))}
          value={riskEntryId}
          onChange={setRiskEntryId}
          emptyLabel="不連結議題"
          className={`${inputClass} max-w-full`}
        />
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !hours || !options}
          onClick={submit}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "儲存中..." : editing ? "儲存修改" : "登記"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-600 hover:bg-white dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          取消
        </button>
      </div>
    </div>
  );
}
