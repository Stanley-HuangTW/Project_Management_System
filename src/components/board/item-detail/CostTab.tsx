"use client";

import { UserSelect } from "@/components/ui/UserSelect";
import { NoteInput } from "@/components/ui/NoteInput";
import { EntryStatusBadge } from "@/components/timesheet/EntryStatusBadge";
import { useNoteSuggestions } from "@/components/timesheet/useNoteSuggestions";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { UserOption } from "@/types/board";
import type { UserRole } from "@prisma/client";
import { formatMoney } from "@/lib/cost";
import {
  listTimeEntries,
  logTime,
  deleteTimeEntry,
  setItemCosts,
  type TimeEntryRow,
} from "@/lib/actions/timeEntry";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 工時與費用 — the two things about an item that cost money.
 *
 * Hours are logged per person per day rather than as one running total:
 * "誰在哪一天做的" is what makes a figure checkable a month later, and it is
 * the only form that can be summed by week for over-allocation.
 */
export function CostTab({
  itemId,
  users,
  currentUserId,
  userRole,
  budgetCost,
  actualCost,
  canEdit,
}: {
  itemId: string;
  users: UserOption[];
  currentUserId: string;
  userRole: UserRole;
  budgetCost: number | null;
  actualCost: number | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { notify, confirm } = useDialogs();
  const [entries, setEntries] = useState<TimeEntryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(today);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const noteSuggestions = useNoteSuggestions(`item:${itemId}`, note);
  const [forUserId, setForUserId] = useState(currentUserId);

  const [budget, setBudget] = useState(budgetCost === null ? "" : String(budgetCost));
  const [actual, setActual] = useState(actualCost === null ? "" : String(actualCost));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rows = await listTimeEntries(itemId);
      if (!cancelled) {
        setEntries(rows);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  async function handleLog() {
    setBusy(true);
    try {
      const result = await logTime(itemId, date, Number(hours), note, forUserId);
      if (result.error) {
        await notify(result.error, { title: "無法登記工時" });
        return;
      }
      setHours("");
      setNote("");
      setEntries(await listTimeEntries(itemId));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(entry: TimeEntryRow) {
    const ok = await confirm(`刪除 ${entry.date} 的 ${entry.hours} 小時?`, {
      title: "刪除工時",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteTimeEntry(entry.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除" });
        return;
      }
      setEntries(await listTimeEntries(itemId));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveCosts() {
    const parse = (v: string) => (v.trim() === "" ? null : Number(v));
    setBusy(true);
    try {
      const result = await setItemCosts(itemId, parse(budget), parse(actual));
      if (result.error) {
        await notify(result.error, { title: "無法儲存金額" });
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);
  const byUser = new Map<string, number>();
  for (const entry of entries) byUser.set(entry.userName, (byUser.get(entry.userName) ?? 0) + entry.hours);

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <div className="space-y-5">
      <section>
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">直接費用</h3>
        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          NRE、BOM、外包等買來的錢。人力成本由下方的工時 × 該成員的時薪算出,不要重複填在這裡。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            預算
            <input
              type="number"
              min={0}
              value={budget}
              disabled={!canEdit || busy}
              onChange={(e) => setBudget(e.target.value)}
              onBlur={saveCosts}
              placeholder="未填"
              className={`${fieldClass} w-28`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
            實際
            <input
              type="number"
              min={0}
              value={actual}
              disabled={!canEdit || busy}
              onChange={(e) => setActual(e.target.value)}
              onBlur={saveCosts}
              placeholder="未填"
              className={`${fieldClass} w-28`}
            />
          </label>
        </div>
      </section>

      <section className="border-t border-neutral-100 dark:border-neutral-700 pt-4">
        <h3 className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-100">
          實際工時
          {totalHours > 0 && (
            <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
              合計 {totalHours} 小時
              {byUser.size > 1 && `(${[...byUser].map(([n, h]) => `${n} ${h}`).join("、")})`}
            </span>
          )}
        </h3>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
            className={fieldClass}
          />
          <input
            type="number"
            min={0}
            step={0.5}
            value={hours}
            disabled={busy}
            onChange={(e) => setHours(e.target.value)}
            placeholder="小時"
            className={`${fieldClass} w-20`}
          />
          <NoteInput
            value={note}
            disabled={busy}
            onChange={setNote}
            suggestions={noteSuggestions}
            placeholder="說明(選填)"
            className={fieldClass}
            wrapperClassName="min-w-0 flex-1"
          />
          {/* Only an ADMIN can log for someone else — see logTime. */}
          {userRole === "ADMIN" && (
            <UserSelect
              users={users.filter((u) => !u.isResource)}
              value={forUserId}
              disabled={busy}
              onChange={setForUserId}
              className={fieldClass}
            />
          )}
          <button
            type="button"
            disabled={busy || !hours.trim()}
            onClick={handleLog}
            className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus size={14} /> 登記
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
        ) : entries.length === 0 ? (
          <p className="text-sm text-neutral-400 dark:text-neutral-500">還沒有登記工時。</p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-700 rounded-md border border-neutral-200 dark:border-neutral-700">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-24 shrink-0 text-neutral-500 dark:text-neutral-400">{entry.date}</span>
                <span className="w-24 shrink-0 truncate text-neutral-700 dark:text-neutral-100">
                  {entry.userName}
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-neutral-800 dark:text-neutral-100">
                  {entry.hours} 小時
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-neutral-400 dark:text-neutral-500">
                  {entry.note}
                </span>
                <EntryStatusBadge
                  status={entry.status}
                  approvers={entry.approvers}
                  decidedByName={entry.decidedByName}
                  decisionNote={entry.decisionNote}
                />
                {entry.canEdit && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(entry)}
                    className="shrink-0 rounded p-1 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                    aria-label="刪除工時"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {(budgetCost !== null || actualCost !== null) && (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">
          直接費用:預算 {formatMoney(budgetCost ?? 0)} / 實際 {formatMoney(actualCost ?? 0)}。
          完整的計畫 vs 實際(含人力)在報表頁的「成本與 EVM」。
        </p>
      )}
    </div>
  );
}
