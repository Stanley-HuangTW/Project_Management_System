"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { TimesheetOptions } from "@/lib/actions/activityTime";
import {
  applyTimeTemplate,
  createTimeTemplate,
  deleteTimeTemplate,
  listTimeTemplates,
  type TimeTemplateRow,
} from "@/lib/actions/timeTemplate";
import { snapHours } from "@/lib/calendarLayout";
import { formatMinute, parseMinute } from "@/lib/timeOfDay";
import { WEEKDAY_NAMES, describeApplyResult, formatWeekdays, type TemplateKind } from "@/lib/timeTemplates";
import { actionErrorMessage } from "@/lib/userError";

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/** 從一筆工時「存成範本」時帶進表單的初始值。 */
export type TemplatePrefill = {
  name: string;
  kind: TemplateKind;
  categoryId: string;
  itemId: string;
  boardId: string;
  startMinute: number | null;
  hours: number;
  note: string;
  /** 1 = 週一 … 7 = 週日 */
  weekday: number;
};

function fmt(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

function templateMeta(t: TimeTemplateRow): string {
  const what =
    t.kind === "project"
      ? `專案工作項:${t.boardName ?? ""} / ${t.itemName ?? ""}`
      : `${t.categoryName ?? "會議與其他"}${t.boardName ? `・對應專案 ${t.boardName}` : ""}`;
  const when = `${formatWeekdays(t.weekdays)} ${
    t.startMinute === null ? "" : `${formatMinute(t.startMinute)} 起 `
  }${fmt(t.hours)} 小時`;
  return `${what}｜${when}${t.note ? `｜${t.note}` : ""}`;
}

export function TemplateDialog({
  open,
  onClose,
  options,
  weekStart,
  weekLabel,
  prefill,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  options: TimesheetOptions | null;
  weekStart: string;
  weekLabel: string;
  prefill: TemplatePrefill | null;
  /** 套用範本建立了工時,行事曆要重新讀取。 */
  onApplied: () => void;
}) {
  const { confirm, notify } = useDialogs();
  const [templates, setTemplates] = useState<TimeTemplateRow[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [status, setStatus] = useState<{ text: string; failed: string[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const result = await listTimeTemplates();
      if (cancelled) return;
      setTemplates(result.templates);
      setIsAdmin(result.isAdmin);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, refreshKey]);

  async function apply(t: TimeTemplateRow) {
    setBusyId(t.id);
    setStatus(null);
    try {
      const result = await applyTimeTemplate(t.id, weekStart);
      if ("error" in result) {
        setStatus({ text: result.error, failed: [] });
        return;
      }
      setStatus({ text: `「${t.name}」套用到${weekLabel}:${describeApplyResult(result)}`, failed: result.failed });
      if (result.created > 0) onApplied();
    } catch (err) {
      setStatus({ text: actionErrorMessage(err, "套用失敗"), failed: [] });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(t: TimeTemplateRow) {
    const ok = await confirm(`確定要刪除${t.shared ? "共用" : ""}範本「${t.name}」嗎?已經建立的工時不受影響。`, {
      title: "刪除範本",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusyId(t.id);
    try {
      const { error } = await deleteTimeTemplate(t.id);
      if (error) await notify(error, { title: "無法刪除" });
      else setRefreshKey((k) => k + 1);
    } finally {
      setBusyId(null);
    }
  }

  const shared = templates.filter((t) => t.shared);
  const mine = templates.filter((t) => !t.shared);

  function renderList(title: string, rows: TimeTemplateRow[], hint?: string) {
    if (rows.length === 0) return null;
    return (
      <section>
        <h3 className="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          {title}
          {hint && <span className="ml-2 font-normal text-neutral-400 dark:text-neutral-500">{hint}</span>}
        </h3>
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-700">
          {rows.map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">{t.name}</div>
                <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400" title={templateMeta(t)}>
                  {templateMeta(t)}
                </div>
              </div>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => apply(t)}
                className="shrink-0 rounded-md border border-blue-300 px-2.5 py-1 text-xs text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950"
                title={`在${weekLabel}(${weekStart} 起)的 ${formatWeekdays(t.weekdays)} 各建立一筆`}
              >
                套用到這週
              </button>
              {t.canDelete && (
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => remove(t)}
                  className="shrink-0 rounded p-1 text-neutral-400 hover:text-red-600 disabled:opacity-50 dark:text-neutral-500"
                  aria-label={`刪除範本 ${t.name}`}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title="工時範本" size="lg">
      <div className="space-y-4">
        {!loaded ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
        ) : (
          <>
            {templates.length === 0 && (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                還沒有範本。例行會議可以在下面新增,或是開啟行事曆上的一筆工時,按「存成範本」。
              </p>
            )}
            {renderList("共用範本", shared, "管理者建立,所有人都能套用")}
            {renderList("我的範本", mine)}
            {status && (
              <div
                className={`rounded-md px-3 py-2 text-xs ${
                  status.failed.length > 0
                    ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    : "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                }`}
              >
                <div>{status.text}</div>
                {status.failed.length > 0 && (
                  <ul className="mt-1 list-disc pl-4">
                    {status.failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <TemplateForm
          key={prefill ? `${prefill.name}:${prefill.weekday}:${prefill.startMinute}` : "blank"}
          options={options}
          isAdmin={isAdmin}
          prefill={prefill}
          onCreated={() => setRefreshKey((k) => k + 1)}
        />
      </div>
    </Modal>
  );
}

function TemplateForm({
  options,
  isAdmin,
  prefill,
  onCreated,
}: {
  options: TimesheetOptions | null;
  isAdmin: boolean;
  prefill: TemplatePrefill | null;
  onCreated: () => void;
}) {
  const { notify } = useDialogs();
  const [name, setName] = useState(prefill?.name ?? "");
  const [kind, setKind] = useState<TemplateKind>(prefill?.kind ?? "activity");
  const [categoryId, setCategoryId] = useState(prefill?.categoryId ?? "");
  const [itemId, setItemId] = useState(prefill?.itemId ?? "");
  const [boardId, setBoardId] = useState(prefill?.boardId ?? "");
  const [scheduled, setScheduled] = useState(prefill ? prefill.startMinute !== null : true);
  const [time, setTime] = useState(prefill?.startMinute != null ? formatMinute(prefill.startMinute) : "10:00");
  const [hours, setHours] = useState(String(prefill?.hours ?? 1));
  const [weekdays, setWeekdays] = useState<number[]>(prefill ? [prefill.weekday] : [1]);
  const [note, setNote] = useState(prefill?.note ?? "");
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(prefill !== null);

  const categories = options?.categories ?? [];
  const effectiveCategoryId = categoryId || categories[0]?.id || "";
  const category = categories.find((c) => c.id === effectiveCategoryId);
  const effectiveKind: TemplateKind = shared ? "activity" : kind;
  const effectiveItemId = itemId || options?.items[0]?.id || "";

  function toggleWeekday(d: number) {
    setWeekdays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  }

  async function submit() {
    const parsedHours = Number(hours);
    const startMinute = scheduled ? parseMinute(time) : null;
    if (scheduled && startMinute === null) {
      await notify("請輸入開始時間", { title: "無法儲存" });
      return;
    }
    setBusy(true);
    try {
      const { error } = await createTimeTemplate({
        name,
        kind: effectiveKind,
        categoryId: effectiveKind === "activity" ? effectiveCategoryId : null,
        itemId: effectiveKind === "project" ? effectiveItemId : null,
        boardId: effectiveKind === "activity" && category?.allowProject && boardId ? boardId : null,
        startMinute,
        hours: parsedHours,
        note,
        weekdays,
        shared,
      });
      if (error) {
        await notify(error, { title: "無法儲存範本" });
        return;
      }
      setName("");
      setNote("");
      onCreated();
    } catch (err) {
      await notify(actionErrorMessage(err, "儲存失敗"), { title: "無法儲存範本" });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        新增範本
      </button>
    );
  }

  return (
    <section className="space-y-3 rounded-md bg-neutral-50 p-3 dark:bg-neutral-800/60">
      <h3 className="text-xs font-medium text-neutral-500 dark:text-neutral-400">新增範本</h3>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="範本名稱,例如「部門週會」"
        maxLength={40}
        className={`${inputClass} w-full`}
      />

      {!shared && (
        <div className="flex w-fit overflow-hidden rounded-md border border-neutral-200 text-xs dark:border-neutral-700">
          {(
            [
              ["activity", "會議與其他"],
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

      {effectiveKind === "project" ? (
        <SearchableSelect
          options={(options?.items ?? []).map((i) => ({ value: i.id, label: `${i.boardName} / ${i.name}` }))}
          value={effectiveItemId}
          onChange={setItemId}
          disabled={!options}
          className={`${inputClass} w-full`}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
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
          {category?.allowProject && (
            <SearchableSelect
              options={(options?.boards ?? []).map((b) => ({ value: b.id, label: b.name }))}
              value={boardId}
              onChange={setBoardId}
              emptyLabel="不屬於專案"
              placeholder="對應專案"
              className={`${inputClass} min-w-0 flex-1`}
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
        <span>每週</span>
        {WEEKDAY_NAMES.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => toggleWeekday(i + 1)}
            aria-pressed={weekdays.includes(i + 1)}
            className={`rounded-md border px-2 py-1 ${
              weekdays.includes(i + 1)
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-neutral-500 dark:text-neutral-400">
          開始時間
          <input
            type="time"
            step={900}
            value={time}
            disabled={!scheduled}
            onChange={(e) => setTime(e.target.value)}
            className={`${inputClass} mt-1 block tabular-nums`}
          />
        </label>
        <label className="text-xs text-neutral-500 dark:text-neutral-400">
          時數
          <input
            type="number"
            min={0.25}
            max={24}
            step={0.25}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            onBlur={() => Number(hours) > 0 && setHours(String(snapHours(Number(hours))))}
            className={`${inputClass} mt-1 block w-24 tabular-nums`}
          />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
          排定時間
        </label>
      </div>

      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="備註(選填,套用時帶進每一筆)"
        className={`${inputClass} w-full`}
      />

      {isAdmin && (
        <label className="flex w-fit items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
          <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          共用範本(所有人都能套用;只能是會議與其他)
        </label>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !options || !name.trim()}
          onClick={submit}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "儲存中..." : "儲存範本"}
        </button>
      </div>
    </section>
  );
}
