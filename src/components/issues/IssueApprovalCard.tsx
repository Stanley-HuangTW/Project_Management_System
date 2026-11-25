"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cancelIssueApproval, decideIssueApproval } from "@/lib/actions/issueApprovals";
import { ISSUE_APPROVAL_LABELS, ISSUE_APPROVAL_STATUS_LABELS, type IssueApprovalDto } from "@/lib/issueApproval";
import { ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import { levelLabel } from "@/lib/approvalLevels";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { buttonClass, formatDateTime, inputClass } from "./issueUi";

const STATUS_STYLE: Record<IssueApprovalDto["status"], string> = {
  PENDING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  APPROVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  CANCELED: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
};

/** 一張案件簽核單:種類、狀態、說明、各階進度,簽核人可以核准 / 退回,申請人與管理者可以撤回。 */
export function IssueApprovalCard({ approval, showCase }: { approval: IssueApprovalDto; showCase?: boolean }) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setComment("");
      router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "操作失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (await confirm("要撤回這張簽核嗎?", { title: "撤回簽核", confirmLabel: "撤回" })) await run(() => cancelIssueApproval(approval.id));
  }

  return (
    <div className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-700" data-testid="approval-card" data-approval-kind={approval.kind} data-approval-status={approval.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">{ISSUE_APPROVAL_LABELS[approval.kind]}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[approval.status]}`} data-testid="approval-status">{ISSUE_APPROVAL_STATUS_LABELS[approval.status]}</span>
        {showCase && (
          <Link href={`/issues/${approval.caseId}`} className="text-blue-700 hover:underline dark:text-blue-400" data-testid="approval-case-link">
            {approval.caseNo}
          </Link>
        )}
        {showCase && approval.summary && <span className="truncate text-xs text-neutral-500">{approval.summary}</span>}
        <span className="ml-auto text-xs text-neutral-400">
          {approval.requesterName ?? "—"} · {formatDateTime(approval.createdAt)}
        </span>
      </div>
      {approval.closeStatus && <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-300">核准後案件狀態:{ISSUE_STATUS_LABELS[approval.closeStatus]}</p>}
      {approval.note && <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-200" data-testid="approval-note">{approval.note}</p>}
      <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400" data-testid="approval-progress">{approval.progress}</p>
      {approval.steps.filter((s) => s.comment).map((s) => (
        <p key={s.level} className="mt-0.5 text-xs text-neutral-500">
          {s.decidedByName ?? "—"}({levelLabel(s.level)}):{s.comment}
        </p>
      ))}
      {approval.canSign && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="意見(退回要填原因)" className={`${inputClass} min-w-48 flex-1`} data-testid="approval-comment" />
          <button type="button" disabled={busy} onClick={() => void run(() => decideIssueApproval(approval.id, "APPROVED", comment))} className={`${buttonClass} border-emerald-300 text-emerald-700 dark:text-emerald-300`} data-testid="approval-approve">
            核准
          </button>
          <button type="button" disabled={busy} onClick={() => void run(() => decideIssueApproval(approval.id, "REJECTED", comment))} className={`${buttonClass} border-red-300 text-red-700 dark:text-red-300`} data-testid="approval-reject">
            退回
          </button>
        </div>
      )}
      {approval.canCancel && (
        <div className="mt-2">
          <button type="button" disabled={busy} onClick={() => void cancel()} className={`${buttonClass} text-neutral-500`} data-testid="approval-cancel">
            撤回申請
          </button>
        </div>
      )}
      {error && <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="approval-error">{error}</div>}
    </div>
  );
}
