"use client";

import { useState, useTransition } from "react";
import { setWeeklyReportSchedule } from "@/lib/actions/systemSettings";
import { runWeeklyReportNow } from "@/lib/actions/weeklyReportRun";
import { useDialogs } from "@/components/ui/DialogProvider";
import { reportRangeDays } from "@/lib/weeklyReport";
import { MAX_REMINDER_HOURS, formatClock, reminderTime } from "@/lib/weeklyReminder";

const DOW_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 台北時間(固定 UTC+8)。不用 toLocaleString:伺服器與瀏覽器的格式不一樣,會造成 hydration 不一致。 */
function formatTaipei(iso: string): string {
  return new Date(Date.parse(iso) + 8 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

/** 專案週報分發要多久跑一次——一份全域的時間,寄給誰、寄什麼在下面的
 *  ProgramReportSubscriptionCard 各自設定。 */
export function WeeklyReportScheduleCard({
  initial,
  lastRun,
}: {
  initial: {
    enabled: boolean;
    dow: number;
    hour: number;
    minute: number;
    rangeStartDow: number;
    rangeEndDow: number;
    reminderHours: number;
  };
  /** 排程最近一次真的動手的時間(ISO)與結果;還沒跑過就是 null。 */
  lastRun: { at: string; note: string } | null;
}) {
  const [schedule, setSchedule] = useState(initial);
  // 提醒小時用文字框:邊打邊存會一個字存一次,所以離開欄位才存。
  const [hoursText, setHoursText] = useState(String(initial.reminderHours));
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const { confirm, notify } = useDialogs();

  async function runNow() {
    const ok = await confirm(
      "會立刻產生這一輪的專案週報,並寄給每個專案群組設定的收件人(跟排程到時間做的是同一件事)。確定現在寄出?",
      { title: "立即執行一次" }
    );
    if (!ok) return;
    setRunning(true);
    try {
      const result = await runWeeklyReportNow();
      await notify(result.error ?? result.note ?? "已執行。", { title: "專案週報" });
    } finally {
      setRunning(false);
    }
  }

  function save(next: typeof schedule) {
    setSchedule(next);
    startTransition(async () => {
      const result = await setWeeklyReportSchedule(next);
      if (result.error) setHoursError(result.error);
    });
  }

  function saveReminderHours() {
    const hours = Number(hoursText.trim());
    if (hoursText.trim() === "" || !Number.isInteger(hours) || hours < 0 || hours > MAX_REMINDER_HOURS) {
      setHoursError(`請輸入 0 到 ${MAX_REMINDER_HOURS} 的整數(0 = 不提醒)`);
      return;
    }
    setHoursError(null);
    if (hours !== schedule.reminderHours) save({ ...schedule, reminderHours: hours });
  }

  const reminderAt = reminderTime(schedule, schedule.reminderHours);

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
      <div className="mt-2 flex items-start gap-3">
        <p data-last-run className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">
          {lastRun
            ? `上次執行:${formatTaipei(lastRun.at)}(台北時間)——${lastRun.note}`
            : "還沒有執行過。啟用後,到了設定的時間,下一次心跳(每 5 分鐘一次)就會跑。"}
        </p>
        <button
          type="button"
          data-run-now
          disabled={running}
          onClick={() => void runNow()}
          title="不等排程,現在就產生並寄出這一輪的週報;寄信失敗的原因會直接顯示"
          className="shrink-0 rounded-md border border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
        >
          {running ? "執行中…" : "立即執行一次"}
        </button>
      </div>

      <div className="mt-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
        <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">產生前提醒同仁更新工作事項</p>
        <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
          週報產生前先寄一封信給所有同仁,請大家更新自己的工作事項,並說明週報什麼時候產生、涵蓋哪一段。
          只有排程啟用、而且至少有一個專案群組設定了週報收件人時才會寄。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-neutral-600 dark:text-neutral-300">週報產生前</span>
          <input
            type="text"
            inputMode="numeric"
            value={hoursText}
            disabled={isPending || !schedule.enabled}
            onChange={(e) => setHoursText(e.target.value)}
            onBlur={saveReminderHours}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
            }}
            className={`${fieldClass} w-20 text-right`}
            aria-label="週報產生前幾小時寄提醒信"
            data-reminder-hours
          />
          <span className="text-sm text-neutral-600 dark:text-neutral-300">小時寄提醒信(0 = 不提醒)</span>
        </div>
        {hoursError && <p className="mt-1.5 text-xs text-red-600">{hoursError}</p>}
        {schedule.enabled && schedule.reminderHours > 0 && (
          <p data-reminder-hint className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            提醒信會在 {formatClock(reminderAt)} 寄出,信裡會說明週報於 {formatClock(schedule)} 產生。
          </p>
        )}
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
