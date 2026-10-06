"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { NoteInput } from "@/components/ui/NoteInput";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { TimesheetOptions } from "@/lib/actions/activityTime";
import { snapHours } from "@/lib/calendarLayout";
import { formatMinute, parseMinute } from "@/lib/timeOfDay";
import { EntryStatusBadge } from "./EntryStatusBadge";
import { useNoteSuggestions } from "./useNoteSuggestions";
import type { CalendarEvent } from "./timesheetEvents";

const inputClass =
  "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

/** 對話框要存的內容;專案工時用 itemId,其他工時用 categoryId 等。 */
export type EntryDraft = {
  kind: "project" | "activity";
  date: string;
  startMinute: number | null;
  hours: number;
  note: string;
  itemId: string;
  categoryId: string;
  boardId: string;
  riskEntryId: string;
};

/** 新增:從行事曆點出來的時段(沒排時間的 startMinute 是 null);修改:被點開的那一筆。 */
export type EntryDialogTarget =
  | { mode: "new"; date: string; startMinute: number | null; hours: number }
  | { mode: "edit"; event: CalendarEvent };

export function EntryDialog({
  target,
  options,
  onClose,
  onSave,
  onDelete,
  onSaveAsTemplate,
}: {
  target: EntryDialogTarget | null;
  options: TimesheetOptions | null;
  onClose: () => void;
  /** 回傳錯誤訊息就留在對話框裡讓使用者改;沒有錯誤對話框才會關。 */
  onSave: (draft: EntryDraft, editing: CalendarEvent | null) => Promise<string | null>;
  onDelete: (event: CalendarEvent) => Promise<void>;
  onSaveAsTemplate: (event: CalendarEvent) => void;
}) {
  return (
    <Modal open={target !== null} onOpenChange={(open) => !open && onClose()} title={target?.mode === "edit" ? "修改工時" : "登記工時"}>
      {target && (
        <EntryForm
          // 換一筆、或從新增切到修改,欄位都要重來。
          key={target.mode === "edit" ? target.event.key : `new:${target.date}:${target.startMinute}`}
          target={target}
          options={options}
          onCancel={onClose}
          onSave={onSave}
          onDelete={onDelete}
          onSaveAsTemplate={onSaveAsTemplate}
        />
      )}
    </Modal>
  );
}

function EntryForm({
  target,
  options,
  onCancel,
  onSave,
  onDelete,
  onSaveAsTemplate,
}: {
  target: EntryDialogTarget;
  options: TimesheetOptions | null;
  onCancel: () => void;
  onSave: (draft: EntryDraft, editing: CalendarEvent | null) => Promise<string | null>;
  onDelete: (event: CalendarEvent) => Promise<void>;
  onSaveAsTemplate: (event: CalendarEvent) => void;
}) {
  const editing = target.mode === "edit" ? target.event : null;
  const { notify } = useDialogs();
  const [kind, setKind] = useState<"project" | "activity">(editing?.kind ?? "activity");
  const [date, setDate] = useState(editing?.date ?? (target.mode === "new" ? target.date : ""));
  const initialStart = editing ? editing.startMinute : target.mode === "new" ? target.startMinute : null;
  const [scheduled, setScheduled] = useState(initialStart !== null);
  const [time, setTime] = useState(initialStart !== null ? formatMinute(initialStart) : "09:00");
  const [hours, setHours] = useState(String(editing?.hours ?? (target.mode === "new" ? target.hours : 1)));
  const [itemId, setItemId] = useState(editing?.project?.itemId ?? "");
  const [categoryId, setCategoryId] = useState(editing?.activity?.categoryId ?? "");
  const [boardId, setBoardId] = useState(editing?.activity?.boardId ?? "");
  const [riskEntryId, setRiskEntryId] = useState(editing?.activity?.riskEntryId ?? "");
  const [note, setNote] = useState(editing?.project?.note ?? editing?.activity?.note ?? "");
  const [busy, setBusy] = useState(false);

  // 修改一筆舊紀錄時,它的類別可能後來被停用了——選單裡還是要有它自己。
  const act = editing?.activity;
  const categories = options
    ? !act || options.categories.some((c) => c.id === act.categoryId)
      ? options.categories
      : [
          ...options.categories,
          { id: act.categoryId, name: `${act.categoryName}(已停用)`, linkIssue: act.riskEntryId !== null, allowProject: act.boardId !== null },
        ]
    : [];
  const effectiveCategoryId = categoryId || categories[0]?.id || "";
  const category = categories.find((c) => c.id === effectiveCategoryId);
  // 修改的舊紀錄,它的工作項可能已經不在「指派給我」的名單裡了——選單裡還是要有它自己。
  const proj = editing?.project;
  const items = options
    ? !proj || options.items.some((i) => i.id === proj.itemId)
      ? options.items
      : [...options.items, { id: proj.itemId, name: proj.itemName, boardName: proj.boardName }]
    : [];
  const effectiveItemId = itemId || items[0]?.id || "";

  // 備註的建議:這位成員以前對同一個工作項/類別寫過的備註排前面。
  const noteScope =
    kind === "project"
      ? effectiveItemId
        ? `item:${effectiveItemId}`
        : null
      : effectiveCategoryId
        ? `cat:${effectiveCategoryId}`
        : null;
  const noteSuggestions = useNoteSuggestions(noteScope, note);

  const parsedHours = Number(hours);
  const startMinute = scheduled ? parseMinute(time) : null;
  const endLabel =
    scheduled && startMinute !== null && Number.isFinite(parsedHours) && parsedHours > 0
      ? formatMinute(Math.min(1439, startMinute + Math.round(parsedHours * 60)))
      : null;

  async function submit() {
    if (!Number.isFinite(parsedHours) || parsedHours <= 0) {
      await notify("工時必須大於 0", { title: "無法儲存" });
      return;
    }
    if (scheduled && startMinute === null) {
      await notify("請輸入開始時間", { title: "無法儲存" });
      return;
    }
    if (kind === "project" && !effectiveItemId) {
      await notify("請選擇工作項", { title: "無法儲存" });
      return;
    }
    setBusy(true);
    try {
      const error = await onSave(
        {
          kind,
          date,
          startMinute,
          hours: parsedHours,
          note,
          itemId: effectiveItemId,
          categoryId: effectiveCategoryId,
          boardId: category?.allowProject ? boardId : "",
          riskEntryId: category?.linkIssue ? riskEntryId : "",
        },
        editing
      );
      if (error) await notify(error, { title: "無法儲存" });
    } catch (err) {
      await notify(err instanceof Error ? err.message : "儲存失敗", { title: "無法儲存" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] dark:bg-neutral-800">
            {editing.kind === "project" ? "專案工作項" : "會議與其他"}
          </span>
          {editing.needsApproval && (
            <EntryStatusBadge
              status={editing.status}
              approvers={(editing.project ?? editing.activity)?.approvers ?? []}
              decidedByName={(editing.project ?? editing.activity)?.decidedByName ?? null}
              decisionNote={(editing.project ?? editing.activity)?.decisionNote ?? null}
            />
          )}
        </div>
      ) : (
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

      {kind === "project" ? (
        options && options.items.length === 0 ? (
          <p className="text-xs text-neutral-500 dark:text-neutral-400">沒有指派給你的工作項。可以到項目卡片的「工時與費用」分頁登記。</p>
        ) : (
          <label className="block text-xs text-neutral-500 dark:text-neutral-400">
            工作項
            <SearchableSelect
              options={items.map((i) => ({ value: i.id, label: `${i.boardName} / ${i.name}` }))}
              value={effectiveItemId}
              onChange={setItemId}
              disabled={!options}
              className={`${inputClass} mt-1 w-full`}
            />
          </label>
        )
      ) : (
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          類別
          <select
            value={effectiveCategoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={!options}
            className={`${inputClass} mt-1 w-full`}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind === "activity" && category?.allowProject && (
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          對應專案
          <SearchableSelect
            options={(options?.boards ?? []).map((b) => ({ value: b.id, label: b.name }))}
            value={boardId}
            onChange={setBoardId}
            emptyLabel="不屬於專案"
            placeholder="對應專案"
            className={`${inputClass} mt-1 w-full`}
            title="對應專案的工時要由專案分組的 Team Leader / PMD、同部門 DM 或直屬主管核准,才會計入那個專案的成本"
          />
        </label>
      )}

      {kind === "activity" && category?.linkIssue && (
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          連結議題
          <SearchableSelect
            options={(options?.issues ?? []).map((i) => ({
              value: i.id,
              label: `${i.closed ? "(已結案) " : ""}${i.boardName} / ${i.title}`,
            }))}
            value={riskEntryId}
            onChange={setRiskEntryId}
            emptyLabel="不連結議題"
            className={`${inputClass} mt-1 w-full`}
          />
        </label>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-neutral-500 dark:text-neutral-400">
          日期
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} mt-1 block`} />
        </label>
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
        {endLabel && <span className="pb-2 text-xs text-neutral-400 dark:text-neutral-500">到 {endLabel}</span>}
      </div>
      <label className="flex w-fit items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
        <input type="checkbox" checked={scheduled} onChange={(e) => setScheduled(e.target.checked)} />
        排定時間(取消勾選會列在日期底下的「未排時間」)
      </label>

      <label className="block text-xs text-neutral-500 dark:text-neutral-400">
        備註
        <NoteInput
          value={note}
          onChange={setNote}
          suggestions={noteSuggestions}
          placeholder="備註(選填)"
          className={`${inputClass} mt-1 w-full`}
          wrapperClassName="w-full"
        />
      </label>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={busy || !options || !date}
          onClick={submit}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "儲存中..." : editing ? "儲存修改" : "登記"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-300 px-4 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          取消
        </button>
        {editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSaveAsTemplate(editing)}
            className="ml-auto rounded-md px-2 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-neutral-800"
            title="把這筆存成範本,之後可以一次套用到任何一週"
          >
            存成範本
          </button>
        )}
        {editing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(editing)}
            className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950"
          >
            <Trash2 size={14} /> 刪除
          </button>
        )}
      </div>
    </div>
  );
}
