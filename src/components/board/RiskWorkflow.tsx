"use client";

import { useState } from "react";
import { Check, Circle, X } from "lucide-react";
import type { RiskStatus } from "@prisma/client";
import { PersonPicker } from "@/components/ui/PersonPicker";
import { useDialogs } from "@/components/ui/DialogProvider";
import { RISK_STATUS_LABELS } from "@/lib/riskRegister";
import {
  addRiskUpdate,
  requestRiskClosure,
  reviewRiskClosure,
  setRiskStatus,
  withdrawRiskClosure,
  type RiskHistoryRow,
  type RiskRow,
  type RiskUpdateRow,
} from "@/lib/actions/risk";
import type { UserOption } from "@/types/board";

export const STATUS_CHIP_CLASS: Record<RiskStatus, string> = {
  OPEN: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  MITIGATING: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  PENDING_REVIEW: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  CLOSED: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
};

const formatTime = (iso: string) => new Date(iso).toLocaleString("zh-TW");

const buttonBase = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50";
const primaryButton = `${buttonBase} bg-blue-600 text-white hover:bg-blue-700`;
const neutralButton = `${buttonBase} border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800`;
const dangerButton = `${buttonBase} border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`;

/** 審核人:一排名字加上「新增審核人」。申請結案後每一位都同意才算解除。 */
export function ReviewerEditor({
  users,
  value,
  onChange,
}: {
  users: UserOption[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? "(已刪除的使用者)";
  const candidates = users.filter((u) => !u.isResource && !value.includes(u.id));
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && <span className="text-xs text-neutral-400 dark:text-neutral-500">還沒有審核人</span>}
        {value.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-0.5 pl-2.5 pr-1 text-xs text-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
          >
            {nameOf(id)}
            <button
              type="button"
              onClick={() => onChange(value.filter((v) => v !== id))}
              aria-label={`移除審核人 ${nameOf(id)}`}
              className="rounded-full p-0.5 text-neutral-400 hover:text-red-600 disabled:pointer-events-none disabled:opacity-40"
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="max-w-xs rounded-md border border-neutral-300 dark:border-neutral-600">
        <PersonPicker
          users={candidates}
          selectedId={null}
          placeholder="新增審核人..."
          onSelect={(id) => id && onChange([...value, id])}
        />
      </div>
    </div>
  );
}

/**
 * 目前狀態與下一步:負責人申請結案、審核人同意或退回、編輯者撤回或重新開啟。
 * 按鈕有哪些,完全由 server 算出來的 permissions 決定。
 */
export function ClosureBar({ risk, onChanged }: { risk: RiskRow; onChanged: () => Promise<void> | void }) {
  const { notify, confirm } = useDialogs();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const p = risk.permissions;
  const approved = risk.reviewers.filter((r) => r.approvedAt).length;

  async function run(action: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await action();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return false;
      }
      await onChanged();
      return true;
    } catch {
      await notify("操作失敗,請重新整理後再試一次。", { title: failTitle });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleRequest() {
    const ok = await confirm(
      `申請結案後,要由 ${risk.reviewers.map((r) => r.name).join("、")} 全部同意才會變成已結案。確定申請?`,
      { title: "申請結案", confirmLabel: "申請結案" }
    );
    if (ok) await run(() => requestRiskClosure(risk.id), "無法申請結案");
  }

  async function handleApprove() {
    const ok = await confirm(`確定同意「${risk.title}」解除嗎?`, { title: "同意解除", confirmLabel: "同意" });
    if (ok) await run(() => reviewRiskClosure(risk.id, "APPROVE"), "無法同意");
  }

  async function handleReject() {
    const done = await run(() => reviewRiskClosure(risk.id, "REJECT", reason), "無法退回");
    if (done) {
      setRejecting(false);
      setReason("");
    }
  }

  const hint =
    risk.status === "CLOSED"
      ? "全部審核人都同意,已結案。"
      : risk.status === "PENDING_REVIEW"
        ? `等審核人同意(${approved}/${risk.reviewers.length}),全部同意才會結案;任何一位退回就回到處理中。`
        : p.canRequestClosure
          ? risk.reviewers.length === 0
            ? "要結案,請先在「審核人」欄位指定至少一位審核人並儲存。"
            : "處理完成後,按「申請結案」,由審核人確認。"
          : "結案要由負責人申請、審核人全部同意。";

  return (
    <div className="space-y-2 rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CHIP_CLASS[risk.status]}`}>
          {RISK_STATUS_LABELS[risk.status]}
        </span>
        <span className="min-w-0 flex-1 text-xs text-neutral-500 dark:text-neutral-400">{hint}</span>
        {p.canRequestClosure && (
          <button
            type="button"
            disabled={busy || risk.reviewers.length === 0}
            onClick={handleRequest}
            className={primaryButton}
          >
            申請結案
          </button>
        )}
        {p.canWithdrawClosure && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => withdrawRiskClosure(risk.id), "無法撤回")}
            className={neutralButton}
          >
            撤回申請
          </button>
        )}
        {p.canReview && !rejecting && (
          <>
            <button type="button" disabled={busy} onClick={handleApprove} className={primaryButton}>
              同意解除
            </button>
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} className={dangerButton}>
              退回…
            </button>
          </>
        )}
        {p.canReopen && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => setRiskStatus(risk.id, "MITIGATING"), "無法重新開啟")}
            className={neutralButton}
          >
            重新開啟
          </button>
        )}
      </div>

      {risk.reviewers.length > 0 && risk.status !== "OPEN" && risk.status !== "MITIGATING" && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 dark:text-neutral-300">
          {risk.reviewers.map((r) => (
            <li key={r.userId} className="flex items-center gap-1" title={r.approvedAt ? formatTime(r.approvedAt) : "尚未同意"}>
              {r.approvedAt ? (
                <Check size={13} className="text-green-600" />
              ) : (
                <Circle size={11} className="text-neutral-300 dark:text-neutral-600" />
              )}
              {r.name}
              {r.approvedAt ? "已同意" : "未同意"}
            </li>
          ))}
        </ul>
      )}

      {rejecting && (
        <div className="space-y-2">
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="退回的原因:哪裡還沒做到、要補什麼(會記在進度更新裡,負責人看得到)"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setRejecting(false);
                setReason("");
              }}
              className={neutralButton}
            >
              取消
            </button>
            <button type="button" disabled={busy || !reason.trim()} onClick={handleReject} className={dangerButton}>
              送出退回
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 負責人的進度更新:新的在上面,寫了不能改。 */
export function UpdatesPanel({
  riskId,
  canPost,
  updates,
  onChanged,
}: {
  riskId: string;
  canPost: boolean;
  updates: RiskUpdateRow[];
  onChanged: () => Promise<void> | void;
}) {
  const { notify } = useDialogs();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function handlePost() {
    setBusy(true);
    try {
      const result = await addRiskUpdate(riskId, text);
      if (result.error) {
        await notify(result.error, { title: "無法送出" });
        return;
      }
      setText("");
      await onChanged();
    } catch {
      await notify("操作失敗,請重新整理後再試一次。", { title: "無法送出" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {canPost ? (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="這一輪做了什麼、目前卡在哪、預計什麼時候完成"
            className="w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500"
          />
          <div className="flex justify-end">
            <button type="button" disabled={busy || !text.trim()} onClick={handlePost} className={primaryButton}>
              送出更新
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-neutral-400 dark:text-neutral-500">只有負責人、建立者與審核人可以寫進度更新。</p>
      )}

      {updates.length === 0 ? (
        <p className="py-4 text-center text-sm text-neutral-400 dark:text-neutral-500">還沒有進度更新。</p>
      ) : (
        <ul className="space-y-2">
          {updates.map((u) => (
            <li key={u.id} className="rounded-md border border-neutral-200 dark:border-neutral-700 px-3 py-2">
              <p className="mb-0.5 text-xs text-neutral-400 dark:text-neutral-500">
                {u.authorName ?? "(已刪除的使用者)"}・{formatTime(u.createdAt)}
              </p>
              <p className="whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-100">{u.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 建立、修改欄位、進度更新、申請結案與審核的紀錄。 */
export function HistoryPanel({ history }: { history: RiskHistoryRow[] }) {
  if (history.length === 0) {
    return <p className="py-4 text-center text-sm text-neutral-400 dark:text-neutral-500">還沒有紀錄。</p>;
  }
  return (
    <ul className="divide-y divide-neutral-100 dark:divide-neutral-700">
      {history.map((h) => (
        <li key={h.id} className="flex items-start gap-3 py-2 text-sm">
          <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-100">
            <span className="mr-2 text-neutral-500 dark:text-neutral-400">{h.actorName ?? "系統"}</span>
            {h.message}
          </span>
          <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">{formatTime(h.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
