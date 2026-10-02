"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("請輸入完整的網址(例如 https://...)");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只接受 http(s) 開頭的網址");
  }
  return parsed.toString();
}

export async function listItemLinks(itemId: string) {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (item) await requireBoardAccess(item.boardId, session);
  return prisma.itemLink.findMany({
    where: { itemId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { id: true, name: true, avatarUrl: true } } },
  });
}

export async function addItemLink(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  url: string,
  label: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const normalized = normalizeUrl(url);
  const trimmedLabel = label.trim();

  const link = await prisma.itemLink.create({
    data: {
      itemId,
      url: normalized,
      label: trimmedLabel || null,
      createdById: session.userId,
    },
  });

  await logActivity(itemId, session.userId, `新增連結「${trimmedLabel || normalized}」`);
  revalidatePath(`/boards/${boardId}`);
  return link;
}

export async function deleteItemLink(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  linkId: string
) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const link = await prisma.itemLink.findUnique({ where: { id: linkId } });
  if (!link || link.itemId !== itemId) return;

  await prisma.itemLink.delete({ where: { id: linkId } });
  await logActivity(itemId, session.userId, `刪除連結「${link.label || link.url}」`);
  revalidatePath(`/boards/${boardId}`);
}
