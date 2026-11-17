import { requireIssueSession } from "@/lib/issueServer";
import { listIssueOptions } from "@/lib/actions/issueOptions";
import { listIssueUsers } from "@/lib/actions/issueCases";
import { taipeiTodayIso } from "@/lib/timesheet";
import { IssueForm } from "@/components/issues/IssueForm";
import { emptyIssueInput } from "@/lib/issueTypes";

export default async function NewIssuePage() {
  const { role } = await requireIssueSession();
  const [options, users] = await Promise.all([listIssueOptions(), listIssueUsers()]);
  const handling = role === "MANAGER" || role === "HANDLER";
  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">回報新案件</h1>
      <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">案件編號(CS + 發生日期 + 當月流水號)會在送出時自動產生,不會重複。</p>
      <IssueForm
        mode="create"
        initial={emptyIssueInput(taipeiTodayIso())}
        options={options}
        users={users}
        canEditReport
        canEditHandling={handling}
        canAssign={role === "MANAGER"}
      />
    </div>
  );
}
