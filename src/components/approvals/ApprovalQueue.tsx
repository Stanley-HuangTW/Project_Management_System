"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Check, X, Clock, CalendarDays } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import {
  listApprovalQueue,
  decideTimeEntry,
  decideActivityTime,
  decideLeave,
  decideBatch,
  type ApprovalQueue as Queue,
} from "@/lib/actions/approval";
import {
  describeTargets,
  groupByPerson,
  personState,
  selectionKey,
  targetsOf,
  togglePerson,
  type PersonGroup,
  type SelectableRow,
} from "@/lib/approvalSelection";
import { actionErrorMessage } from "@/lib/userError";
import {
  listApprovalExtras,
  listApprovalHistory,
  type ApprovalExtras,
  type ApprovalHistoryRow,
} from "@/lib/actions/approvalExtras";
import { ApprovalExtrasSections, ApprovalHistory, hasExtras } from "./ApprovalExtrasSections";
import { APPROVALS_CHANGED_EVENT } from "./usePendingApprovalCount";

/** 下拉選單裡一個人的字樣:全選的前面 ✓、選了一部分的前面 ◐,後面是筆數。 */
function personOptionLabel(person: PersonGroup, picked: ReadonlySet<string>): string {
  const count = person.keys.filter((key) => picked.has(key)).length;
  const state = personState(picked, person.keys);
  if (state === "all") return `✓ ${person.userName}(已選 ${count} 筆)`;
  if (state === "some") return `◐ ${person.userName}(已選 ${count} / ${person.keys.length} 筆)`;
  return `${person.userName}(${person.keys.length} 筆)`;
}

function RowCheck({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled: boolean;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-blue-600"
    />
  );
}

/**
 * 待我審核 — the timesheets and leave waiting on this person.
 *
 * Both are 送審制: until they are approved the hours are outside the cost
 * report entirely and the leave does not touch anybody's capacity. So an empty
 * queue is not a quiet day — it is the thing that keeps the numbers honest.
 *
 * 每一列可以勾選;上面的工具列有全選 / 全部取消,以及依人員選取(點一個人就選他所有待審的),
 * 勾好之後一次核准或退回。
 */
export function ApprovalQueue() {
  const { notify, prompt, confirm } = useDialogs();
  const [queue, setQueue] = useState<Queue | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const [extras, setExtras] = useState<ApprovalExtras | null>(null);
  const [history, setHistory] = useState<ApprovalHistoryRow[]>([]);
  const [tab, setTab] = useState<"pending" | "history">("pending");

  /** 處理完一筆之後三份一起重讀:待辦少一筆、「已處理」多一筆。 */
  const reload = useCallback(async () => {
    const [q, e, h] = await Promise.all([listApprovalQueue(), listApprovalExtras(), listApprovalHistory()]);
    setQueue(q);
    setExtras(e);
    setHistory(h);
    // 側邊欄與鈴鐺上的件數跟著更新,不用等下一次輪詢。
    window.dispatchEvent(new Event(APPROVALS_CHANGED_EVENT));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [result, e, h] = await Promise.all([listApprovalQueue(), listApprovalExtras(), listApprovalHistory()]);
      if (!cancelled) {
        setQueue(result);
        setExtras(e);
        setHistory(h);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      await reload();
    } catch (err) {
      await notify(actionErrorMessage(err, "操作失敗"), { title: failTitle });
    } finally {
      setBusy(false);
    }
  }

  async function rejectNote(): Promise<string | null> {
    return prompt("請寫下退回原因,讓對方知道要補什麼。", {
      title: "退回",
      placeholder: "退回原因",
      required: true,
      confirmLabel: "退回",
    });
  }

  function toggleKey(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  if (loading) return <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>;
  if (!queue) return null;

  const pendingExtras = hasExtras(extras);
  const tabBar = (
    <nav className="flex gap-1 border-b border-neutral-200 dark:border-neutral-700" data-approval-tabs>
      {(
        [
          ["pending", "待處理"],
          ["history", `已處理 (${history.length})`],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => setTab(id)}
          data-approval-tab={id}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            tab === id
              ? "border-blue-600 font-medium text-blue-600 dark:text-blue-400"
              : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
          }`}
        >
          {label}
        </button>
      ))}
    </nav>
  );

  if (tab === "history") {
    return (
      <div className="space-y-4">
        {tabBar}
        <ApprovalHistory rows={history} busy={busy} run={run} />
      </div>
    );
  }

  if (!queue.isApprover && !pendingExtras) {
    return (
      <div className="space-y-4">
        {tabBar}
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
          目前沒有東西需要你審核。
        </p>
      </div>
    );
  }

  const rows: SelectableRow[] = [
    ...queue.timeEntries.map((e) => ({ key: selectionKey("time", e.id), userId: e.userId, userName: e.userName })),
    ...queue.activityEntries.map((e) => ({ key: selectionKey("activity", e.id), userId: e.userId, userName: e.userName })),
    ...queue.leaves.map((l) => ({ key: selectionKey("leave", l.id), userId: l.userId, userName: l.userName })),
  ];
  const total = rows.length;
  // 重新載入之後已經不在清單裡的(被處理掉了)不算選取。
  const liveKeys = new Set(rows.map((r) => r.key));
  const picked = new Set([...selected].filter((key) => liveKeys.has(key)));
  const people = groupByPerson(rows);

  async function decideSelected(status: "APPROVED" | "REJECTED") {
    const targets = targetsOf(picked);
    if (targets.length === 0) return;
    const summary = `已選 ${targets.length} 筆(${describeTargets(targets)})`;
    let note = "";
    if (status === "APPROVED") {
      const ok = await confirm(`${summary},全部核准?`, { title: "批次核准", confirmLabel: `核准 ${targets.length} 筆` });
      if (!ok) return;
    } else {
      const reason = await prompt(`${summary}都會退回,請寫下退回原因(每一筆都會寫上同一個原因)。`, {
        title: "批次退回",
        placeholder: "退回原因",
        required: true,
        confirmLabel: `退回 ${targets.length} 筆`,
      });
      if (!reason) return;
      note = reason;
    }
    setBusy(true);
    try {
      const { done, errors } = await decideBatch(targets, status, note);
      setSelected(new Set());
      await reload();
      if (errors.length > 0) {
        const verb = status === "APPROVED" ? "核准" : "退回";
        await notify(`已${verb} ${done} 筆;${targets.length - done} 筆沒有成功:\n${errors.join("\n")}`, {
          title: `批次${verb}`,
        });
      }
    } catch (err) {
      await notify(actionErrorMessage(err, "操作失敗"), { title: "批次處理失敗" });
    } finally {
      setBusy(false);
    }
  }

  const approveClass =
    "flex items-center gap-1 rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40";
  const rejectClass =
    "flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40";

  return (
    <div className="space-y-5">
      {tabBar}
      {extras && <ApprovalExtrasSections extras={extras} busy={busy} run={run} />}
      {total === 0 && !pendingExtras && (
        <p className="rounded-md border border-dashed border-neutral-200 dark:border-neutral-700 py-12 text-center text-sm text-neutral-400 dark:text-neutral-500">
          目前沒有待審的項目。
        </p>
      )}

      {total > 0 && (
        <div className="sticky top-0 z-10 space-y-2 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              disabled={busy || picked.size === total}
              onClick={() => setSelected(new Set(rows.map((r) => r.key)))}
              className={rejectClass}
            >
              全選
            </button>
            <button type="button" disabled={busy || picked.size === 0} onClick={() => setSelected(new Set())} className={rejectClass}>
              全部取消
            </button>
            <select
              value=""
              disabled={busy}
              onChange={(e) => {
                const person = people.find((p) => p.userId === e.target.value);
                if (person) setSelected((prev) => togglePerson(prev, person.keys));
              }}
              aria-label="依人員選取"
              title="選一個人,就選他所有待審的項目;已經全選的人再選一次就取消"
              className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 outline-none focus:border-blue-500 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
            >
              <option value="">依人員選取…</option>
              {people.map((person) => (
                <option key={person.userId} value={person.userId}>
                  {personOptionLabel(person, picked)}
                </option>
              ))}
            </select>
            <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
              已選 {picked.size} / {total} 筆
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" disabled={busy || picked.size === 0} onClick={() => decideSelected("APPROVED")} className={approveClass}>
                <Check size={12} /> 核准已選{picked.size > 0 && ` (${picked.size})`}
              </button>
              <button type="button" disabled={busy || picked.size === 0} onClick={() => decideSelected("REJECTED")} className={rejectClass}>
                <X size={12} /> 退回已選
              </button>
            </div>
          </div>
        </div>
      )}

      {queue.timeEntries.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <Clock size={14} /> 工時 ({queue.timeEntries.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            核准之後這些工時才會計入成本報表的實際成本(AC)。
          </p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {queue.timeEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <RowCheck
                  checked={picked.has(selectionKey("time", entry.id))}
                  onChange={() => toggleKey(selectionKey("time", entry.id))}
                  label={`選取 ${entry.userName} ${entry.date} ${entry.hours}h`}
                  disabled={busy}
                />
                <span className="w-20 shrink-0 truncate font-medium text-neutral-800 dark:text-neutral-100">
                  {entry.userName}
                </span>
                <span className="w-20 shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                  {entry.date}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100">
                  {entry.hours}h
                </span>
                <Link
                  href={`/boards/${entry.boardId}?highlight=${entry.itemId}`}
                  className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200 hover:text-blue-600"
                >
                  {entry.itemName}
                </Link>
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{entry.boardName}</span>
                {entry.note && (
                  <span className="min-w-0 basis-full truncate text-neutral-500 dark:text-neutral-400 sm:basis-auto">
                    {entry.note}
                  </span>
                )}
                {entry.approvalNote && (
                  <span data-approval-note className="basis-full pl-[22px] text-[11px] text-blue-700 dark:text-blue-300">
                    {entry.approvalNote}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideTimeEntry(entry.id, "APPROVED", ""), "無法核准")}
                    className={approveClass}
                  >
                    <Check size={12} /> 核准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await rejectNote();
                      if (note) await run(() => decideTimeEntry(entry.id, "REJECTED", note), "無法退回");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 退回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.activityEntries.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <Clock size={14} /> 專案會議與其他工時 ({queue.activityEntries.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            對應專案的會議、出差交通等工時。核准之後才會計入那個專案的實際成本(AC)。
          </p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {queue.activityEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <RowCheck
                  checked={picked.has(selectionKey("activity", entry.id))}
                  onChange={() => toggleKey(selectionKey("activity", entry.id))}
                  label={`選取 ${entry.userName} ${entry.date} ${entry.hours}h`}
                  disabled={busy}
                />
                <span className="w-20 shrink-0 truncate font-medium text-neutral-800 dark:text-neutral-100">
                  {entry.userName}
                </span>
                <span className="w-20 shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                  {entry.date}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums font-medium text-neutral-800 dark:text-neutral-100">
                  {entry.hours}h
                </span>
                <span className="shrink-0 rounded bg-purple-100 px-1.5 py-0.5 text-purple-800 dark:bg-purple-950 dark:text-purple-200">
                  {entry.categoryName}
                </span>
                <Link
                  href={`/boards/${entry.boardId}`}
                  className="min-w-0 flex-1 truncate text-neutral-700 dark:text-neutral-200 hover:text-blue-600"
                >
                  {entry.boardName}
                </Link>
                {entry.note && (
                  <span className="min-w-0 basis-full truncate text-neutral-500 dark:text-neutral-400 sm:basis-auto">
                    {entry.note}
                  </span>
                )}
                {entry.approvalNote && (
                  <span data-approval-note className="basis-full pl-[22px] text-[11px] text-blue-700 dark:text-blue-300">
                    {entry.approvalNote}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideActivityTime(entry.id, "APPROVED", ""), "無法核准")}
                    className={approveClass}
                  >
                    <Check size={12} /> 核准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await rejectNote();
                      if (note) await run(() => decideActivityTime(entry.id, "REJECTED", note), "無法退回");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 退回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {queue.leaves.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <CalendarDays size={14} /> 請假 ({queue.leaves.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            核准之後那幾天的產能才會歸零,「過度配置」也才會把排在假期上的工作點出來。
          </p>
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
            {queue.leaves.map((leave) => (
              <li key={leave.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <RowCheck
                  checked={picked.has(selectionKey("leave", leave.id))}
                  onChange={() => toggleKey(selectionKey("leave", leave.id))}
                  label={`選取 ${leave.userName} ${leave.startDate}~${leave.endDate} 請假`}
                  disabled={busy}
                />
                <span className="w-20 shrink-0 truncate font-medium text-neutral-800 dark:text-neutral-100">
                  {leave.userName}
                </span>
                <span className="shrink-0 tabular-nums text-neutral-600 dark:text-neutral-300">
                  {leave.startDate} ~ {leave.endDate}
                </span>
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{leave.days} 天</span>
                <span className="min-w-0 flex-1 truncate text-neutral-500 dark:text-neutral-400">
                  {leave.reason}
                </span>
                {leave.approvalNote && (
                  <span data-approval-note className="basis-full pl-[22px] text-[11px] text-blue-700 dark:text-blue-300">
                    {leave.approvalNote}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => decideLeave(leave.id, "APPROVED", ""), "無法核准")}
                    className={approveClass}
                  >
                    <Check size={12} /> 核准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await rejectNote();
                      if (note) await run(() => decideLeave(leave.id, "REJECTED", note), "無法退回");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 退回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
