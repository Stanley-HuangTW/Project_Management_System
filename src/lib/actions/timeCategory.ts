"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";

export type TimeCategoryRow = {
  id: string;
  name: string;
  active: boolean;
  linkIssue: boolean;
  /** 已經有多少筆工時用了這個類別——有人用的停用而不是刪。 */
  entryCount: number;
};

export async function listTimeCategories(): Promise<TimeCategoryRow[]> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const categories = await prisma.timeCategory.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { entries: true } } },
  });
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    active: c.active,
    linkIssue: c.linkIssue,
    entryCount: c._count.entries,
  }));
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function createTimeCategory(name: string, linkIssue: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const cleaned = cleanName(name);
  if (!cleaned) return { error: "請輸入類別名稱" };
  if (cleaned.length > 30) return { error: "類別名稱最多 30 個字" };
  if (await prisma.timeCategory.findUnique({ where: { name: cleaned }, select: { id: true } })) {
    return { error: `已經有「${cleaned}」這個類別了` };
  }

  const last = await prisma.timeCategory.aggregate({ _max: { order: true } });
  await prisma.timeCategory.create({
    data: { name: cleaned, linkIssue, order: (last._max.order ?? -1) + 1 },
  });
  await logAudit("SETTINGS", session.userId, `新增工時類別「${cleaned}」`);
  revalidatePath("/settings");
  return {};
}

export async function renameTimeCategory(id: string, name: string): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const cleaned = cleanName(name);
  if (!cleaned) return { error: "請輸入類別名稱" };
  if (cleaned.length > 30) return { error: "類別名稱最多 30 個字" };

  const existing = await prisma.timeCategory.findUnique({ where: { id }, select: { name: true } });
  if (!existing) return { error: "找不到這個類別" };
  if (existing.name === cleaned) return {};
  const clash = await prisma.timeCategory.findUnique({ where: { name: cleaned }, select: { id: true } });
  if (clash && clash.id !== id) return { error: `已經有「${cleaned}」這個類別了` };

  await prisma.timeCategory.update({ where: { id }, data: { name: cleaned } });
  await logAudit("SETTINGS", session.userId, `工時類別「${existing.name}」改名為「${cleaned}」`);
  revalidatePath("/settings");
  return {};
}

export async function setTimeCategoryLinkIssue(id: string, linkIssue: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const existing = await prisma.timeCategory.findUnique({ where: { id }, select: { name: true } });
  if (!existing) return { error: "找不到這個類別" };

  await prisma.timeCategory.update({ where: { id }, data: { linkIssue } });
  await logAudit(
    "SETTINGS",
    session.userId,
    `工時類別「${existing.name}」${linkIssue ? "開啟" : "關閉"}連結議題`
  );
  revalidatePath("/settings");
  return {};
}

/** 停用/啟用。停用後不能再用它登記新的工時,舊紀錄照常顯示。 */
export async function setTimeCategoryActive(id: string, active: boolean): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  const existing = await prisma.timeCategory.findUnique({ where: { id }, select: { name: true } });
  if (!existing) return { error: "找不到這個類別" };

  await prisma.timeCategory.update({ where: { id }, data: { active } });
  await logAudit("SETTINGS", session.userId, `工時類別「${existing.name}」${active ? "啟用" : "停用"}`);
  revalidatePath("/settings");
  return {};
}
