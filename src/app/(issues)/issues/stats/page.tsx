import { requireIssueSession } from "@/lib/issueServer";
import { getIssueStats } from "@/lib/actions/issueStats";
import { IssueStatsView } from "@/components/issues/IssueStatsView";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function IssueStatsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireIssueSession();
  const sp = await searchParams;
  const from = one(sp.from);
  const to = one(sp.to);
  const stats = await getIssueStats({ from, to });
  return <IssueStatsView stats={stats} from={from} to={to} />;
}
