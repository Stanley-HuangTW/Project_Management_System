"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { PersonPicker } from "@/components/ui/PersonPicker";
import { PercentInput } from "@/components/ui/PercentInput";
import { createSubtaskFromDashboard } from "@/lib/actions/teamTask";
import type { UserOption } from "@/types/board";
import { actionErrorMessage } from "@/lib/userError";

const DAY_MS = 86_400_000;

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  return toIsoDate(new Date(new Date(iso).getTime() + days * DAY_MS));
}

function daysBetweenIso(startIso: string, endIso: string): number {
  return Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / DAY_MS) + 1;
}

export function AddSubtaskModal({
  open,
  onOpenChange,
  parentItemId,
  parentItemName,
  parentStartDate,
  parentDueDate,
  users,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentItemId: string;
  parentItemName: string;
  parentStartDate: Date | null;
  parentDueDate: Date | null;
  users: UserOption[];
}) {
  const minDate = parentStartDate ? toIsoDate(parentStartDate) : undefined;
  const maxDate = parentDueDate ? toIsoDate(parentDueDate) : undefined;

  const [name, setName] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [startDate, setStartDate] = useState(minDate ?? toIsoDate(new Date()));
  const [days, setDays] = useState(1);
  const [pct, setPct] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endDate = startDate ? addDaysIso(startDate, days - 1) : "";

  function reset() {
    setName("");
    setAssigneeId("");
    setStartDate(minDate ?? toIsoDate(new Date()));
    setDays(1);
    setPct(100);
    setError(null);
  }

  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function handleEndDateChange(value: string) {
    if (!startDate || !value) return;
    const d = daysBetweenIso(startDate, value);
    if (d >= 1) setDays(d);
  }

  async function handleSubmit() {
    if (!assigneeId) {
      setError("請選擇指派對象");
      return;
    }
    if (!startDate) {
      setError("請輸入起始日期");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createSubtaskFromDashboard({
        parentItemId,
        assigneeUserId: assigneeId,
        name,
        startDate,
        days,
        allocationPct: pct,
      });
      handleClose(false);
    } catch (err) {
      setError(actionErrorMessage(err, "建立失敗"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={handleClose} title={`在「${parentItemName}」下新增子任務`}>
      <div className="space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">任務名稱</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={20}
            placeholder="留空預設為「新任務」"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">指派給</label>
          <div className="rounded-md border border-neutral-300 dark:border-neutral-600">
            <PersonPicker
              users={users}
              selectedId={assigneeId || null}
              onSelect={(id) => setAssigneeId(id ?? "")}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
            起始
            <input
              type="date"
              value={startDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
            結束
            <input
              type="date"
              value={endDate}
              min={minDate}
              max={maxDate}
              onChange={(e) => handleEndDateChange(e.target.value)}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
            天數
            <input
              type="number"
              min={1}
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
              className="w-16 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-sm outline-none focus:border-blue-500"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
            百分比
            <PercentInput
              value={pct}
              onChange={setPct}
              className="w-16 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-1.5 py-1 text-sm outline-none focus:border-blue-500"
            />
          </label>
        </div>

        {(minDate || maxDate) && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            時程需介於父任務的 {minDate ?? "…"} ~ {maxDate ?? "…"} 之間
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => handleClose(false)}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "建立中..." : "建立"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
