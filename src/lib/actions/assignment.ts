"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditGanttItem } from "@/lib/permissions";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { logActivity } from "@/lib/activityLog";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { subordinateIdsOf } from "@/lib/orgChartServer";
import type { SessionPayload } from "@/lib/jwt";

/**
 * Managing an item's Gantt Assignments is limited to the item's own
 * assignee(s), an ADMIN, a SUPERVISOR whose team includes an assignee, or a
 * group role — TEAM_LEADER/PMD (schedule role, group-wide) or a discipline DM
 * whose GroupMember roster includes an assignee — see canEditGanttItem.
 */
async function assertCanEditAssignment(boardId: string, itemId: string, session: SessionPayload) {
  const [item, personColumns] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId }, include: { cellValues: true, assignments: true } }),
    prisma.column.findMany({ where: { boardId, type: "PERSON" }, select: { id: true } }),
  ]);
  const personColumnIds = personColumns.map((c) => c.id);
  const isAssigned = item ? isItemAssignedToUser(item, personColumnIds, session.userId) : false;
  const isTeamAssigned =
    item && session.role === "SUPERVISOR"
      ? isItemAssignedToTeam(
          item,
          personColumnIds,
          await subordinateIdsOf(session.userId)
        )
      : false;
  const groupRole = item ? await loadGroupRoleContext(item.groupId, session.userId) : null;
  const isGroupTeamAssigned =
    item && groupRole ? isItemAssignedToTeam(item, personColumnIds, groupRole.teamUserIds) : false;
  if (
    !canEditGanttItem(
      session.role,
      isAssigned,
      isTeamAssigned || isGroupTeamAssigned,
      groupRole?.access.hasScheduleRole ?? false
    )
  ) {
    throw new Error("權限不足:僅該項目的負責人或管理者可以調整人員分配");
  }
}

export async function listAssignments(itemId: string) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (item) await requireBoardAccess(item.boardId, session);
  return prisma.assignment.findMany({
    where: { itemId },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
  });
}

export async function upsertAssignment(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  userId: string,
  allocationPct: number
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  await assertCanEditAssignment(boardId, itemId, session);
  const pct = Math.max(5, Math.min(100, Math.round(allocationPct / 5) * 5));

  if (session.role === "SUPERVISOR" && userId !== session.userId) {
    if (!(await subordinateIdsOf(session.userId)).has(userId)) {
      throw new Error("主管只能將任務指派給自己或自己團隊的成員");
    }
  }

  const [existing, item, assignee] = await Promise.all([
    prisma.assignment.findUnique({ where: { itemId_userId: { itemId, userId } } }),
    prisma.item.findUnique({ where: { id: itemId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);

  await prisma.assignment.upsert({
    where: { itemId_userId: { itemId, userId } },
    create: { itemId, userId, allocationPct: pct },
    update: { allocationPct: pct },
  });

  if (assignee) {
    await logActivity(
      itemId,
      session.userId,
      existing
        ? `${assignee.name} 的人員分配調整為 ${pct}%`
        : `新增人員分配:${assignee.name} ${pct}%`
    );
  }

  if (!existing && item && userId !== session.userId) {
    const message = `指派給你,配置 ${pct}%`;
    const [notifiableId] = await filterInAppRecipients(prisma, "ASSIGNED", [userId]);
    if (notifiableId) {
      await prisma.notification.create({
        data: {
          userId,
          actorId: session.userId,
          type: "ASSIGNED",
          itemId,
          message,
        },
      });
    }
    await notifyEmailIfNeeded(userId, "ASSIGNED", message);
  }

  revalidatePath(`/boards/${boardId}`);
}

export async function removeAssignment(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  userId: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  await assertCanEditAssignment(boardId, itemId, session);
  const assignee = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await prisma.assignment.delete({
    where: { itemId_userId: { itemId, userId } },
  });
  if (assignee) {
    await logActivity(itemId, session.userId, `移除人員分配:${assignee.name}`);
  }
  revalidatePath(`/boards/${boardId}`);
}
