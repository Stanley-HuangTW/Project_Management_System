"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Lock, Trash2, Unlock, UserPlus } from "lucide-react";
import { claimIssueCase, confirmIssueCase, deleteIssueCase, unlockIssueCase } from "@/lib/actions/issueCases";
import type { IssueOptionDto } from "@/lib/issueOptions";
import { inputFromDetail, type IssueCaseDetail, type IssueUserDto } from "@/lib/issueTypes";
import { actionErrorMessage } from "@/lib/userError";
import { useDialogs } from "@/components/ui/DialogProvider";
import { IssueForm } from "./IssueForm";
import { IssueTimeline } from "./IssueTimeline";
import { IssueAttachments } from "./IssueAttachments";
import { PriorityBadge, StatusBadge, buttonClass, formatDateTime } from "./issueUi";

export function IssueDetailView({
  detail,
  options,
  users,
  currentUserId,
}: {
  detail: IssueCaseDetail;
  options: IssueOptionDto[];
  users: IssueUserDto[];
  currentUserId: string;
}) {
  const router = useRouter();
  const { confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = detail.confirmedAt !== null;
  const dayLabel = detail.dayMode === "WORKDAY" ? "工作天" : "日曆天";

  async function run(fn: () => Promise<void>, after?: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (after) after();
      else router.refresh();
    } catch (err) {
      setError(actionErrorMessage(err, "操作失敗"));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm() {
    const ok = await confirm("確認這個案件已經處理完成嗎?確認後案件會鎖定:回報人不能再改,只有管理者可以修改或解除鎖定。", {
      title: "確認完成並鎖定",
      confirmLabel: "確認完成",
    });
    if (ok) await run(() => confirmIssueCase(detail.id));
  }

  async function onDelete() {
    const ok = await confirm(`確定要刪除案件 ${detail.caseNo} 嗎?案件編號會保留,不會再被使用。`, { title: "刪除案件", confirmLabel: "刪除", danger: true });
    if (ok) await run(() => deleteIssueCase(detail.id), () => router.push("/issues"));
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <Link href="/issues" className="mb-3 inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100">
        <ArrowLeft size={12} /> 回案件列表
      </Link>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100" data-testid="case-no">{detail.caseNo}</h1>
        <StatusBadge status={detail.status} locked={locked} />
        <PriorityBadge priority={detail.priority} />
        <span className="text-sm text-neutral-500 dark:text-neutral-400" data-testid="case-days" data-issue-days>
          {detail.days !== null
            ? `處理 ${detail.days} ${dayLabel}`
            : detail.openDays !== null
              ? `已開 ${detail.openDays} ${dayLabel}`
              : ""}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {detail.can.claim && (
            <button type="button" disabled={busy} onClick={() => void run(() => claimIssueCase(detail.id))} className={buttonClass} data-testid="claim">
              <UserPlus size={14} /> 接手
            </button>
          )}
          {detail.can.confirm && (
            <button type="button" disabled={busy} onClick={() => void onConfirm()} className={`${buttonClass} border-emerald-300 text-emerald-700 dark:text-emerald-300`} data-testid="confirm-case" data-issue-lock>
              <CheckCircle2 size={14} /> 確認完成
            </button>
          )}
          {detail.can.manage && locked && (
            <button type="button" disabled={busy} onClick={() => void run(() => unlockIssueCase(detail.id))} className={buttonClass} data-testid="unlock-case">
              <Unlock size={14} /> 解除鎖定
            </button>
          )}
          {detail.can.manage && (
            <button type="button" disabled={busy} onClick={() => void onDelete()} className={`${buttonClass} text-red-600`} data-testid="delete-case">
              <Trash2 size={14} /> 刪除
            </button>
          )}
        </div>
      </div>

      {locked && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200" data-testid="locked-banner" data-issue-lock>
          <Lock size={14} /> 已由 {detail.confirmedByName ?? "—"} 於 {formatDateTime(detail.confirmedAt!)} 確認完成並鎖定。
        </div>
      )}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</div>}

      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        回報人:{detail.reporterName ?? "(匯入)"} · 建立於 {formatDateTime(detail.createdAt)}
        {detail.firstResponseAt ? ` · 首次回覆:${formatDateTime(detail.firstResponseAt)}` : " · 尚未回覆"}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <IssueForm
          key={`${detail.id}-${detail.logs.length}-${detail.confirmedAt}-${detail.status}-${detail.assigneeIds.join()}`}
          mode="edit"
          caseId={detail.id}
          initial={inputFromDetail(detail)}
          options={options}
          users={users}
          canEditReport={detail.can.editReport}
          canEditHandling={detail.can.editHandling}
          canAssign={detail.can.manage}
          locked={locked}
        />
        <div className="space-y-4">
          <IssueTimeline caseId={detail.id} logs={detail.logs} canAdd={detail.can.addLog} isManager={detail.can.manage} currentUserId={currentUserId} locked={locked} />
          <IssueAttachments
            caseId={detail.id}
            attachments={detail.attachments}
            canAdd={detail.can.addLog}
            canDelete={() => detail.can.manage || (detail.can.addLog && !locked)}
          />
        </div>
      </div>
    </div>
  );
}
