import { requireIssueSession } from "@/lib/issueServer";
import { ManualPageContent } from "@/components/pages/ManualPageContent";

/** 使用手冊(ISSUE TRACKER 裡的入口):ISSUE TRACKER 自己的手冊,跟專案管理系統的手冊分開,留在 ISSUE TRACKER 的外框裡。 */
export default async function IssueManualPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireIssueSession();
  const { q = "" } = await searchParams;
  return <ManualPageContent base="/issues" q={q} kind="issues" />;
}
