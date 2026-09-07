import type { ReactNode } from "react";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { BoardSidebar } from "@/components/sidebar/BoardSidebar";
import { BoardAdminActionsProvider } from "@/components/board/BoardAdminActions";

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
      select: { id: true, name: true },
    }),
    prisma.user.findUnique({ where: { id: session.userId }, select: { avatarUrl: true } }),
  ]);

  return (
    <BoardAdminActionsProvider>
      <div className="flex h-screen w-full">
        <BoardSidebar
          boards={boards}
          userName={session.name}
          userRole={session.role}
          avatarUrl={currentUser?.avatarUrl}
        />
        <div className="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-800">{children}</div>
      </div>
    </BoardAdminActionsProvider>
  );
}
