"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { logAudit } from "@/lib/activityLog";

export type PendingTimeEntry = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  note: string;
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
};

export type PendingLeave = {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
};

export type ApprovalQueue = {
  timeEntries: PendingTimeEntry[];
  leaves: PendingLeave[];
  /** Whether this person has anybody to approve for at all — used to decide
   *  whether the page is worth showing them. */
  isApprover: boolean;
};

/**
 * Who this session may decide for.
 *
 * A supervisor approves their own reports; an ADMIN approves anyone, which is
 * what keeps the queue from stalling when somebody's supervisor is the person
 * on leave. Nobody approves their own — a timesheet that approves itself is
 * the same timesheet.
 */
async function approvableUserIds(session: SessionPayload): Promise<string[]> {
  if (session.role === "ADMIN") {
    const all = await prisma.user.findMany({ select: { id: true } });
    return all.map((u) => u.id).filter((id) => id !== session.userId);
  }
  const reports = await prisma.user.findMany({
    where: { supervisorId: session.userId },
    select: { id: true },
  });
  return reports.map((u) => u.id);
}

function countDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export async function listApprovalQueue(): Promise<ApprovalQueue> {
  const session = await requireSession();
  const userIds = await approvableUserIds(session);
  if (userIds.length === 0) return { timeEntries: [], leaves: [], isApprover: false };

  const [entries, leaves] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { status: "PENDING", userId: { in: userIds }, item: { deletedAt: null } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { name: true } },
        item: { select: { id: true, name: true, board: { select: { id: true, name: true } } } },
      },
    }),
    prisma.leave.findMany({
      where: { status: "PENDING", userId: { in: userIds } },
      orderBy: { startDate: "asc" },
      include: { user: { select: { name: true } } },
    }),
  ]);

  return {
    isApprover: true,
    timeEntries: entries.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      userName: entry.user.name,
      date: entry.date,
      hours: Number(entry.hours),
      note: entry.note ?? "",
      itemId: entry.item.id,
      itemName: entry.item.name,
      boardId: entry.item.board.id,
      boardName: entry.item.board.name,
    })),
    leaves: leaves.map((leave) => ({
      id: leave.id,
      userId: leave.userId,
      userName: leave.user.name,
      startDate: leave.startDate,
      endDate: leave.endDate,
      days: countDays(leave.startDate, leave.endDate),
      reason: leave.reason ?? "",
    })),
  };
}

async function assertMayDecide(session: SessionPayload, ownerId: string) {
  if (ownerId === session.userId) {
    throw new Error("不能審核自己送出的紀錄");
  }
  const allowed = await approvableUserIds(session);
  if (!allowed.includes(ownerId)) throw new Error("權限不足:你不是這個人的主管");
}

/**
 * 核准或退回一筆工時.
 *
 * Approving is what makes the hours real: until then they are outside the
 * board's actual cost entirely, so a CPI does not move because somebody typed
 * a number — it moves because their supervisor agreed with it.
 */
export async function decideTimeEntry(
  entryId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    include: {
      user: { select: { name: true } },
      item: { select: { name: true, boardId: true } },
    },
  });
  if (!entry) return { error: "找不到這筆工時" };
  await assertMayDecide(session, entry.userId);

  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "退回必須寫下原因" };

  await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      status,
      decidedById: session.userId,
      decidedAt: new Date(),
      decisionNote: trimmed || null,
    },
  });
  await logAudit(
    "APPROVAL",
    session.userId,
    `${status === "APPROVED" ? "核准" : "退回"}工時:${entry.user.name} ${entry.date} ${Number(
      entry.hours
    )}h（${entry.item.name}）${trimmed ? `:${trimmed}` : ""}`,
    entry.item.boardId
  );
  revalidatePath("/approvals");
  revalidatePath(`/boards/${entry.item.boardId}`);
  return {};
}

/** 核准或退回一筆請假。核准前那幾天的產能不變——過度配置也就不會提前示警。 */
export async function decideLeave(
  leaveId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const leave = await prisma.leave.findUnique({
    where: { id: leaveId },
    include: { user: { select: { name: true } } },
  });
  if (!leave) return { error: "找不到這筆請假" };
  await assertMayDecide(session, leave.userId);

  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "退回必須寫下原因" };

  await prisma.leave.update({
    where: { id: leaveId },
    data: {
      status,
      decidedById: session.userId,
      decidedAt: new Date(),
      decisionNote: trimmed || null,
    },
  });
  await logAudit(
    "APPROVAL",
    session.userId,
    `${status === "APPROVED" ? "核准" : "退回"}請假:${leave.user.name} ${leave.startDate}~${
      leave.endDate
    }${trimmed ? `:${trimmed}` : ""}`
  );
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/users");
  return {};
}

/** Whether to offer this person the 審核 link at all. */
export async function hasApprovalRole(): Promise<boolean> {
  const session = await requireSession();
  if (session.role === "ADMIN") return true;
  const count = await prisma.user.count({ where: { supervisorId: session.userId } });
  return count > 0;
}
