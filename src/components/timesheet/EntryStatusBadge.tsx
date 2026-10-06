"use client";

import type { ApprovalStatus } from "@prisma/client";
import { EXEMPT_DECISION_NOTE } from "@/lib/timesheetApprovalLabels";

/**
 * 一筆工時的審核狀態:待審的列出誰可以核准;已核准的記誰核准的(免審核的註明免審核);
 * 已退回的帶退回原因。誰允許的要看得到。
 */
export function EntryStatusBadge({
  status,
  approvers,
  decidedByName,
  decisionNote,
}: {
  status: ApprovalStatus;
  /** 待審時:可以核准的人,例如「王大明(Team Leader)」。 */
  approvers: string[];
  decidedByName: string | null;
  decisionNote: string | null;
}) {
  if (status === "PENDING") {
    const list = approvers.length > 0 ? approvers.join("、") : "找不到核准人,請洽管理者";
    return (
      <span className="flex min-w-0 shrink items-center gap-1" title={`核准前不會計入成本。可以核准的人:${list}`}>
        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          待審
        </span>
        <span className="max-w-[16rem] truncate text-[11px] text-neutral-400 dark:text-neutral-500">核准人:{list}</span>
      </span>
    );
  }
  if (status === "REJECTED") {
    return (
      <span className="flex min-w-0 shrink items-center gap-1" title={decisionNote ?? undefined}>
        <span className="shrink-0 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
          已退回
        </span>
        <span className="max-w-[16rem] truncate text-[11px] text-neutral-400 dark:text-neutral-500">
          {decidedByName ? `${decidedByName}:` : ""}
          {decisionNote ?? ""}
        </span>
      </span>
    );
  }
  // 已核准:只有「有人核准過」或「免審核」才值得標;一般沒有對應專案的非專案工時登記即生效,不標。
  if (decidedByName || decisionNote === EXEMPT_DECISION_NOTE) {
    return (
      <span className="shrink-0 text-[11px] text-green-700 dark:text-green-400" title={decisionNote ?? undefined}>
        {decidedByName ? `已核准・${decidedByName}` : "免審核"}
      </span>
    );
  }
  return null;
}
