"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { validateStartMinute } from "@/lib/timeOfDay";
import { EXEMPT_DECISION_NOTE, formatApprovers, isTimesheetExempt, resolveApprovers } from "@/lib/timesheetApproval";

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
  /** 未核准的工時不計入成本報表 — shown so nobody assumes it counted. */
  status: ApprovalStatus;
  decisionNote: string | null;
  /** 待審時:這筆可以由誰核准(姓名與身分)。 */
  approvers: string[];
  /** 核准或退回的人;免審核的沒有。 */
  decidedByName: string | null;
};

export async function listTimeEntries(itemId: string): Promise<TimeEntryRow[]> {
  const session = await requireSession();
  await requireItemBoardAccess(itemId, session);

  const [entries, item] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { itemId },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { user: { select: { name: true } }, decidedBy: { select: { name: true } } },
    }),
    prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true } }),
  ]);
  const approvers = await resolveApprovers(
    entries
      .filter((e) => e.status === "PENDING")
      .map((e) => ({ key: e.id, userId: e.userId, groupIds: item ? [item.groupId] : [] }))
  );
  return entries.map((entry) => ({
    id: entry.id,
    itemId: entry.itemId,
    userId: entry.userId,
    userName: entry.user.name,
    date: entry.date,
    hours: Number(entry.hours),
    note: entry.note ?? "",
    canEdit: entry.userId === session.userId || session.role === "ADMIN",
    status: entry.status,
    decisionNote: entry.decisionNote,
    approvers: formatApprovers(approvers.get(entry.id) ?? []),
    decidedByName: entry.decidedBy?.name ?? null,
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
  userId?: string,
  /** 一天中的開始時間(分鐘),行事曆用。 */
  startMinute?: number | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "請選擇日期" };
  if (!Number.isFinite(hours) || hours <= 0) return { error: "工時必須大於 0" };
  if (hours > 24) return { error: "一天不會超過 24 小時" };
  const startError = validateStartMinute(startMinute, hours);
  if (startError) return { error: startError };

  const targetUserId = userId && session.role === "ADMIN" ? userId : session.userId;
  // 管理者設定「工時免審核」的人,登記就生效,並留下「免審核」的註記。
  const exempt = await isTimesheetExempt(targetUserId);
  await prisma.timeEntry.create({
    data: {
      itemId,
      userId: targetUserId,
      date,
      hours,
      note: note.trim() || null,
      startMinute: startMinute ?? null,
      ...(exempt ? { status: "APPROVED" as const, decidedAt: new Date(), decisionNote: EXEMPT_DECISION_NOTE } : {}),
    },
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
