"use client";

import { useEffect, useState } from "react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { listAllApprovalDecisions, type ApprovalHistoryRow } from "@/lib/actions/approvalExtras";
import { ApprovalHistory } from "@/components/approvals/ApprovalExtrasSections";
import { actionErrorMessage } from "@/lib/userError";

/**
 * 稽核軌跡的「審核結果」:所有人處理過的核准、退回、同意、不同意,管理者可以在這裡修訂原來的結果。
 * 篩選條件(看板、處理的人、日期)跟「稽核紀錄」那一頁共用。改判走的是跟待我審核一樣的動作,
 * 一樣要寫原因、會留下稽核紀錄並通知對方。
 */
export function AuditDecisions({
  boardId,
  actorId,
  from,
  to,
}: {
  boardId: string;
  actorId: string;
  from: string;
  to: string;
}) {
  const { notify } = useDialogs();
  const [rows, setRows] = useState<ApprovalHistoryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  // 改判成功就加一,讓清單重新讀。
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listAllApprovalDecisions({
        boardId: boardId || null,
        deciderId: actorId || null,
        from: from || null,
        to: to || null,
      });
      if (!cancelled) setRows(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId, actorId, from, to, version]);

  async function run(work: () => Promise<{ error?: string }>, failTitle: string) {
    setBusy(true);
    try {
      const result = await work();
      if (result.error) {
        await notify(result.error, { title: failTitle });
        return;
      }
      setVersion((v) => v + 1);
    } catch (err) {
      await notify(actionErrorMessage(err, "操作失敗"), { title: failTitle });
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <p className="text-xs text-neutral-400 dark:text-neutral-500">載入中...</p>;
  return <ApprovalHistory rows={rows} busy={busy} run={run} showDecider />;
}
