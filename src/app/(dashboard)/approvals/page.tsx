import { requireSession } from "@/lib/session";
import { ApprovalQueue } from "@/components/approvals/ApprovalQueue";

export default async function ApprovalsPage() {
  await requireSession();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">待我審核</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        工時與請假都是送審制:核准前,工時不會計入成本報表,請假也不會改變產能判定。
      </p>
      <ApprovalQueue />
    </div>
  );
}
