"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Trash2 } from "lucide-react";
import { deleteActivityTime, logActivityTime } from "@/lib/actions/activityTime";
import type { IssueCaseDetail } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { buttonClass, inputClass } from "./issueUi";

/**
 * 案件的「花費工時」:連到這個案件的工時合計與明細,並能直接登記一筆(類別要是管理者開了「可連結案件」的)。
 * 登記出去的工時就是工時頁裡的非專案工時(同一套資料),登記即生效、不用審核。
 */
export function IssueWorkHours({ detail, today }: { detail: IssueCaseDetail; today: string }) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const { workHours, workCategories } = detail;
  const [hours, setHours] = useState("1");
  const [date, setDate] = useState(today);
  const [categoryId, setCategoryId] = useState(workCategories[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await logActivityTime({
        date,
        hours: Number(hours),
        categoryId,
        note,
        riskEntryId: null,
        issueCaseId: detail.id,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setNote("");
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "登記失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm("確定要刪除這筆工時嗎?", { title: "刪除工時", confirmLabel: "刪除", danger: true }))) return;
    try {
      const result = await deleteActivityTime(id);
      if (result.error) setError(result.error);
      else router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "刪除失敗"));
    }
  }

  const canLog = detail.can.addLog && workCategories.length > 0;
  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-work-hours" data-issue-work-hours>
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        <Clock size={14} /> 花費工時
        <span className="ml-auto text-base font-semibold tabular-nums" data-testid="work-total">{workHours.total.toFixed(2).replace(/\.?0+$/, "")} 小時</span>
      </h2>
      <p className="mb-2 text-[11px] text-neutral-400">
        {workHours.scope === "ALL" ? "全部人登記在這個案件上的工時。" : "你登記在這個案件上的工時(別人登記的只有管理者與負責人看得到)。"}也可以在「工時」頁登記時選這個案件。
      </p>
      <ul className="mb-3 space-y-1 text-sm">
        {workHours.entries.map((w) => (
          <li key={w.id} className="group flex items-center gap-2" data-testid="work-entry">
            <span className="w-24 shrink-0 tabular-nums text-neutral-500">{w.date}</span>
            <span className="w-14 shrink-0 text-right tabular-nums">{w.hours} 小時</span>
            <span className="min-w-0 flex-1 truncate text-neutral-600 dark:text-neutral-300">
              {w.userName}
              {w.note ? ` · ${w.note}` : ""}
            </span>
            {w.own && (
              <button type="button" onClick={() => void remove(w.id)} title="刪除" className="text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                <Trash2 size={13} />
              </button>
            )}
          </li>
        ))}
        {workHours.entries.length === 0 && <li className="text-neutral-400">還沒有人登記工時。</li>}
      </ul>

      {canLog ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inputClass} w-auto`} aria-label="日期" data-testid="work-date" />
            <input type="number" min={0.25} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} className={`${inputClass} w-24`} aria-label="小時" data-testid="work-hours" />
            {workCategories.length > 1 && (
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${inputClass} w-auto`} aria-label="工時類別">
                {workCategories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="做了什麼(選填)" className={`${inputClass} min-w-40 flex-1`} data-testid="work-note" />
            <button type="button" onClick={submit} disabled={busy || !(Number(hours) > 0)} className={buttonClass} data-testid="work-submit">
              {busy ? "登記中..." : "登記工時"}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-neutral-400">
          {workCategories.length === 0 ? "管理者還沒有設定可連結案件的工時類別(系統設定 → 工時類別 → 勾「可連結案件」)。" : "這個案件已鎖定,不能再登記工時。"}
        </p>
      )}
      {error && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
    </section>
  );
}
