import { requireIssueSession } from "@/lib/issueServer";
import { FeedbackPageContent } from "@/components/pages/FeedbackPageContent";

/** 使用者回報(ISSUE TRACKER 裡的入口):同一份回報,每則標明來自哪個系統。只有系統管理員看得到。 */
export default async function IssueFeedbackPage() {
  await requireIssueSession();
  return <FeedbackPageContent />;
}
