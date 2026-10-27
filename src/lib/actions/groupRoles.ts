"use server";

import { revalidatePath } from "next/cache";
import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import { syncGroupRolesFromBoard } from "@/lib/boardRolesServer";
import { isGroupLeader } from "@/lib/groupLeaderServer";
import type { SessionPayload } from "@/lib/jwt";

/** Team Leader 可以在自己的分組指定的角色:各職能的 DM。Team Leader / PMM / PMD 管的是整個分組,只有管理者能設。 */
const LEADER_ASSIGNABLE_ROLES: GroupRole[] = ["SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"];

/**
 * 能不能改這個分組的人員設定:管理者可以;分組的 Team Leader 在 leaderAllowed 時也可以。
 * 回傳 null = 可以,否則是要顯示給使用者的原因。groupId 一定要驗證屬於這個看板——
 * Team Leader 的資格是對那一個分組而言的,不能靠前端傳來的 boardId。
 */
async function denyGroupSetup(
  session: SessionPayload,
  boardId: string,
  groupId: string,
  leaderAllowed: boolean
): Promise<string | null> {
  const group = await prisma.group.findUnique({ where: { id: groupId }, select: { boardId: true } });
  if (!group || group.boardId !== boardId) return "找不到這個分組";
  if (session.role === "ADMIN") return null;
  if (leaderAllowed && (await isGroupLeader(session.userId, groupId))) return null;
  return leaderAllowed ? "權限不足:僅管理者或這個分組的 Team Leader 可以設定" : "權限不足:這個角色僅管理者可以設定";
}

/**
 * Replaces the full set of users holding `role` on a group — configuring
 * who's TEAM_LEADER/SW_DM/HW_DM/ME_DM/QA/PMM/PMD is ADMIN-only, since it's
 * what grants schedule/structure rights in the first place (see
 * permissions.ts's canEditGanttItem/canManageGroupStructure).
 *
 * 在分組裡改某個角色的名單,就等於這個分組「自己設定」那個角色:不再沿用看板的名單,
 * 看板之後怎麼改都不會動到它(要改回沿用,用 setGroupRoleInherit)。
 */
export async function setGroupRoleAssignments(
  boardId: string,
  groupId: string,
  role: GroupRole,
  userIds: string[]
): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const denied = await denyGroupSetup(session, boardId, groupId, LEADER_ASSIGNABLE_ROLES.includes(role));
  if (denied) return { error: denied };

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({ where: { id: groupId }, select: { roleOverrides: true } });
    await tx.groupRoleAssignment.deleteMany({ where: { groupId, role } });
    await tx.groupRoleAssignment.createMany({ data: [...new Set(userIds)].map((userId) => ({ groupId, role, userId })), skipDuplicates: true });
    if (group && !group.roleOverrides.includes(role)) {
      await tx.group.update({ where: { id: groupId }, data: { roleOverrides: [...group.roleOverrides, role] } });
    }
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}

/**
 * 分組的某個角色「沿用看板」或「自己設定」。改回沿用:這個角色的名單立刻換成看板的名單;
 * 改成自己設定:名單先維持目前的樣子(也就是看板的複本),之後各改各的。管理者才能做。
 */
export async function setGroupRoleInherit(
  boardId: string,
  groupId: string,
  role: GroupRole,
  inherit: boolean
): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (session.role !== "ADMIN") return { error: "權限不足:僅管理者可以執行此操作" };

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({ where: { id: groupId }, select: { boardId: true, roleOverrides: true } });
    if (!group || group.boardId !== boardId) return;
    const others = group.roleOverrides.filter((r) => r !== role);
    await tx.group.update({ where: { id: groupId }, data: { roleOverrides: inherit ? others : [...others, role] } });
    if (inherit) await syncGroupRolesFromBoard(boardId, { groupId }, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 看板層級的角色名單(整批取代)。沒有自己設定這個角色的分組,名單立刻跟著換——
 * 所以這等於一次改所有分組的預設。管理者與看板擁有者可以設。
 */
export async function setBoardRoleAssignments(boardId: string, role: GroupRole, userIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (session.role !== "ADMIN") {
    const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
    if (board?.ownerId !== session.userId) return { error: "權限不足:僅看板擁有者或管理者可以設定看板角色" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.boardRoleAssignment.deleteMany({ where: { boardId, role } });
    await tx.boardRoleAssignment.createMany({ data: [...new Set(userIds)].map((userId) => ({ boardId, role, userId })), skipDuplicates: true });
    await syncGroupRolesFromBoard(boardId, {}, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** Replaces the full SW/HW/ME/QA member roster for one discipline in a group. */
export async function setGroupMembers(
  boardId: string,
  groupId: string,
  discipline: GroupDiscipline,
  userIds: string[]
): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const denied = await denyGroupSetup(session, boardId, groupId, true);
  if (denied) return { error: denied };

  await prisma.$transaction([
    prisma.groupMember.deleteMany({ where: { groupId, discipline } }),
    ...[...new Set(userIds)].map((userId) =>
      prisma.groupMember.create({ data: { groupId, discipline, userId } })
    ),
  ]);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}

/** Replaces the full Resource roster for a group — informational only, Resources have no login/permissions. */
export async function setGroupResourceMembers(boardId: string, groupId: string, resourceIds: string[]) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireBoardAdmin(session.role);

  await prisma.$transaction([
    prisma.groupResourceMember.deleteMany({ where: { groupId } }),
    ...resourceIds.map((resourceId) =>
      prisma.groupResourceMember.create({ data: { groupId, resourceId } })
    ),
  ]);
  revalidatePath(`/boards/${boardId}`);
}
