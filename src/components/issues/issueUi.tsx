import { Lock } from "lucide-react";
import { ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from "@/lib/issueCase";
import type { IssuePriority, IssueStatus } from "@/lib/issueTypes";

export const inputClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-blue-500 disabled:bg-neutral-100 dark:disabled:bg-neutral-800 disabled:text-neutral-500";

export const buttonClass =
  "flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800";

export const primaryButtonClass = "rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";

const STATUS_STYLE: Record<IssueStatus, string> = {
  OPEN: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  TC: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  PC: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  NA: "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200",
};

export function StatusBadge({ status, locked }: { status: IssueStatus; locked?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>
      {ISSUE_STATUS_LABELS[status]}
      {locked && <Lock size={10} aria-label="已確認並鎖定" />}
    </span>
  );
}

const PRIORITY_STYLE: Record<IssuePriority, string> = {
  P0: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  P1: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200",
  P2: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  P3: "bg-neutral-50 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400",
};

export function PriorityBadge({ priority }: { priority: IssuePriority }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLE[priority]}`} title={ISSUE_PRIORITY_LABELS[priority]}>
      {priority}
    </span>
  );
}

export function formatDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 3_600_000);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}
