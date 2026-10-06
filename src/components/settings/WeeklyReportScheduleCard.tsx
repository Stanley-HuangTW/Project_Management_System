"use client";

import { useState, useTransition } from "react";
import { setWeeklyReportSchedule } from "@/lib/actions/systemSettings";
import { reportRangeDays } from "@/lib/weeklyReport";

const DOW_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 專案週報分發要多久跑一次——一份全域的時間,寄給誰、寄什麼在下面的
 *  ProgramReportSubscriptionCard 各自設定。 */
export function WeeklyReportScheduleCard({
  initial,
}: {
  initial: {
    enabled: boolean;
    dow: number;
    hour: number;
    minute: number;
    rangeStartDow: number;
    rangeEndDow: number;
  };
}) {
  const [schedule, setSchedule] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function save(next: typeof schedule) {
    setSchedule(next);
    startTransition(async () => {
      await setWeeklyReportSchedule(next);
    });
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">專案週報排程</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        到這個時間,自動幫每個有設定收件人的專案群組寄一份週報(見下面「專案週報分發」)。這裡只
        設定「什麼時候」,「寄給誰、寄什麼」在下面各自的專案群組底下設定。
      </p>

      <label className="mb-3 flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
        <input
          type="checkbox"
          disabled={isPending}
          checked={schedule.enabled}
          onChange={(e) => save({ ...schedule, enabled: e.target.checked })}
        />
        啟用排程
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-600 dark:text-neutral-300">每</span>
        <select
          value={schedule.dow}
          disabled={isPending || !schedule.enabled}
          onChange={(e) => save({ ...schedule, dow: Number(e.target.value) })}
          className={fieldClass}
        >
          {DOW_LABELS.map((label, dow) => (
            <option key={dow} value={dow}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={schedule.hour}
          disabled={isPending || !schedule.enabled}
          onChange={(e) => save({ ...schedule, hour: Number(e.target.value) })}
          className={fieldClass}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")} 點
            </option>
          ))}
        </select>
        <select
          value={schedule.minute}
          disabled={isPending || !schedule.enabled}
          onChange={(e) => save({ ...schedule, minute: Number(e.target.value) })}
          className={fieldClass}
        >
          {[0, 15, 30, 45].map((m) => (
            <option key={m} value={m}>
              {String(m).padStart(2, "0")} 分
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">週報涵蓋的範圍</p>
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          每份週報(手動產生的、排程寄的都一樣)涵蓋哪幾天。預設週三到週二;排程與「產生上一週」報的是已經結束的那一個範圍
          (最後一天過完才算結束)。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-600 dark:text-neutral-300">從</span>
          <select
            value={schedule.rangeStartDow}
            disabled={isPending}
            onChange={(e) => save({ ...schedule, rangeStartDow: Number(e.target.value) })}
            className={fieldClass}
            aria-label="週報範圍的起始日"
          >
            {DOW_LABELS.map((label, dow) => (
              <option key={dow} value={dow}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-sm text-neutral-600 dark:text-neutral-300">到</span>
          <select
            value={schedule.rangeEndDow}
            disabled={isPending}
            onChange={(e) => save({ ...schedule, rangeEndDow: Number(e.target.value) })}
            className={fieldClass}
            aria-label="週報範圍的結束日"
          >
            {DOW_LABELS.map((label, dow) => (
              <option key={dow} value={dow}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-xs text-neutral-400 dark:text-neutral-500">
            共 {reportRangeDays({ startDow: schedule.rangeStartDow, endDow: schedule.rangeEndDow })} 天
          </span>
        </div>
      </div>
    </div>
  );
}
