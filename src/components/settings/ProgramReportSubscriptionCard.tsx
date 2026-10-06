"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  setProgramReportOptions,
  addProgramReportRecipient,
  removeProgramReportRecipient,
  type ProgramReportSubscriptionRow,
} from "@/lib/actions/programReportSubscription";

export type ReportSubscriptionUser = { id: string; name: string };

/**
 * 專案群組週報分發——寄給誰、寄哪些區塊、接下來幾天算誰的。
 *
 * 跟「週報」頁面自己產生的個人視角報告是兩回事:這裡設定的是排程
 * (WeeklyReportScheduleCard)到點自動寄出去的那一份,收件人不看權限,
 * 現有帳號跟外部 email 都可以加。
 */
export function ProgramReportSubscriptionCard({
  subscriptions,
  users,
}: {
  subscriptions: ProgramReportSubscriptionRow[];
  users: ReportSubscriptionUser[];
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, string>>({});

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      router.refresh();
      return true;
    } catch (err) {
      await notify(err instanceof Error ? err.message : "操作失敗", { title: failTitle });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">專案週報分發</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        排程時間到了,會照這裡的設定寄一份給每個專案群組指定的收件人——收件人不受權限限制,現有
        帳號跟外部 email 都可以加。跟「週報」頁面自己產生、自己看的那份是分開的。
      </p>

      <div className="space-y-3">
        {subscriptions.map((sub) => {
          const usedUserIds = new Set(sub.recipients.map((r) => r.userId).filter(Boolean));
          const addableUsers = users.filter((u) => !usedUserIds.has(u.id));
          return (
            <div key={sub.programId} className="rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
              <p className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                {sub.programName}
              </p>

              {sub.recipients.length > 0 && (
                <ul className="mb-2 space-y-1">
                  {sub.recipients.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200">
                        {r.label}
                        {!r.isUser && <span className="ml-1 text-neutral-400">(外部)</span>}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => run(() => removeProgramReportRecipient(r.id), "無法移除收件人")}
                        className="shrink-0 rounded p-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                        aria-label={`移除收件人 ${r.label}`}
                      >
                        <X size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <UserSelect
                  users={addableUsers}
                  value=""
                  disabled={busy}
                  placeholder="加入現有帳號…"
                  onChange={(userId) => {
                    if (!userId) return;
                    run(() => addProgramReportRecipient(sub.programId, { userId }), "無法新增收件人");
                  }}
                  className={`${fieldClass} text-xs`}
                />
                <input
                  value={emailDrafts[sub.programId] ?? ""}
                  disabled={busy}
                  onChange={(e) => setEmailDrafts((d) => ({ ...d, [sub.programId]: e.target.value }))}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter") return;
                    const email = emailDrafts[sub.programId] ?? "";
                    if (!email.trim()) return;
                    const ok = await run(
                      () => addProgramReportRecipient(sub.programId, { email }),
                      "無法新增收件人"
                    );
                    if (ok) setEmailDrafts((d) => ({ ...d, [sub.programId]: "" }));
                  }}
                  placeholder="外部 email,按 Enter 加入"
                  className={`${fieldClass} min-w-0 flex-1 text-xs`}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
                {(
                  [
                    ["includeSummary", "本週摘要"],
                    ["includeProgramDiff", "專案時程與預算"],
                    ["includeDepartments", "各部門工作事項"],
                    ["includeActivity", "本週異動筆數"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={sub[key]}
                      onChange={(e) =>
                        run(
                          () => setProgramReportOptions(sub.programId, { [key]: e.target.checked }),
                          "無法儲存設定"
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>

              <label className="mt-2 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                接下來
                <input
                  type="number"
                  min={1}
                  max={90}
                  disabled={busy}
                  defaultValue={sub.upcomingDays}
                  onBlur={(e) => {
                    const value = Number(e.target.value);
                    if (value === sub.upcomingDays || !Number.isFinite(value)) return;
                    run(() => setProgramReportOptions(sub.programId, { upcomingDays: value }), "無法儲存設定");
                  }}
                  className={`${fieldClass} w-16 text-center`}
                />
                天
              </label>
            </div>
          );
        })}

        {subscriptions.length === 0 && (
          <p className="text-xs text-neutral-400 dark:text-neutral-500">目前沒有專案群組。</p>
        )}
      </div>
    </div>
  );
}
