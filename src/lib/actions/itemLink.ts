"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, requireItemBoardAccess } from "@/lib/boardAccess";
import { logActivity } from "@/lib/activityLog";
import { mantisIdFromUrl } from "@/lib/mantis";
import { canManageStructure } from "@/lib/permissions";
import { UserError } from "@/lib/userError";

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UserError("請輸入完整的網址(例如 https://...)");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UserError("只接受 http(s) 開頭的網址");
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

/** 連結是這個看板所連的 Mantis 網站的問題頁時,帶出同步到的狀態。 */
export type LinkMantisInfo = {
  mantisId: number;
  /** 這個問題有沒有同步下來(不在連線的 Mantis 專案裡,或還沒同步到,就是 false)。 */
  synced: boolean;
  /** Mantis 上的狀態原文,例如 assigned。 */
  status: string | null;
  handler: string | null;
};

export async function getMantisInfoForLinks(itemId: string): Promise<Record<string, LinkMantisInfo>> {
  const session = await requireSession();
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  if (!item) return {};
  await requireBoardAccess(item.boardId, session);

  const connection = await prisma.mantisConnection.findUnique({ where: { boardId: item.boardId }, select: { baseUrl: true } });
  if (!connection) return {};
  const links = await prisma.itemLink.findMany({ where: { itemId }, select: { id: true, url: true } });
  const parsed = links.flatMap((l) => {
    const mantisId = mantisIdFromUrl(l.url, connection.baseUrl);
    return mantisId === null ? [] : [{ linkId: l.id, mantisId }];
  });
  if (parsed.length === 0) return {};

  const synced = await prisma.riskEntry.findMany({
    where: { boardId: item.boardId, mantisId: { in: parsed.map((p) => p.mantisId) } },
    select: { mantisId: true, mantisStatus: true, mantisHandler: true },
  });
  const byId = new Map(synced.map((r) => [r.mantisId!, r]));
  return Object.fromEntries(
    parsed.map(({ linkId, mantisId }) => {
      const row = byId.get(mantisId);
      return [linkId, { mantisId, synced: !!row, status: row?.mantisStatus ?? null, handler: row?.mantisHandler ?? null }];
    })
  );
}

export async function addItemLink(
  /** Not trusted for authorization — see requireItemBoardAccess below. */
  _boardId: string,
  itemId: string,
  url: string,
  label: string,
  /** 這個連結要不要彙整進週報(預設要)。 */
  inWeeklyReport = true
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
      inWeeklyReport: inWeeklyReport !== false,
    },
  });

  await logActivity(itemId, session.userId, `新增連結「${trimmedLabel || normalized}」`, { kind: "LINK" });
  revalidatePath(`/boards/${boardId}`);
  return link;
}

/** 改一個連結要不要彙整進週報。只有加這個連結的人與管理者、主管可以改。 */
export async function setItemLinkInWeeklyReport(itemId: string, linkId: string, value: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  const link = await prisma.itemLink.findUnique({ where: { id: linkId }, select: { itemId: true, createdById: true } });
  if (!link || link.itemId !== itemId) return { error: "找不到這個連結" };
  if (link.createdById !== session.userId && !canManageStructure(session.role)) {
    return { error: "權限不足:只有加這個連結的人、主管與管理者可以改" };
  }
  await prisma.itemLink.update({ where: { id: linkId }, data: { inWeeklyReport: value } });
  revalidatePath(`/boards/${boardId}`);
  return {};
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
  await logActivity(itemId, session.userId, `刪除連結「${link.label || link.url}」`, { kind: "LINK" });
  revalidatePath(`/boards/${boardId}`);
}
