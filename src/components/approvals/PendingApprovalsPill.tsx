"use client";

import { usePendingApprovalCount } from "./usePendingApprovalCount";

/** 側邊欄「待我審核」旁邊的件數:有幾件事項等你審核;沒有就不顯示。 */
export function PendingApprovalsPill() {
  const count = usePendingApprovalCount();
  if (count === 0) return null;
  return (
    <span
      data-pending-approvals-pill
      title={`${count} 件事項等你審核`}
      className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
