import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { UserOption } from "@/types/board";
import { GroupRolesPage } from "@/components/board/GroupRolesPage";
import { ledGroupIds } from "@/lib/groupLeaderServer";

export default async function GroupRolesSettingsPage() {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";
  // 不是管理者:只有擔任 Team Leader 的分組看得到,而且只看得到那些分組(在裡面指定 DM 與各職能的 member)。
  const ledGroups = isAdmin ? null : await ledGroupIds(session.userId);
  if (!isAdmin && (ledGroups?.length ?? 0) === 0) {
    redirect("/boards");
  }

  const [boards, users, resources] = await Promise.all([
    prisma.board.findMany({
      where: { deletedAt: null, ...(ledGroups ? { groups: { some: { id: { in: ledGroups } } } } : {}) },
      select: {
        id: true,
        name: true,
        roleAssignments: { select: { role: true, userId: true } },
        groups: {
          ...(ledGroups ? { where: { id: { in: ledGroups } } } : {}),
          orderBy: { order: "asc" },
          select: {
            id: true,
            name: true,
            roleOverrides: true,
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
        {isAdmin
          ? "設定 Team Leader(專案負責人)/ SW-HW-ME-QA DM / PMM / PMD,決定誰能調整時程或管理項目。每個看板先設「看板角色」,底下的分組預設沿用;分組可以逐一角色改成自己的。"
          : "你是下面這些分組的 Team Leader(專案負責人):可以從公司人員裡指定這個專案的 DM 與各職能的 member。Team Leader / PMM / PMD 由管理者設定。"}
      </p>
      <GroupRolesPage boards={boards} users={assignees} leaderOnly={!isAdmin} />
    </div>
  );
}
