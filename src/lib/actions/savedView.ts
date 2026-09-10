"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { parseViewConfig, type ViewConfig } from "@/lib/savedView";

export type SavedViewSummary = {
  id: string;
  name: string;
  isShared: boolean;
  /** False for a shared view somebody else saved — it can be used, not changed. */
  isOwn: boolean;
  ownerName: string;
  config: ViewConfig;
};

/** This user's views on the board, plus the ones other people shared. */
export async function listSavedViews(boardId: string): Promise<SavedViewSummary[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const views = await prisma.savedView.findMany({
    where: { boardId, OR: [{ ownerId: session.userId }, { isShared: true }] },
    orderBy: { createdAt: "asc" },
    include: { owner: { select: { name: true } } },
  });

  return views.map((view) => ({
    id: view.id,
    name: view.name,
    isShared: view.isShared,
    isOwn: view.ownerId === session.userId,
    ownerName: view.owner.name,
    config: parseViewConfig(view.config),
  }));
}

export async function createSavedView(
  boardId: string,
  name: string,
  config: ViewConfig,
  isShared: boolean
): Promise<{ error?: string; id?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入檢視名稱" };

  const view = await prisma.savedView.create({
    data: {
      boardId,
      ownerId: session.userId,
      name: trimmed,
      isShared,
      // Round-tripped through the parser so only known shapes are stored.
      config: parseViewConfig(config),
    },
  });
  return { id: view.id };
}

/** Saves the current filters over an existing view — the "I tweaked it and
 *  want to keep the tweak" case. Only the owner can, shared or not. */
export async function updateSavedView(
  viewId: string,
  config: ViewConfig
): Promise<{ error?: string }> {
  const session = await requireSession();
  const view = await prisma.savedView.findUnique({ where: { id: viewId }, select: { ownerId: true } });
  if (!view) return { error: "找不到這個檢視" };
  if (view.ownerId !== session.userId) return { error: "這是別人共用的檢視,只有建立者可以修改" };

  await prisma.savedView.update({ where: { id: viewId }, data: { config: parseViewConfig(config) } });
  return {};
}

export async function deleteSavedView(viewId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const view = await prisma.savedView.findUnique({ where: { id: viewId }, select: { ownerId: true } });
  if (!view) return { error: "找不到這個檢視" };
  if (view.ownerId !== session.userId) return { error: "這是別人共用的檢視,只有建立者可以刪除" };

  await prisma.savedView.delete({ where: { id: viewId } });
  return {};
}
