"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { canEditGanttItem } from "@/lib/permissions";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { logActivity } from "@/lib/activityLog";
import { normalizeAllocationPct } from "@/lib/allocationPct";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { subordinateIdsOf } from "@/lib/orgChartServer";
import { isGroupLeader } from "@/lib/groupLeaderServer";
import type { SessionPayload } from "@/lib/jwt";
import { UserError } from "@/lib/userError";
import { itemLink } from "@/lib/notificationLink";

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
    throw new UserError("權限不足:僅該項目的負責人或管理者可以調整人員分配");
  }
}

/**
 * 主管只能把任務指派給自己或自己團隊的成員;但這個項目所在分組的 Team Leader(那個分組的,或整個看板的)
 * 是專案的負責人,可以指派給任何人——被指派的人不一定是他的部屬。
 */
async function isLeaderOfItemGroup(itemId: string, userId: string): Promise<boolean> {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true } });
  return item ? isGroupLeader(userId, item.groupId) : false;
}

/** 畫面用:這個人在這個項目上,指派時能不能選團隊以外的人(不受「主管只管自己團隊」限制)。 */
export async function canAssignToAnyone(itemId: string): Promise<boolean> {
  const session = await requireSession();
  await requireItemBoardAccess(itemId, session);
  if (session.role !== "SUPERVISOR") return true; // 其他身分本來就沒有這個限制
  return isLeaderOfItemGroup(itemId, session.userId);
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
  const pct = normalizeAllocationPct(allocationPct);

  if (session.role === "SUPERVISOR" && userId !== session.userId) {
    if (!(await subordinateIdsOf(session.userId)).has(userId) && !(await isLeaderOfItemGroup(itemId, session.userId))) {
      throw new UserError("主管只能將任務指派給自己或自己團隊的成員(這個分組的 Team Leader 可以指派給任何人)");
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
    await notifyEmailIfNeeded(userId, "ASSIGNED", message, itemLink(boardId, itemId));
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
