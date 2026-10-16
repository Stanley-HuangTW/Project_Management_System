import { requireSession } from "@/lib/session";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";

export default async function ApprovalsPage() {
  await requireSession();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">待我審核</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        工時與請假都是送審制:核准前,工時不會計入成本報表,請假也不會改變產能判定。工時可以由該專案分組的
        Team Leader / PMD、同部門的 DM(只限同部門同仁)、送審者的直屬主管或管理者核准,誰核准的都會記錄;
        請假由直屬主管或管理者核准。系統設定的「簽核層級」若要求二階、三階主管,各階都同意才算核准。
      </p>
      <ApprovalQueue />
    </div>
  );
}
