"use client";

import Link from "next/link";
import { Check, DoorOpen, FilePenLine, ShieldAlert, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { signCriterion, signGate } from "@/lib/actions/gate";
import { reviewRiskClosure } from "@/lib/actions/risk";
import { decideChangeRequest } from "@/lib/actions/changeRequest";
import { decideActivityTime, decideLeave, decideTimeEntry } from "@/lib/actions/approval";
import type { ApprovalExtras, ApprovalHistoryRow } from "@/lib/actions/approvalExtras";

type Run = (work: () => Promise<{ error?: string }>, failTitle: string) => Promise<void>;

const approveClass =
  "flex items-center gap-1 rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40";
const rejectClass =
  "flex items-center gap-1 rounded border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40";
const listClass =
  "divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900";

export function hasExtras(extras: ApprovalExtras | null): boolean {
  return !!extras && extras.criteria.length + extras.gates.length + extras.risks.length + extras.changes.length > 0;
}

/**
 * 待我審核裡「工時與請假以外」等我表態的東西:出口條件要我確認、閘門要我簽核、風險 / 議題要我審核結案、變更單等我核准。
 * 同意可以寫備註(選填),不同意 / 退回一定要寫原因。
 */
export function ApprovalExtrasSections({ extras, busy, run }: { extras: ApprovalExtras; busy: boolean; run: Run }) {
  const { prompt } = useDialogs();

  async function askNote(required: boolean, what: string): Promise<string | null> {
    return prompt(required ? `請寫下原因,讓對方知道要補什麼。(${what})` : `備註(選填)。(${what})`, {
      title: required ? "寫下原因" : "備註",
      placeholder: required ? "原因" : "備註(選填)",
      required,
      confirmLabel: required ? "送出" : "同意",
    });
  }

  return (
    <>
      {extras.criteria.length > 0 && (
        <section data-extras="criteria">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <DoorOpen size={14} /> 出口條件等你確認 ({extras.criteria.length})
          </h2>
          <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
            有人邀請你確認閘門的出口條件。同意可以寫備註,不同意要寫原因;所有確認人都同意,這一條才算達成。
          </p>
          <ul className={listClass}>
            {extras.criteria.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 text-neutral-800 dark:text-neutral-100">{c.text}</span>
                <Link href={`/boards/${c.boardId}?view=gates`} className="shrink-0 text-neutral-500 hover:text-blue-600 dark:text-neutral-400">
                  {c.boardName} › {c.gateName}
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(false, c.text);
                      if (note !== null) await run(() => signCriterion(c.id, "APPROVED", note), "無法同意");
                    }}
                    className={approveClass}
                  >
                    <Check size={12} /> 同意
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(true, c.text);
                      if (note) await run(() => signCriterion(c.id, "REJECTED", note), "無法表態");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 不同意
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extras.gates.length > 0 && (
        <section data-extras="gates">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <DoorOpen size={14} /> 閘門等你簽核 ({extras.gates.length})
          </h2>
          <ul className={listClass}>
            {extras.gates.map((g) => (
              <li key={g.gateId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <Link href={`/boards/${g.boardId}?view=gates`} className="min-w-0 flex-1 truncate text-neutral-800 hover:text-blue-600 dark:text-neutral-100">
                  {g.gateName}
                </Link>
                <span className="shrink-0 text-neutral-500 dark:text-neutral-400">必要條件 {g.progress}</span>
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{g.boardName}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(false, g.gateName);
                      if (note !== null) await run(() => signGate(g.gateId, "APPROVED", note), "無法簽核");
                    }}
                    className={approveClass}
                  >
                    <Check size={12} /> 同意
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(true, g.gateName);
                      if (note) await run(() => signGate(g.gateId, "REJECTED", note), "無法簽核");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 不同意
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {extras.risks.length > 0 && (
        <section data-extras="risks">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <ShieldAlert size={14} /> 風險 / 議題等你審核結案 ({extras.risks.length})
          </h2>
          <ul className={listClass}>
            {extras.risks.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{r.kindLabel}</span>
                <Link href={`/boards/${r.boardId}?view=risks&risk=${r.id}`} className="min-w-0 flex-1 truncate text-neutral-800 hover:text-blue-600 dark:text-neutral-100">
                  {r.title}
                </Link>
                {r.ownerName && <span className="shrink-0 text-neutral-500 dark:text-neutral-400">負責人 {r.ownerName}</span>}
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{r.boardName}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" disabled={busy} onClick={() => run(() => reviewRiskClosure(r.id, "APPROVE"), "無法同意")} className={approveClass}>
                    <Check size={12} /> 同意結案
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(true, r.title);
                      if (note) await run(() => reviewRiskClosure(r.id, "REJECT", note), "無法退回");
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

      {extras.changes.length > 0 && (
        <section data-extras="changes">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
            <FilePenLine size={14} /> 變更單等你核准 ({extras.changes.length})
          </h2>
          <ul className={listClass}>
            {extras.changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                <span className="shrink-0 tabular-nums text-neutral-500 dark:text-neutral-400">{c.label}</span>
                <Link href={`/boards/${c.boardId}?view=changes`} className="min-w-0 flex-1 truncate text-neutral-800 hover:text-blue-600 dark:text-neutral-100">
                  {c.title}
                </Link>
                {c.requestedByName && <span className="shrink-0 text-neutral-500 dark:text-neutral-400">提出 {c.requestedByName}</span>}
                <span className="shrink-0 text-neutral-400 dark:text-neutral-500">{c.boardName}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(false, c.title);
                      if (note !== null) await run(() => decideChangeRequest(c.id, "APPROVED", note), "無法核准");
                    }}
                    className={approveClass}
                  >
                    <Check size={12} /> 核准
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const note = await askNote(true, c.title);
                      if (note) await run(() => decideChangeRequest(c.id, "REJECTED", note), "無法駁回");
                    }}
                    className={rejectClass}
                  >
                    <X size={12} /> 駁回
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

const KIND_LABEL: Record<ApprovalHistoryRow["kind"], string> = {
  leave: "請假",
  time: "工時",
  activity: "工時",
  criterion: "出口條件",
  gate: "閘門",
  risk: "結案審核",
  change: "變更單",
};

/**
 * 「已處理」:我核准、退回、同意、不同意過的,最近的在前面,可以回溯;還能改判的(工時、請假、
 * 還沒放行的閘門與條件)可以按「改成退回 / 改成核准」——改判一定要寫原因,會留下稽核紀錄、並通知對方。
 */
export function ApprovalHistory({ rows, busy, run }: { rows: ApprovalHistoryRow[]; busy: boolean; run: Run }) {
  const { prompt } = useDialogs();

  async function revise(row: ApprovalHistoryRow) {
    const toApprove = row.decision === "REJECTED";
    const note = await prompt(
      toApprove
        ? `把「${row.title}」改成核准 / 同意,請寫下原因(會留下紀錄並通知對方)。`
        : `把「${row.title}」改成退回 / 不同意,請寫下原因(會留下紀錄並通知對方)。`,
      { title: toApprove ? "改成核准" : "改成退回", placeholder: "原因", required: true, confirmLabel: "確定改判" }
    );
    if (!note) return;
    const status = toApprove ? ("APPROVED" as const) : ("REJECTED" as const);
    const work =
      row.kind === "leave"
        ? () => decideLeave(row.id, status, note)
        : row.kind === "time"
          ? () => decideTimeEntry(row.id, status, note)
          : row.kind === "activity"
            ? () => decideActivityTime(row.id, status, note)
            : row.kind === "criterion"
              ? () => signCriterion(row.id, status, note)
              : () => signGate(row.id, status, note);
    await run(work, "無法改判");
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-200 py-12 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
        還沒有處理過的簽核。
      </p>
    );
  }

  return (
    <div data-approval-history>
      <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        你處理過的簽核,最近 {rows.length} 筆。還能改判的會有「改成…」按鈕;已經放行的閘門、已結案的風險、已核准的變更單不能改判。
      </p>
      <ul className={listClass}>
        {rows.map((row) => (
          <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
            <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{KIND_LABEL[row.kind]}</span>
            <span className="min-w-0 flex-1 truncate text-neutral-800 dark:text-neutral-100" title={row.detail ? `${row.title}・${row.detail}` : row.title}>
              {row.boardId ? (
                <Link href={`/boards/${row.boardId}`} className="hover:text-blue-600">
                  {row.title}
                </Link>
              ) : (
                row.title
              )}
              {row.detail && <span className="ml-2 text-neutral-400 dark:text-neutral-500">{row.detail}</span>}
            </span>
            {row.decision === "APPROVED" ? (
              <span className="flex shrink-0 items-center gap-0.5 text-green-600">
                <Check size={12} /> 同意 / 核准
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-0.5 text-red-600">
                <X size={12} /> 退回 / 不同意
              </span>
            )}
            <span className="shrink-0 tabular-nums text-neutral-400 dark:text-neutral-500">{row.decidedAt.slice(0, 16).replace("T", " ")}</span>
            {row.note && <span className="basis-full truncate pl-1 text-[11px] text-neutral-500 dark:text-neutral-400">備註:{row.note}</span>}
            {row.canRevise && (
              <button type="button" disabled={busy} onClick={() => void revise(row)} data-approval-revise className={rejectClass}>
                {row.decision === "APPROVED" ? "改成退回" : "改成核准"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
