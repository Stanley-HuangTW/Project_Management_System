import { requireIssueSession } from "@/lib/issueServer";
import { ManualPageContent } from "@/components/pages/ManualPageContent";

/** 使用手冊(ISSUE TRACKER 裡的入口):同一份手冊,留在 ISSUE TRACKER 的外框裡。 */
export default async function IssueManualPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireIssueSession();
  const { q = "" } = await searchParams;
  return <ManualPageContent base="/issues" q={q} />;
}
