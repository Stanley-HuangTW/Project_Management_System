import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { UserOption } from "@/types/board";
import { GroupRolesPage } from "@/components/board/GroupRolesPage";

export default async function GroupRolesSettingsPage() {
  const session = await requireSession();
  if (session.role !== "ADMIN") {
    redirect("/boards");
  }

  const [boards, users, resources] = await Promise.all([
    prisma.board.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        name: true,
        groups: {
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            roleAssignments: { select: { role: true, userId: true } },
            members: { select: { discipline: true, userId: true } },
            resourceMembers: { select: { resourceId: true } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true, discipline: true },
      orderBy: { name: "asc" },
    }),
    prisma.resource.findMany({ orderBy: { order: "asc" } }),
  ]);

  const assignees: UserOption[] = [
    ...users,
    ...resources.map((r) => ({
      id: r.id,
      name: r.category ? `${r.name} (${r.category})` : r.name,
      supervisorId: null,
      avatarUrl: null,
      isResource: true,
    })),
  ];

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">分組角色設定</h1>
      <p className="mb-4 text-sm text-neutral-400 dark:text-neutral-500">
        設定每個分組的 Team Leader / SW-HW-ME-QA DM / PMM / PMD,決定誰能在該分組調整時程或管理項目。
      </p>
      <GroupRolesPage boards={boards} users={assignees} />
    </div>
  );
}
