import { redirect } from "next/navigation";
import { requireIssueSession } from "@/lib/issueServer";
import { listAllIssueOptions } from "@/lib/actions/issueOptions";
import { IssueOptionsManager } from "@/components/issues/IssueOptionsManager";
import { IssueImportPanel } from "@/components/issues/IssueImportPanel";

/** 選項管理與 Excel 匯入:只有管理者(含系統管理員)進得來;其他人直接送回列表。 */
export default async function IssueAdminPage() {
  const { role } = await requireIssueSession();
  if (role !== "MANAGER") redirect("/issues");
  const options = await listAllIssueOptions();
  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
      <section>
        <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">選項管理</h1>
        <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">案件表單裡所有下拉選單的選項(原 Sheet 的 _mgt 分頁)。只有管理者可以看與修改。</p>
        <IssueOptionsManager options={options} />
      </section>
      <section>
        <h2 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">從 Excel 匯入</h2>
        <IssueImportPanel />
      </section>
    </div>
  );
}
