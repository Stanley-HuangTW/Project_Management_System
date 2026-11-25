import type { ReactNode } from "react";
import { prisma } from "@/lib/prisma";
import { requireIssueSession, loadSystemAccess } from "@/lib/issueServer";
import { DialogProvider } from "@/components/ui/DialogProvider";
import { ImpersonationBanner } from "@/components/sidebar/ImpersonationBanner";
import { IssueSidebar } from "@/components/issues/IssueSidebar";
import { countPendingForUser } from "@/lib/issueApprovalServer";
import { HelpButton } from "@/components/help/HelpButton";
import { ElementPicker } from "@/components/help/ElementPicker";

/** ISSUE TRACKER 的外框:跟專案管理系統共用帳號與網址,有自己的側邊欄;沒有權限的人進不來。 */
export default async function IssuesLayout({ children }: { children: ReactNode }) {
  const { session, role } = await requireIssueSession();
  const [access, user, feedbackOpen, pendingApprovals] = await Promise.all([
    loadSystemAccess(session),
    prisma.user.findUnique({ where: { id: session.userId }, select: { avatarUrl: true } }),
    // 管理者:還沒處理的使用者回報有幾則(側邊欄「使用者回報」旁邊標數字)。
    session.role === "ADMIN" ? prisma.userFeedback.count({ where: { status: "OPEN" } }) : Promise.resolve(0),
    // 等我簽核的案件簽核有幾張(側邊欄「待我簽核」旁邊標數字)。
    countPendingForUser(session.userId),
  ]);

  return (
    <DialogProvider>
      <div className="flex h-screen w-full flex-col">
        {session.impersonatorId && <ImpersonationBanner name={session.name} adminName={session.impersonatorName ?? ""} />}
        <div className="flex min-h-0 w-full flex-1 flex-col md:flex-row">
          <IssueSidebar
            userName={session.name}
            isAdmin={session.role === "ADMIN"}
            issueRole={role}
            avatarUrl={user?.avatarUrl ?? null}
            impersonating={!!session.impersonatorId}
            canSwitchToPm={access.pm}
            feedbackOpen={feedbackOpen}
            pendingApprovals={pendingApprovals}
          />
          <div className="min-h-0 flex-1 overflow-auto bg-neutral-50 pb-16 dark:bg-neutral-800">{children}</div>
          <HelpButton isAdmin={session.role === "ADMIN"} impersonating={!!session.impersonatorId} />
          <ElementPicker isAdmin={session.role === "ADMIN"} impersonating={!!session.impersonatorId} />
        </div>
      </div>
    </DialogProvider>
  );
}
