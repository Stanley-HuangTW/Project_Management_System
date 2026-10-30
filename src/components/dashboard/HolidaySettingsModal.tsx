"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { Holiday } from "@prisma/client";
import { Modal } from "@/components/ui/Modal";
import { addHoliday, removeHoliday } from "@/lib/actions/holiday";
import { actionErrorMessage } from "@/lib/userError";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function HolidaySettingsModal({
  holidays,
  open,
  onOpenChange,
}: {
  holidays: Holiday[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [date, setDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  // 使用者自己改過結束日期之後,起始日期再變就不要跟著蓋掉它——不然連假
  // 範圍會被單日輸入的預設行為打斷。
  const [endTouched, setEndTouched] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function handleStartChange(next: string) {
    setDate(next);
    if (!endTouched) setEndDate(next);
  }

  async function handleAdd() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await addHoliday(date, name, endDate);
      if (result.error) {
        setError(result.error);
        return;
      }
      setName("");
      setEndTouched(false);
    } catch (err) {
      setError(actionErrorMessage(err, "新增失敗"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemovingId(id);
    try {
      await removeHoliday(id);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="國定假日設定">
      <p className="mb-3 text-xs text-neutral-400 dark:text-neutral-500">
        全公司共用一份清單,看板切到「工作天」計算方式時,這些日期跟週六日一樣不計入天數。
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-3 max-h-64 space-y-1 overflow-y-auto">
        {holidays.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">尚未設定任何國定假日。</p>
        ) : (
          holidays.map((h) => (
            <div
              key={h.id}
              className="flex items-center justify-between gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1.5 text-sm"
            >
              <span className="text-neutral-500 dark:text-neutral-400">{h.date}</span>
              <span className="flex-1 truncate">{h.name}</span>
              <button
                type="button"
                disabled={removingId === h.id}
                onClick={() => handleRemove(h.id)}
                className="shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-700 pt-3">
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => handleStartChange(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <span className="shrink-0 text-neutral-400 dark:text-neutral-500">~</span>
          <input
            type="date"
            value={endDate}
            min={date}
            onChange={(e) => {
              setEndTouched(true);
              setEndDate(e.target.value);
            }}
            title="結束日期——連續好幾天的假期(例如春節)不用一天一天新增"
            className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="假日名稱(例如:中秋節、春節)"
            maxLength={30}
            className="min-w-0 flex-1 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500"
          />
          <button
            type="button"
            disabled={submitting}
            onClick={handleAdd}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? "新增中..." : "新增"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
