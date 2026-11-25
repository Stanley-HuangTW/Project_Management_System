import { listIssueApprovals } from "@/lib/actions/issueApprovals";
import { IssueApprovalCard } from "@/components/issues/IssueApprovalCard";

/** 待我簽核:等我簽的案件簽核(結案、轉維修、外勤)、我送出的、最近處理完的。 */
export default async function IssueApprovalsPage() {
  const { toSign, mine, recent } = await listIssueApprovals();
  const section = (title: string, testid: string, items: typeof toSign, empty: string) => (
    <section className="mb-6" data-testid={testid}>
      <h2 className="mb-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100">
        {title}
        <span className="ml-2 text-xs font-normal text-neutral-400">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="text-sm text-neutral-400">{empty}</p>
      ) : (
        <div className="space-y-2">
          {items.map((a) => (
            <IssueApprovalCard key={a.id} approval={a} showCase />
          ))}
        </div>
      )}
    </section>
  );
  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6" data-issue-approvals>
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">待我簽核</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">案件的結案、轉維修、外勤申請。簽核人依案件負責人的主管鏈(組織架構圖);找不到主管時由管理者簽。</p>
      {section("等我簽核", "approvals-to-sign", toSign, "目前沒有等你簽的。")}
      {section("我送出的", "approvals-mine", mine, "你還沒有送過簽核。")}
      {section("最近處理完的", "approvals-recent", recent, "還沒有處理完的簽核。")}
    </div>
  );
}
