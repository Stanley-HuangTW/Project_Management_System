"use server";

import { revalidatePath } from "next/cache";
import type { RowVisibility } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { canManageVisibility } from "@/lib/itemVisibility";

export type VisibilitySetting = {
  visibility: RowVisibility;
  viewerIds: string[];
  /** False for someone who can read the row but does not get to decide who
   *  else can — see canManageVisibility. */
  canManage: boolean;
  ownerName: string | null;
};

export async function getItemVisibility(itemId: string): Promise<VisibilitySetting | null> {
  const session = await requireSession();
  await requireItemBoardAccess(itemId, session);

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: {
      visibility: true,
      createdById: true,
      viewers: { select: { userId: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!item) return null;
  return {
    visibility: item.visibility,
    viewerIds: item.viewers.map((v) => v.userId),
    canManage: canManageVisibility(
      { id: itemId, visibility: item.visibility, viewerIds: [], createdById: item.createdById },
      { userId: session.userId, isAdmin: session.role === "ADMIN" }
    ),
    ownerName: item.createdBy?.name ?? null,
  };
}

/**
 * Sets a 工作項's 可見範圍.
 *
 * Only the owner or an ADMIN: being allowed to edit a row is not the same as
 * being allowed to decide who else in the company reads it.
 */
export async function setItemVisibility(
  itemId: string,
  visibility: RowVisibility,
  viewerIds: string[]
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { createdById: true, visibility: true } });
  if (!item) return { error: "找不到項目" };
  if (
    !canManageVisibility(
      { id: itemId, visibility: item.visibility, viewerIds: [], createdById: item.createdById },
      { userId: session.userId, isAdmin: session.role === "ADMIN" }
    )
  ) {
    return { error: "權限不足:僅建立者或管理者可以設定可見範圍" };
  }

  await prisma.$transaction([
    prisma.item.update({ where: { id: itemId }, data: { visibility } }),
    prisma.itemViewer.deleteMany({ where: { itemId } }),
    ...(visibility === "PRIVATE"
      ? [prisma.itemViewer.createMany({ data: viewerIds.map((userId) => ({ itemId, userId })) })]
      : []),
  ]);

  await logAudit(
    "VISIBILITY",
    session.userId,
    `工作項可見範圍改為 ${visibility}${visibility === "PRIVATE" ? `(${viewerIds.length} 人可見)` : ""}`,
    boardId
  );
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  return {};
}

export async function getGroupVisibility(groupId: string): Promise<VisibilitySetting | null> {
  const session = await requireSession();
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: {
      boardId: true,
      visibility: true,
      createdById: true,
      viewers: { select: { userId: true } },
    },
  });
  if (!group) return null;
  await requireBoardAccess(group.boardId, session);

  return {
    visibility: group.visibility,
    viewerIds: group.viewers.map((v) => v.userId),
    canManage: canManageVisibility(
      { id: groupId, visibility: group.visibility, viewerIds: [], createdById: group.createdById },
      { userId: session.userId, isAdmin: session.role === "ADMIN" }
    ),
    ownerName: null,
  };
}

/**
 * Sets a 分組(專案)'s 可見範圍. A private group hides everything inside it,
 * which is the whole point — a team leader's project should be one switch,
 * not a switch per row.
 *
 * A group with no owner recorded (every group made before this existed) is
 * claimed by whoever first makes it private, so it does not become a row
 * only an ADMIN can ever change.
 */
export async function setGroupVisibility(
  groupId: string,
  visibility: RowVisibility,
  viewerIds: string[]
): Promise<{ error?: string }> {
  const session = await requireSession();
  const group = await prisma.group.findUnique({
    where: { id: groupId },
    select: { boardId: true, name: true, visibility: true, createdById: true },
  });
  if (!group) return { error: "找不到分組" };
  await requireBoardAccess(group.boardId, session);

  const isAdmin = session.role === "ADMIN";
  const unowned = group.createdById === null;
  if (
    !isAdmin &&
    !unowned &&
    !canManageVisibility(
      { id: groupId, visibility: group.visibility, viewerIds: [], createdById: group.createdById },
      { userId: session.userId, isAdmin }
    )
  ) {
    return { error: "權限不足:僅建立者或管理者可以設定可見範圍" };
  }

  await prisma.$transaction([
    prisma.group.update({
      where: { id: groupId },
      data: { visibility, ...(unowned ? { createdById: session.userId } : {}) },
    }),
    prisma.groupViewer.deleteMany({ where: { groupId } }),
    ...(visibility === "PRIVATE"
      ? [prisma.groupViewer.createMany({ data: viewerIds.map((userId) => ({ groupId, userId })) })]
      : []),
  ]);

  await logAudit(
    "VISIBILITY",
    session.userId,
    `分組「${group.name}」可見範圍改為 ${visibility}${visibility === "PRIVATE" ? `(${viewerIds.length} 人可見)` : ""}`,
    group.boardId
  );
  revalidatePath(`/boards/${group.boardId}`);
  revalidatePath("/dashboard");
  return {};
}
