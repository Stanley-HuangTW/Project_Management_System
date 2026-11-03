import type { ReactNode } from "react";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { BoardSidebar } from "@/components/sidebar/BoardSidebar";
import { hasApprovalRole } from "@/lib/actions/approval";
import { applyStoredOrder } from "@/lib/sidebarOrder";
import { BoardAdminActionsProvider } from "@/components/board/BoardAdminActions";
import { DialogProvider } from "@/components/ui/DialogProvider";
import { ImpersonationBanner } from "@/components/sidebar/ImpersonationBanner";
import { ChatProvider } from "@/components/chat/ChatProvider";
import { getUnreadTotal } from "@/lib/chatServer";
import { PROJECT_DASHBOARD_ROLES } from "@/lib/projectRoles";
import { HelpButton } from "@/components/help/HelpButton";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const [boardRows, currentUser] = await Promise.all([
    prisma.board.findMany({
      where: accessibleBoardWhere(session),
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, programId: true, ownerId: true },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { avatarUrl: true, boardOrder: true, programOrder: true } }),
  ]);
  // 側邊欄的順序是這個人自己排的(沒排過的照建立時間)。
  const boards = applyStoredOrder(boardRows, currentUser?.boardOrder ?? []);

  // Groups are listed from the boards this person can already open, so a
  // group whose boards are all closed to them never appears — and the count
  // beside it is what they would actually see inside it.
  const programRows = await prisma.program.findMany({
    where: { boards: { some: { id: { in: boards.map((b) => b.id) } } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const isApprover = await hasApprovalRole();
  // 這個人在哪些看板上有專案角色(Team Leader、PMD、各職能 DM):每個看板一個「看板名稱-儀表板」子項。
  // 看板層級的角色已經複製到分組裡(見 boardRolesServer),所以只要查分組的角色。
  const projectRoleRows = await prisma.groupRoleAssignment.findMany({
    where: { userId: session.userId, role: { in: PROJECT_DASHBOARD_ROLES }, group: { board: { deletedAt: null } } },
    select: { role: true, group: { select: { boardId: true } } },
  });
  // 擔任 Team Leader 的人在側邊欄也看得到「分組角色設定」(只能設自己負責的分組)。
  const canManageProjectTeam = projectRoleRows.some((r) => r.role === "TEAM_LEADER");
  const projectBoardIds = new Set(projectRoleRows.map((r) => r.group.boardId));
  const projectDashboards = boards.filter((b) => projectBoardIds.has(b.id)).map((b) => ({ id: b.id, name: b.name }));
  // 代操作時不開對話(發言會變成被代操作的人說的)。
  const chatEnabled = !session.impersonatorId;
  const chatUnread = chatEnabled ? await getUnreadTotal(session) : 0;
  // 管理者:還沒處理的使用者回報有幾則(側邊欄「使用者回報」旁邊標數字)。
  const feedbackOpen = session.role === "ADMIN" ? await prisma.userFeedback.count({ where: { status: "OPEN" } }) : 0;
  const programs = applyStoredOrder(programRows, currentUser?.programOrder ?? []).map((program) => ({
    ...program,
    boardCount: boards.filter((b) => b.programId === program.id).length,
  }));

  return (
    <DialogProvider>
    <ChatProvider enabled={chatEnabled} initialUnread={chatUnread}>
    <BoardAdminActionsProvider>
      <div className="flex h-screen w-full flex-col">
      {session.impersonatorId && (
        <ImpersonationBanner name={session.name} adminName={session.impersonatorName ?? ""} />
      )}
      <div className="flex min-h-0 w-full flex-1">
        <BoardSidebar
          boards={boards}
          programs={programs}
          isApprover={isApprover}
          projectDashboards={projectDashboards}
          canManageProjectTeam={canManageProjectTeam}
          userName={session.name}
          userRole={session.role}
          currentUserId={session.userId}
          avatarUrl={currentUser?.avatarUrl}
          impersonating={!!session.impersonatorId}
          feedbackOpen={feedbackOpen}
        />
        {/* pt-12 clears the fixed mobile bar the sidebar renders below md. */}
        <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-800 pt-12 md:pt-0">{children}</div>
        <HelpButton isAdmin={session.role === "ADMIN"} impersonating={!!session.impersonatorId} />
      </div>
      </div>
    </BoardAdminActionsProvider>
    </ChatProvider>
    </DialogProvider>
  );
}
