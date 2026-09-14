"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { createLeave, deleteLeave, listLeaves, type LeaveRow } from "@/lib/actions/leave";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 休假 — the days a person is away, on top of the company-wide 假日.
 *
 * It deliberately does not move any dates: the schedule knows nothing about
 * who is doing the work, and making a task's dates depend on one person's
 * leave would change them the moment it was reassigned. What it does is stop
 * the workload views pretending somebody is available when they are not.
 */
export function LeaveManagement({
  initialLeaves,
  users,
  currentUserId,
  isAdmin,
}: {
  initialLeaves: LeaveRow[];
  users: { id: string; name: string }[];
  currentUserId: string;
  isAdmin: boolean;
}) {
  const { notify, confirm } = useDialogs();
  const [leaves, setLeaves] = useState(initialLeaves);
  const [busy, setBusy] = useState(false);
  const [userId, setUserId] = useState(currentUserId);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState("");

  async function handleCreate() {
    setBusy(true);
    try {
      const result = await createLeave(userId, startDate, endDate, reason);
      if (result.error) {
        await notify(result.error, { title: "無法登記休假" });
        return;
      }
      setReason("");
      setLeaves(await listLeaves());
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(leave: LeaveRow) {
    const ok = await confirm(`刪除 ${leave.userName} 的休假(${leave.startDate} ~ ${leave.endDate})?`, {
      title: "刪除休假",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteLeave(leave.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除" });
        return;
      }
      setLeaves(await listLeaves());
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="space-y-4">
      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        公司假日在「系統設定」;這裡是個別成員請假的日子。休假不會移動任何工作項的日期
        ——排程不知道工作是誰在做,讓日期跟著某個人的假走,一換人就會變。它的作用是讓
        「過度配置」不再把休假日當成有產能:那幾天只要有工作排著,就會被點出來。
      </p>

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-3">
        <select
          value={userId}
          disabled={busy || !isAdmin}
          onChange={(e) => setUserId(e.target.value)}
          title={isAdmin ? undefined : "只能登記自己的休假"}
          className={fieldClass}
        >
          {(isAdmin ? users : users.filter((u) => u.id === currentUserId)).map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={startDate}
          disabled={busy}
          onChange={(e) => {
            setStartDate(e.target.value);
            if (endDate < e.target.value) setEndDate(e.target.value);
          }}
          className={fieldClass}
        />
        <span className="text-sm text-neutral-400 dark:text-neutral-500">~</span>
        <input
          type="date"
          value={endDate}
          disabled={busy}
          onChange={(e) => setEndDate(e.target.value)}
          className={fieldClass}
        />
        <input
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
          placeholder="事由(選填)"
          className={`${fieldClass} min-w-0 flex-1`}
        />
        <button
          type="button"
          disabled={busy}
          onClick={handleCreate}
          className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          <Plus size={14} /> 登記
        </button>
      </div>

      {leaves.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-8 text-center text-sm text-neutral-400 dark:text-neutral-500">
          沒有未來的休假紀錄。
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
          {leaves.map((leave) => (
            <li key={leave.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-28 shrink-0 truncate text-neutral-800 dark:text-neutral-100">
                {leave.userName}
              </span>
              <span className="shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                {leave.startDate} ~ {leave.endDate}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
                {leave.reason}
              </span>
              {leave.status !== "APPROVED" && (
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    leave.status === "PENDING"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                      : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                  }`}
                  title={leave.decisionNote ?? "核准前不會改變產能判定"}
                >
                  {leave.status === "PENDING" ? "待主管核准" : "已退回"}
                </span>
              )}
              {leave.canEdit && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleDelete(leave)}
                  className="shrink-0 rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                  aria-label="刪除休假"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
