import { prisma } from "@/lib/prisma";
import { boardWithDataArgs, type BoardWithData, type UserOption } from "@/types/board";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { teamViewIdsOf } from "@/lib/orgChartServer";
import type { SessionPayload } from "@/lib/jwt";

/**
 * Which boards and which users' workload the dashboard shows for the given
 * session — admins see the whole org; supervisors see themselves plus their
 * team; deputies (可代主管簽核的副主管) see themselves plus the team of the
 * supervisors they stand in for; plain members see only themselves. Shared between the dashboard
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

  const isAdmin = session.role === "ADMIN";
  const team = await teamViewIdsOf(session, users);
  const teamMembers = team ? users.filter((u) => team.has(u.id) && u.id !== session.userId) : [];
  const currentUser = users.find((u) => u.id === session.userId);
  const workloadScope = team
    ? currentUser
      ? [currentUser, ...teamMembers]
      : teamMembers
    : isAdmin
      ? users
      : users.filter((u) => u.id === session.userId);

  return { boards, workloadScope };
}
