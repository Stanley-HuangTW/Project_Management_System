"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestIssueApproval } from "@/lib/actions/issueApprovals";
import { ISSUE_APPROVAL_LABELS, type IssueApprovalDto, type IssueApprovalKind } from "@/lib/issueApproval";
import { actionErrorMessage } from "@/lib/userError";
import { IssueApprovalCard } from "./IssueApprovalCard";
import { buttonClass, inputClass, primaryButtonClass } from "./issueUi";

const HINT: Record<IssueApprovalKind, string> = {
  CLOSE: "送出後案件進到「結案簽核中」,主管核准就結案並鎖定;退回會回到原來的階段。",
  TO_REPAIR: "主管核准後,這個問題轉成維修(Repair),案號不變,階段到「運送中」。申請期間不能推進階段。",
  FIELD_TRIP: "安排 FAE 外勤要主管同意:請寫清楚地點與事由。核准後會記在時間軸,案件階段不變。",
};

/** 案件頁的簽核區:可以送的簽核(結案、轉維修、外勤)與這個案件的簽核紀錄。 */
export function IssueApprovalPanel({ caseId, approvals }: { caseId: string; approvals: { items: IssueApprovalDto[]; available: IssueApprovalKind[] } }) {
  const router = useRouter();
  const [open, setOpen] = useState<IssueApprovalKind | null>(null);
  const [note, setNote] = useState("");
  const [closeStatus, setCloseStatus] = useState<"TC" | "PC">("PC");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (approvals.items.length === 0 && approvals.available.length === 0) return null;

  async function submit() {
    if (!open) return;
    setBusy(true);
    setMessage(null);
    try {
      const r = await requestIssueApproval(caseId, open, { note, closeStatus });
      setMessage({ ok: true, text: r.approved ? "已核准(你就是最高主管,不需要別人簽)" : "已送出,等主管簽核" });
      setOpen(null);
      setNote("");
      router.refresh();
    } catch (err) {
      setMessage({ ok: false, text: actionErrorMessage(err, "送出失敗") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900" data-testid="approval-panel" data-issue-approval>
      <h2 className="mb-2 text-sm font-semibold text-neutral-900 dark:text-neutral-100">簽核</h2>
      {approvals.available.length > 0 && (
        <div className="mb-3">
          <div className="flex flex-wrap gap-2">
            {approvals.available.map((k) => (
              <button key={k} type="button" disabled={busy} onClick={() => { setOpen(open === k ? null : k); setMessage(null); }} className={`${buttonClass} ${open === k ? "border-blue-400 text-blue-700" : ""}`} data-testid={`approval-request-${k}`}>
                申請{ISSUE_APPROVAL_LABELS[k]}
              </button>
            ))}
          </div>
          {open && (
            <div className="mt-2 space-y-2 rounded-md bg-neutral-50 p-3 dark:bg-neutral-800" data-testid="approval-form">
              <p className="text-xs text-neutral-500 dark:text-neutral-400">{HINT[open]}</p>
              {open === "CLOSE" && (
                <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-200">
                  結案後的狀態
                  <select value={closeStatus} onChange={(e) => setCloseStatus(e.target.value as "TC" | "PC")} className={inputClass} data-testid="approval-close-status">
                    <option value="PC">永久解決 PC</option>
                    <option value="TC">暫時解決 TC</option>
                  </select>
                </label>
              )}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={open === "FIELD_TRIP" ? "外勤地點與事由(必填)" : "說明(選填)"} className={`${inputClass} w-full`} data-testid="approval-note-input" />
              <button type="button" disabled={busy} onClick={() => void submit()} className={primaryButtonClass} data-testid="approval-submit">
                送出{ISSUE_APPROVAL_LABELS[open]}
              </button>
            </div>
          )}
        </div>
      )}
      {message && (
        <div className={`mb-2 rounded-md px-3 py-2 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`} role="alert" data-testid="approval-message">{message.text}</div>
      )}
      <div className="space-y-2">
        {approvals.items.map((a) => (
          <IssueApprovalCard key={a.id} approval={a} />
        ))}
      </div>
    </section>
  );
}
