import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { auditFilterOptions } from "@/lib/actions/audit";
import { AuditLog } from "@/components/audit/AuditLog";

export default async function AuditPage() {
  const session = await requireSession();
  // The log names who changed whose rate and who made whose work private —
  // showing it to a non-admin would hand out what 可見範圍 exists to withhold.
  if (session.role !== "ADMIN") notFound();

  const { boards, actors } = await auditFilterOptions();

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">稽核軌跡</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        誰在什麼時候改了什麼。費率、基準線、可見範圍、看板刪除、閘門與變更的決定、工時與請假的審核,都在這裡。
        「審核結果」列出所有人核准 / 退回過的簽核,可以在那裡修訂原來的結果。
      </p>
      <AuditLog boards={boards} actors={actors} />
    </div>
  );
}
