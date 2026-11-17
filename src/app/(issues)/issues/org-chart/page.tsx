import { requireIssueSession } from "@/lib/issueServer";
import { OrgChartPageContent } from "@/components/pages/OrgChartPageContent";

/** 組織架構圖(ISSUE TRACKER 裡的入口):同一棵組織樹。 */
export default async function IssueOrgChartPage() {
  await requireIssueSession();
  return <OrgChartPageContent />;
}
