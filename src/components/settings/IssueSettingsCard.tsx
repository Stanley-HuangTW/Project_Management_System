"use client";

import { useState, useTransition } from "react";
import { setIssueDayMode, setIssueEmailNotify } from "@/lib/actions/issueSettings";
import { actionErrorMessage } from "@/lib/userError";

/** ISSUE TRACKER 的系統設定:處理天數的算法、指派時要不要另外寄 email。 */
export function IssueSettingsCard({ dayMode, emailNotify }: { dayMode: "WORKDAY" | "CALENDAR"; emailNotify: boolean }) {
  const [mode, setMode] = useState(dayMode);
  const [email, setEmail] = useState(emailNotify);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run(fn: () => Promise<void>, rollback: () => void) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
      } catch (err) {
        rollback();
        setError(actionErrorMessage(err, "儲存失敗"));
      }
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3" data-testid="issue-settings-card">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">ISSUE TRACKER</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        案件的「處理天數」(發生日期到結案日期,含頭尾)要算工作天(排除週六日與上面設定的公司假日)還是日曆天。套用到案件列表、案件頁與統整頁。
      </p>
      <select
        value={mode}
        disabled={isPending}
        onChange={(e) => {
          const prev = mode;
          const next = e.target.value as "WORKDAY" | "CALENDAR";
          setMode(next);
          run(() => setIssueDayMode(next), () => setMode(prev));
        }}
        data-testid="issue-day-mode"
        className="mb-4 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
      >
        <option value="WORKDAY">工作天</option>
        <option value="CALENDAR">日曆天</option>
      </select>
      <label className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-200">
        <input
          type="checkbox"
          checked={email}
          disabled={isPending}
          data-testid="issue-email-notify"
          onChange={(e) => {
            const prev = email;
            const next = e.target.checked;
            setEmail(next);
            run(() => setIssueEmailNotify(next), () => setEmail(prev));
          }}
          className="mt-0.5"
        />
        <span>
          案件指派給人時,除了站內通知也寄 email
          <span className="block text-xs text-neutral-400 dark:text-neutral-500">需要伺服器已設定 SMTP;關掉就只發站內通知。</span>
        </span>
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
