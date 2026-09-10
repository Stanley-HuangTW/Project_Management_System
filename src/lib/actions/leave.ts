"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";

export type LeaveRow = {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  reason: string;
  /** False for someone else's leave when you are not an ADMIN. */
  canEdit: boolean;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Everyone's leave from today onwards, plus anything still running. Past
 *  leave is history and would only push the useful rows off the screen. */
export async function listLeaves(): Promise<LeaveRow[]> {
  const session = await requireSession();
  const today = new Date().toISOString().slice(0, 10);

  const leaves = await prisma.leave.findMany({
    where: { endDate: { gte: today } },
    orderBy: [{ startDate: "asc" }],
    include: { user: { select: { name: true } } },
  });
  return leaves.map((leave) => ({
    id: leave.id,
    userId: leave.userId,
    userName: leave.user.name,
    startDate: leave.startDate,
    endDate: leave.endDate,
    reason: leave.reason ?? "",
    canEdit: session.role === "ADMIN" || leave.userId === session.userId,
  }));
}

/**
 * Records someone being away.
 *
 * You may record your own; an ADMIN may record anyone's — which is what
 * makes entering the team's approved leave in one sitting possible.
 */
export async function createLeave(
  userId: string,
  startDate: string,
  endDate: string,
  reason: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN" && userId !== session.userId) {
    return { error: "只能登記自己的休假" };
  }
  if (!ISO.test(startDate) || !ISO.test(endDate)) return { error: "請選擇起訖日期" };
  if (endDate < startDate) return { error: "結束日期不能早於開始日期" };

  await prisma.leave.create({
    data: { userId, startDate, endDate, reason: reason.trim() || null },
  });
  revalidatePath("/users");
  revalidatePath("/dashboard");
  return {};
}

export async function deleteLeave(leaveId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const leave = await prisma.leave.findUnique({ where: { id: leaveId }, select: { userId: true } });
  if (!leave) return { error: "找不到這筆休假" };
  if (session.role !== "ADMIN" && leave.userId !== session.userId) {
    return { error: "只能刪除自己的休假" };
  }

  await prisma.leave.delete({ where: { id: leaveId } });
  revalidatePath("/users");
  revalidatePath("/dashboard");
  return {};
}

/**
 * Every day each person is away, as a set of ISO dates — the shape the
 * workload views need, expanded from ranges once rather than per lookup.
 */
export async function leaveDaysByUser(): Promise<Record<string, string[]>> {
  await requireSession();
  const leaves = await prisma.leave.findMany({ select: { userId: true, startDate: true, endDate: true } });

  const byUser: Record<string, string[]> = {};
  for (const leave of leaves) {
    const days = byUser[leave.userId] ?? [];
    for (let d = new Date(leave.startDate); d <= new Date(leave.endDate); d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }
    byUser[leave.userId] = days;
  }
  return byUser;
}
