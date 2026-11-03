"use server";

import { revalidatePath } from "next/cache";
import type { GroupDiscipline, GroupRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import { syncGroupRolesFromBoard } from "@/lib/boardRolesServer";
import { isBoardLeader, isGroupLeader } from "@/lib/groupLeaderServer";
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
 * 所以這等於一次改所有分組的預設。管理者與看板擁有者可以設;看板層級的 Team Leader
 * (整個看板的 Team Leader)可以指定各職能的 DM(Team Leader / PMM / PMD 他自己看到的是鎖住的)。
 */
export async function setBoardRoleAssignments(boardId: string, role: GroupRole, userIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (session.role !== "ADMIN") {
    const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
    const leaderMay = LEADER_ASSIGNABLE_ROLES.includes(role) && (await isBoardLeader(session.userId, boardId));
    if (board?.ownerId !== session.userId && !leaderMay) {
      return { error: "權限不足:僅看板擁有者或管理者可以設定看板角色(Team Leader 只能指定各職能的 DM)" };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.boardRoleAssignment.deleteMany({ where: { boardId, role } });
    await tx.boardRoleAssignment.createMany({ data: [...new Set(userIds)].map((userId) => ({ boardId, role, userId })), skipDuplicates: true });
    await syncGroupRolesFromBoard(boardId, {}, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * Replaces the full SW/HW/ME/QA member roster for one discipline in a group.
 * 跟角色一樣:在分組改某個職能的名單,就等於這個分組「自己設定」那個職能,不再沿用看板(要改回沿用,用 setGroupMemberInherit)。
 */
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

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({ where: { id: groupId }, select: { memberOverrides: true } });
    await tx.groupMember.deleteMany({ where: { groupId, discipline } });
    await tx.groupMember.createMany({ data: [...new Set(userIds)].map((userId) => ({ groupId, discipline, userId })), skipDuplicates: true });
    if (group && !group.memberOverrides.includes(discipline)) {
      await tx.group.update({ where: { id: groupId }, data: { memberOverrides: [...group.memberOverrides, discipline] } });
    }
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}

/**
 * 分組的某個職能的實作成員「沿用看板」或「自己設定」。改回沿用:這個職能的名單立刻換成看板的名單;
 * 改成自己設定:名單先維持目前的樣子(也就是看板的複本),之後各改各的。管理者才能做。
 */
export async function setGroupMemberInherit(
  boardId: string,
  groupId: string,
  discipline: GroupDiscipline,
  inherit: boolean
): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (session.role !== "ADMIN") return { error: "權限不足:僅管理者可以執行此操作" };

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({ where: { id: groupId }, select: { boardId: true, memberOverrides: true } });
    if (!group || group.boardId !== boardId) return;
    const others = group.memberOverrides.filter((d) => d !== discipline);
    await tx.group.update({ where: { id: groupId }, data: { memberOverrides: inherit ? others : [...others, discipline] } });
    if (inherit) await syncGroupRolesFromBoard(boardId, { groupId }, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}

/**
 * Replaces the full Resource roster for a group — informational only, Resources have no login/permissions.
 * 在分組改 Resource 名單,就等於這個分組「自己設定」Resource 成員,不再沿用看板(改回沿用:setGroupResourceInherit)。
 */
export async function setGroupResourceMembers(boardId: string, groupId: string, resourceIds: string[]) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireBoardAdmin(session.role);

  await prisma.$transaction([
    prisma.groupResourceMember.deleteMany({ where: { groupId } }),
    prisma.groupResourceMember.createMany({ data: [...new Set(resourceIds)].map((resourceId) => ({ groupId, resourceId })), skipDuplicates: true }),
    prisma.group.update({ where: { id: groupId }, data: { resourceOverride: true } }),
  ]);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
}

/** 分組的 Resource 成員「沿用看板」或「自己設定」。規則同 setGroupMemberInherit。管理者才能做。 */
export async function setGroupResourceInherit(boardId: string, groupId: string, inherit: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (session.role !== "ADMIN") return { error: "權限不足:僅管理者可以執行此操作" };

  await prisma.$transaction(async (tx) => {
    const group = await tx.group.findUnique({ where: { id: groupId }, select: { boardId: true } });
    if (!group || group.boardId !== boardId) return;
    await tx.group.update({ where: { id: groupId }, data: { resourceOverride: !inherit } });
    if (inherit) await syncGroupRolesFromBoard(boardId, { groupId }, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}

/**
 * 看板層級的人員設定:管理者與看板擁有者可以;leaderAllowed 時,整個看板的 Team Leader 也可以
 * (跟 setBoardRoleAssignments 的規則一致)。回傳 null = 可以,否則是要顯示給使用者的原因。
 */
async function denyBoardSetup(session: SessionPayload, boardId: string, leaderAllowed: boolean, reason: string): Promise<string | null> {
  if (session.role === "ADMIN") return null;
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { ownerId: true } });
  if (board?.ownerId === session.userId) return null;
  if (leaderAllowed && (await isBoardLeader(session.userId, boardId))) return null;
  return reason;
}

/**
 * 看板層級某個職能的實作成員(整批取代)。沒有自己設定這個職能的分組,名單立刻跟著換——
 * 所以這等於一次改所有分組的預設。管理者、看板擁有者與整個看板的 Team Leader 可以設(跟分組裡的規則一致)。
 */
export async function setBoardMembers(boardId: string, discipline: GroupDiscipline, userIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const denied = await denyBoardSetup(session, boardId, true, "權限不足:僅看板擁有者、管理者或這個看板的 Team Leader 可以設定看板的實作成員");
  if (denied) return { error: denied };

  await prisma.$transaction(async (tx) => {
    await tx.boardDisciplineMember.deleteMany({ where: { boardId, discipline } });
    await tx.boardDisciplineMember.createMany({ data: [...new Set(userIds)].map((userId) => ({ boardId, discipline, userId })), skipDuplicates: true });
    await syncGroupRolesFromBoard(boardId, {}, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}

/** 看板層級的 Resource 成員(花名冊,整批取代)。沒有自己設定的分組跟著換。管理者與看板擁有者可以設。 */
export async function setBoardResourceMembers(boardId: string, resourceIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const denied = await denyBoardSetup(session, boardId, false, "權限不足:僅看板擁有者或管理者可以設定看板的 Resource 成員");
  if (denied) return { error: denied };

  await prisma.$transaction(async (tx) => {
    await tx.boardResourceMember.deleteMany({ where: { boardId } });
    await tx.boardResourceMember.createMany({ data: [...new Set(resourceIds)].map((resourceId) => ({ boardId, resourceId })), skipDuplicates: true });
    await syncGroupRolesFromBoard(boardId, {}, tx);
  });
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/group-roles");
  return {};
}
