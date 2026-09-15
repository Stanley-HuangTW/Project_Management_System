import { prisma } from "@/lib/prisma";
import { boardWithDataArgs, type BoardWithData, type UserOption } from "@/types/board";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { subordinateIds } from "@/lib/orgChart";
import type { SessionPayload } from "@/lib/jwt";

/**
 * Which boards and which users' workload the dashboard shows for the given
 * session — admins see the whole org; supervisors see themselves plus their
 * team; plain members see only themselves. Shared between the dashboard
 * page itself and any server action (e.g. the workload card's custom date
 * range) that needs to recompute the same numbers outside that render.
 */
export async function resolveWorkloadScope(
  session: SessionPayload
): Promise<{ boards: BoardWithData[]; workloadScope: UserOption[] }> {
  const [boards, users] = await Promise.all([
    prisma.board.findMany({
      where: accessibleBoardWhere(session),
      ...boardWithDataArgs,
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const isSupervisor = session.role === "SUPERVISOR";
  const isAdmin = session.role === "ADMIN";
  const below = subordinateIds(users, session.userId);
  const teamMembers = isSupervisor ? users.filter((u) => below.has(u.id)) : [];
  const currentUser = users.find((u) => u.id === session.userId);
  const workloadScope = isSupervisor
    ? currentUser
      ? [currentUser, ...teamMembers]
      : teamMembers
    : isAdmin
      ? users
      : users.filter((u) => u.id === session.userId);

  return { boards, workloadScope };
}
