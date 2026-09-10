"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";

export type TimeEntryRow = {
  id: string;
  itemId: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  note: string;
  /** False for someone else's entry: you can see the team's hours, you just
   *  cannot rewrite them. */
  canEdit: boolean;
};

export async function listTimeEntries(itemId: string): Promise<TimeEntryRow[]> {
  const session = await requireSession();
  await requireItemBoardAccess(itemId, session);

  const entries = await prisma.timeEntry.findMany({
    where: { itemId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    include: { user: { select: { name: true } } },
  });
  return entries.map((entry) => ({
    id: entry.id,
    itemId: entry.itemId,
    userId: entry.userId,
    userName: entry.user.name,
    date: entry.date,
    hours: Number(entry.hours),
    note: entry.note ?? "",
    canEdit: entry.userId === session.userId || session.role === "ADMIN",
  }));
}

/**
 * Logs hours against an item.
 *
 * Everyone logs their own: a timesheet somebody else filled in for you is
 * an estimate wearing an actual's clothes. An ADMIN may log for another
 * person, which is what makes catching up a month of paper sheets possible.
 */
export async function logTime(
  itemId: string,
  date: string,
  hours: number,
  note: string,
  userId?: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "請選擇日期" };
  if (!Number.isFinite(hours) || hours <= 0) return { error: "工時必須大於 0" };
  if (hours > 24) return { error: "一天不會超過 24 小時" };

  const targetUserId = userId && session.role === "ADMIN" ? userId : session.userId;
  await prisma.timeEntry.create({
    data: { itemId, userId: targetUserId, date, hours, note: note.trim() || null },
  });

  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteTimeEntry(entryId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { userId: true, itemId: true },
  });
  if (!entry) return { error: "找不到這筆工時" };
  const boardId = await requireItemBoardAccess(entry.itemId, session);
  if (entry.userId !== session.userId && session.role !== "ADMIN") {
    return { error: "只能刪除自己登記的工時" };
  }

  await prisma.timeEntry.delete({ where: { id: entryId } });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 直接費用 (NRE/BOM…) on one item — the other half of its cost, and the
 *  half that is a number somebody agreed to rather than hours worked. */
export async function setItemCosts(
  itemId: string,
  budgetCost: number | null,
  actualCost: number | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  for (const value of [budgetCost, actualCost]) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      return { error: "金額必須是 0 或正整數(元)" };
    }
  }

  await prisma.item.update({ where: { id: itemId }, data: { budgetCost, actualCost } });
  revalidatePath(`/boards/${boardId}`);
  return {};
}
