import { notFound } from "next/navigation";
import { requireIssueSession } from "@/lib/issueServer";
import { getIssueCase, listIssueUsers } from "@/lib/actions/issueCases";
import { listIssueOptions } from "@/lib/actions/issueOptions";
import { IssueDetailView } from "@/components/issues/IssueDetailView";

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { session } = await requireIssueSession();
  const { id } = await params;
  const [detail, options, users] = await Promise.all([getIssueCase(id), listIssueOptions(), listIssueUsers()]);
  if (!detail) notFound();
  return <IssueDetailView detail={detail} options={options} users={users} currentUserId={session.userId} />;
}
