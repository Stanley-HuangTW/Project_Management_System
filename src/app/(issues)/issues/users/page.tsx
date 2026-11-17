import { requireIssueSession } from "@/lib/issueServer";
import { UsersPageContent } from "@/components/pages/UsersPageContent";

/** 使用者管理(ISSUE TRACKER 裡的入口):跟專案管理系統是同一個頁面、同一份使用者資料。 */
export default async function IssueUsersPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireIssueSession();
  const { tab } = await searchParams;
  return <UsersPageContent base="/issues" tab={tab} />;
}
