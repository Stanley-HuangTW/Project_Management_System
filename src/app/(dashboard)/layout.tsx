import type { ReactNode } from "react";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { BoardSidebar } from "@/components/sidebar/BoardSidebar";
import { hasApprovalRole } from "@/lib/actions/approval";
import { BoardAdminActionsProvider } from "@/components/board/BoardAdminActions";
import { DialogProvider } from "@/components/ui/DialogProvider";
import { ImpersonationBanner } from "@/components/sidebar/ImpersonationBanner";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireSession();
  const [boards, currentUser] = await Promise.all([
    prisma.board.findMany({
      where: accessibleBoardWhere(session),
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, programId: true, ownerId: true },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { avatarUrl: true } }),
  ]);

  // Groups are listed from the boards this person can already open, so a
  // group whose boards are all closed to them never appears — and the count
  // beside it is what they would actually see inside it.
  const programRows = await prisma.program.findMany({
    where: { boards: { some: { id: { in: boards.map((b) => b.id) } } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const isApprover = await hasApprovalRole();
  const programs = programRows.map((program) => ({
    ...program,
    boardCount: boards.filter((b) => b.programId === program.id).length,
  }));

  return (
    <DialogProvider>
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
          userName={session.name}
          userRole={session.role}
          currentUserId={session.userId}
          avatarUrl={currentUser?.avatarUrl}
          impersonating={!!session.impersonatorId}
        />
        {/* pt-12 clears the fixed mobile bar the sidebar renders below md. */}
        <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-800 pt-12 md:pt-0">{children}</div>
      </div>
      </div>
    </BoardAdminActionsProvider>
    </DialogProvider>
  );
}
