import { requireIssueSession } from "@/lib/issueServer";
import { TimesheetPageContent } from "@/components/pages/TimesheetPageContent";

/** 工時(ISSUE TRACKER 裡的入口):跟專案管理系統是同一套工時,案件處理的時間登記在這裡。 */
export default async function IssueTimesheetPage() {
  await requireIssueSession();
  return <TimesheetPageContent />;
}
