"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireStructureAccess } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import { syncGroupRolesFromBoard } from "@/lib/boardRolesServer";
import { UserError } from "@/lib/userError";

export async function createGroup(boardId: string, name: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  const trimmed = name.trim() || "新分組";

  const count = await prisma.group.count({ where: { boardId } });
  const group = await prisma.group.create({
    data: { boardId, name: trimmed, order: count },
  });
  // 新分組沿用看板設定的角色。
  await syncGroupRolesFromBoard(boardId, { groupId: group.id });

  revalidatePath(`/boards/${boardId}`);
  return group;
}

export async function renameGroup(boardId: string, groupId: string, name: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  const trimmed = name.trim();
  if (!trimmed) throw new UserError("分組名稱不可為空");

  await prisma.group.update({ where: { id: groupId }, data: { name: trimmed } });
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteGroup(boardId: string, groupId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.group.delete({ where: { id: groupId } });
  revalidatePath(`/boards/${boardId}`);
}

export async function reorderGroups(
  boardId: string,
  orderedGroupIds: string[]
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.$transaction(
    orderedGroupIds.map((id, index) =>
      prisma.group.update({ where: { id }, data: { order: index } })
    )
  );
  revalidatePath(`/boards/${boardId}`);
}
