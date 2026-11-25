"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { addIssueLog, deleteIssueLog } from "@/lib/actions/issueCases";
import { ISSUE_LOG_KIND_LABELS } from "@/lib/issueCase";
import type { IssueLogDto, IssueLogKind } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { formatDateTime, inputClass, primaryButtonClass } from "./issueUi";

const KIND_STYLE: Record<IssueLogKind, string> = {
  RESPONSE: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  ARRANGEMENT: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200",
  SOLUTION: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  NOTE: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  STAGE: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
};

/** 進度時間軸:回應 / 處理安排 / 解決方案 / 備註。誰、什麼時候寫的都留著;狀態變更等系統動作也會記一筆備註。 */
export function IssueTimeline({
  caseId,
  logs,
  canAdd,
  isManager,
  currentUserId,
  locked,
}: {
  caseId: string;
  logs: IssueLogDto[];
  canAdd: boolean;
  isManager: boolean;
  currentUserId: string;
  locked: boolean;
}) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [kind, setKind] = useState<IssueLogKind>("RESPONSE");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await addIssueLog(caseId, kind, content);
      setContent("");
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "留言失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!(await confirm("確定要刪除這則紀錄嗎?", { title: "刪除紀錄", confirmLabel: "刪除", danger: true }))) return;
    try {
      await deleteIssueLog(id);
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "刪除失敗"));
    }
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="issue-timeline" data-issue-timeline>
      <h2 className="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">進度與解決方案</h2>
      <ol className="mb-4 space-y-3">
        {logs.map((l) => (
          <li key={l.id} className="group rounded-md border border-neutral-100 p-3 dark:border-neutral-800" data-testid="log-item">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              <span className={`rounded px-1.5 py-0.5 font-medium ${KIND_STYLE[l.kind]}`}>{ISSUE_LOG_KIND_LABELS[l.kind]}</span>
              <span>{l.authorName ?? "匯入 / 系統"}</span>
              <span>{formatDateTime(l.createdAt)}</span>
              {(isManager || (l.authorId === currentUserId && !locked)) && (
                <button type="button" onClick={() => void remove(l.id)} title="刪除" className="ml-auto text-neutral-400 opacity-0 hover:text-red-600 group-hover:opacity-100">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-neutral-800 dark:text-neutral-100">{l.content}</p>
          </li>
        ))}
        {logs.length === 0 && <li className="text-sm text-neutral-400">還沒有任何回應或處理紀錄。</li>}
      </ol>

      {canAdd ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value as IssueLogKind)} className={`${inputClass} w-auto`} aria-label="紀錄類型" data-testid="log-kind">
              {Object.entries(ISSUE_LOG_KIND_LABELS).filter(([k]) => k !== "STAGE").map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </select>
          </div>
          <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} placeholder="寫下回應、處理安排、解決方案或備註…" className={inputClass} data-testid="log-content" />
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}
          <button type="button" onClick={submit} disabled={busy || !content.trim()} className={primaryButtonClass} data-testid="log-submit">
            {busy ? "送出中..." : "新增紀錄"}
          </button>
        </div>
      ) : (
        <p className="text-xs text-neutral-400">{locked ? "案件已鎖定,不能再新增紀錄。" : "你不能在這個案件新增紀錄。"}</p>
      )}
    </section>
  );
}
