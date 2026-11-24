import { listIssueCases } from "@/lib/actions/issueCases";
import { listIssueOptions } from "@/lib/actions/issueOptions";
import { listIssueUsers } from "@/lib/actions/issueCases";
import { IssueListView } from "@/components/issues/IssueListView";
import type { IssueFilters, IssueKind, IssuePriority, IssueStatus } from "@/lib/issueTypes";

const STATUSES: IssueStatus[] = ["OPEN", "TC", "PC", "NA"];

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** 網址參數 → 篩選條件。網址就是篩選的唯一來源:可以分享、可以回上一頁。 */
function filtersFrom(sp: SP): IssueFilters {
  const statuses = one(sp.status).split(",").filter((s): s is IssueStatus => STATUSES.includes(s as IssueStatus));
  return {
    q: one(sp.q) || undefined,
    statuses: statuses.length ? statuses : undefined,
    kind: (one(sp.kind) as IssueKind) || "",
    priority: (one(sp.priority) as IssuePriority) || "",
    productId: one(sp.product) || undefined,
    customerId: one(sp.customer) || undefined,
    errorTypeId: one(sp.error) || undefined,
    unitId: one(sp.unit) || undefined,
    assigneeId: one(sp.assignee) || undefined,
    unassigned: one(sp.unassigned) === "1",
    mantis: one(sp.mantis) === "1" ? "1" : one(sp.mantis) === "0" ? "0" : "",
    mine: one(sp.mine) === "1",
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    page: Number(one(sp.page)) || 1,
  };
}

export default async function IssuesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const filters = filtersFrom(await searchParams);
  const [result, options, users] = await Promise.all([listIssueCases(filters), listIssueOptions(), listIssueUsers()]);
  return <IssueListView result={result} filters={filters} options={options} users={users} />;
}
