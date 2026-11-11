"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { notifyTimeApprovalNeeded } from "@/lib/approvalNotify";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { hideBudgetOn } from "@/lib/budgetAccessServer";
import { validateStartMinute } from "@/lib/timeOfDay";
import { DAILY_LIMIT_HOURS, hoursAlreadyLoggedOn } from "@/lib/timesheetHours";
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
  startMinute?: number | null,
  /** 用「重複」一次建立一批時共用的識別。 */
  seriesId?: string | null,
  /** 從工作項預估匯入的:當初的預估時數(hours 是實際,可以不一樣)。 */
  estimateHours?: number | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "請選擇日期" };
  if (!Number.isFinite(hours) || hours <= 0) return { error: "工時必須大於 0" };
  if (hours > 24) return { error: "一天不會超過 24 小時" };
  const startError = validateStartMinute(startMinute, hours);
  if (startError) return { error: startError };

  const targetUserId = userId && session.role === "ADMIN" ? userId : session.userId;
  const already = await hoursAlreadyLoggedOn(targetUserId, date);
  if (already + hours > DAILY_LIMIT_HOURS) {
    return { error: `${date} 已經登記了 ${already} 小時,加上這筆會超過一天的 24 小時` };
  }
  // 管理者設定「工時免審核」的人,登記就生效,並留下「免審核」的註記。
  const exempt = await isTimesheetExempt(targetUserId);
  const groupId = exempt ? null : (await prisma.item.findUnique({ where: { id: itemId }, select: { groupId: true } }))?.groupId;
  await prisma.timeEntry.create({
    data: {
      itemId,
      userId: targetUserId,
      date,
      hours,
      estimateHours: estimateHours ?? null,
      note: note.trim() || null,
      startMinute: startMinute ?? null,
      seriesId: seriesId ?? null,
      ...(exempt ? { status: "APPROVED" as const, decidedAt: new Date(), decisionNote: EXEMPT_DECISION_NOTE } : {}),
    },
  });
  // 要簽核的(沒有免審核)通知簽核人。
  if (groupId) await notifyTimeApprovalNeeded(targetUserId, [groupId]);

  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 修改自己登記的專案工時(行事曆上拖曳、拉長或開啟編輯)。
 *
 * 改了日期、時數或工作項(會影響成本)就要重新送審——已核准的也一樣,免審核的人則直接生效;
 * 只改備註或開始時間不影響成本,維持原本的審核結果。
 */
export async function updateTimeEntry(
  entryId: string,
  input: { itemId: string; date: string; hours: number; note: string; startMinute: number | null }
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { userId: true, itemId: true, date: true, hours: true, status: true },
  });
  if (!entry) return { error: "找不到這筆工時" };
  if (entry.userId !== session.userId && session.role !== "ADMIN") {
    return { error: "只能修改自己登記的工時" };
  }
  const boardId = await requireItemBoardAccess(input.itemId, session);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { error: "請選擇日期" };
  if (!Number.isFinite(input.hours) || input.hours <= 0) return { error: "工時必須大於 0" };
  if (input.hours > DAILY_LIMIT_HOURS) return { error: "一天不會超過 24 小時" };
  const startError = validateStartMinute(input.startMinute, input.hours);
  if (startError) return { error: startError };
  const already = await hoursAlreadyLoggedOn(entry.userId, input.date, { projectEntryId: entryId });
  if (already + input.hours > DAILY_LIMIT_HOURS) {
    return { error: `${input.date} 已經登記了 ${already} 小時,加上這筆會超過一天的 24 小時` };
  }

  const affectsCost =
    entry.itemId !== input.itemId || entry.date !== input.date || Number(entry.hours) !== input.hours;
  const resubmit = affectsCost || entry.status === "REJECTED";
  const exempt = resubmit ? await isTimesheetExempt(entry.userId) : false;
  await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      itemId: input.itemId,
      date: input.date,
      hours: input.hours,
      note: input.note.trim() || null,
      startMinute: input.startMinute,
      ...(resubmit
        ? exempt
          ? { status: "APPROVED" as const, decidedById: null, decidedAt: new Date(), decisionNote: EXEMPT_DECISION_NOTE }
          : { status: "PENDING" as const, decidedById: null, decidedAt: null, decisionNote: null }
        : {}),
    },
  });
  revalidatePath(`/boards/${boardId}`);
  if (resubmit && !exempt) {
    const item = await prisma.item.findUnique({ where: { id: input.itemId }, select: { groupId: true } });
    if (item) await notifyTimeApprovalNeeded(entry.userId, [item.groupId]);
  }
  revalidatePath("/timesheet");
  revalidatePath("/approvals");
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
/**
 * 項目卡片「直接費用」(預算、實際)的目前金額。這是預算金額的一種:看不到這塊看板預算的人拿不到數字,
 * 畫面也就不顯示這一段。
 */
export async function getItemDirectCosts(
  itemId: string
): Promise<{ hidden: true } | { hidden: false; budgetCost: number | null; actualCost: number | null }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  if (await hideBudgetOn(boardId, session)) return { hidden: true };
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { budgetCost: true, actualCost: true } });
  return { hidden: false, budgetCost: item?.budgetCost ?? null, actualCost: item?.actualCost ?? null };
}

export async function setItemCosts(
  itemId: string,
  budgetCost: number | null,
  actualCost: number | null
): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  if (await hideBudgetOn(boardId, session)) return { error: "權限不足:你沒有這塊看板預算金額的檢視權限,不能填直接費用" };
  for (const value of [budgetCost, actualCost]) {
    if (value !== null && (!Number.isInteger(value) || value < 0)) {
      return { error: "金額必須是 0 或正整數(元)" };
    }
  }

  await prisma.item.update({ where: { id: itemId }, data: { budgetCost, actualCost } });
  revalidatePath(`/boards/${boardId}`);
  return {};
}
