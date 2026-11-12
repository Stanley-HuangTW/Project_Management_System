"use client";

import { useEffect, useState } from "react";
import { getPendingApprovalCount } from "@/lib/actions/approvalExtras";

/** 在待我審核頁處理完一筆(或改判)之後發這個事件,側邊欄與鈴鐺的件數馬上更新,不用等下一次輪詢。 */
export const APPROVALS_CHANGED_EVENT = "approvals-changed";

/** 等你審核的件數;每 30 秒問一次,待我審核頁處理完會立刻更新。沒登入 / 出錯就當 0。 */
export function usePendingApprovalCount(enabled = true): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      getPendingApprovalCount().then(
        (n) => {
          if (!cancelled) setCount(n);
        },
        () => {}
      );
    };
    load();
    const interval = setInterval(load, 30000);
    window.addEventListener(APPROVALS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(APPROVALS_CHANGED_EVENT, load);
    };
  }, [enabled]);
  return enabled ? count : 0;
}
