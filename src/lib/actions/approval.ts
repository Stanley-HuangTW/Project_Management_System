"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { logAudit } from "@/lib/activityLog";
import { groupIdsOfBoards, resolveApprovers, type ApprovalSubject } from "@/lib/timesheetApproval";

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

/** 對應專案的非專案工時(會議、出差交通…)——跟專案工時一樣要核准才計入專案成本。 */
export type PendingActivityEntry = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  note: string;
  categoryName: string;
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
  activityEntries: PendingActivityEntry[];
  leaves: PendingLeave[];
  /** Whether this person has anybody to approve for at all — used to decide
   *  whether the page is worth showing them. */
  isApprover: boolean;
};

/**
 * 請假:這個人能核准誰。
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

const APPROVER_ROLES = ["TEAM_LEADER", "PMD", "SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"] as const;

/** 這個人在哪些分組掛了可以核准工時的角色(Team Leader / PMD / 各部門 DM)。 */
async function myApproverGroupIds(userId: string): Promise<string[]> {
  const rows = await prisma.groupRoleAssignment.findMany({
    where: { userId, role: { in: [...APPROVER_ROLES] } },
    select: { groupId: true },
  });
  return [...new Set(rows.map((r) => r.groupId))];
}

export async function listApprovalQueue(): Promise<ApprovalQueue> {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";
  const [reportIds, groupIds] = await Promise.all([
    approvableUserIds(session),
    isAdmin ? Promise.resolve([] as string[]) : myApproverGroupIds(session.userId),
  ]);
  if (reportIds.length === 0 && groupIds.length === 0) {
    return { timeEntries: [], activityEntries: [], leaves: [], isApprover: false };
  }

  // 候選:管理者看全部;其他人看「直屬部屬」或「自己有核准角色的分組」裡的待審工時,
  // 再用同一套規則(含 DM 只能核准同部門)逐筆確認。
  const entryScope = isAdmin
    ? {}
    : { OR: [{ userId: { in: reportIds } }, { item: { groupId: { in: groupIds } } }] };
  const activityScope = isAdmin
    ? {}
    : { OR: [{ userId: { in: reportIds } }, { board: { is: { groups: { some: { id: { in: groupIds } } } } } }] };

  const [entries, activity, leaves] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { status: "PENDING", userId: { not: session.userId }, item: { deletedAt: null }, ...entryScope },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { name: true } },
        item: { select: { id: true, name: true, groupId: true, board: { select: { id: true, name: true } } } },
      },
    }),
    prisma.activityTimeEntry.findMany({
      where: {
        status: "PENDING",
        userId: { not: session.userId },
        boardId: { not: null },
        board: { is: { deletedAt: null } },
        ...activityScope,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { name: true } },
        category: { select: { name: true } },
        board: { select: { id: true, name: true } },
      },
    }),
    reportIds.length > 0
      ? prisma.leave.findMany({
          where: { status: "PENDING", userId: { in: reportIds } },
          orderBy: { startDate: "asc" },
          include: { user: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  // 逐筆確認這個人真的是核准人。
  const boardGroups = await groupIdsOfBoards([...new Set(activity.map((a) => a.boardId!))]);
  const subjects: ApprovalSubject[] = [
    ...entries.map((e) => ({ key: `t:${e.id}`, userId: e.userId, groupIds: [e.item.groupId] })),
    ...activity.map((e) => ({ key: `a:${e.id}`, userId: e.userId, groupIds: boardGroups.get(e.boardId!) ?? [] })),
  ];
  const approvers = await resolveApprovers(subjects);
  const mayDecide = (key: string) => approvers.get(key)?.some((a) => a.userId === session.userId) ?? false;

  return {
    isApprover: true,
    timeEntries: entries
      .filter((entry) => mayDecide(`t:${entry.id}`))
      .map((entry) => ({
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
    activityEntries: activity
      .filter((entry) => mayDecide(`a:${entry.id}`))
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        userName: entry.user.name,
        date: entry.date,
        hours: Number(entry.hours),
        note: entry.note ?? "",
        categoryName: entry.category.name,
        boardId: entry.board!.id,
        boardName: entry.board!.name,
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
 * 這個人能不能核准這筆工時,以什麼身分(寫進稽核紀錄:誰核准的、憑什麼身分核准的)。
 * 回傳身分的文字;不能核准就丟錯。
 */
async function assertMayDecideEntry(session: SessionPayload, subject: ApprovalSubject): Promise<string> {
  if (subject.userId === session.userId) throw new Error("不能審核自己送出的紀錄");
  const approvers = (await resolveApprovers([subject])).get(subject.key) ?? [];
  const me = approvers.find((a) => a.userId === session.userId);
  if (!me) throw new Error("權限不足:只有該專案分組的 Team Leader / PMD、同部門的 DM、直屬主管或管理者可以核准這筆工時");
  return me.reasonLabel;
}

/**
 * 核准或退回一筆工時.
 *
 * Approving is what makes the hours real: until then they are outside the
 * board's actual cost entirely, so a CPI does not move because somebody typed
 * a number — it moves because somebody who is accountable for the project
 * agreed with it. Who agreed, and in what capacity, is written down.
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
      item: { select: { name: true, boardId: true, groupId: true } },
    },
  });
  if (!entry) return { error: "找不到這筆工時" };
  let capacity: string;
  try {
    capacity = await assertMayDecideEntry(session, { key: "t", userId: entry.userId, groupIds: [entry.item.groupId] });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "權限不足" };
  }

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
    `${status === "APPROVED" ? "核准" : "退回"}工時(以「${capacity}」身分):${entry.user.name} ${entry.date} ${Number(
      entry.hours
    )}h（${entry.item.name}）${trimmed ? `:${trimmed}` : ""}`,
    entry.item.boardId
  );
  revalidatePath("/approvals");
  revalidatePath("/timesheet");
  revalidatePath(`/boards/${entry.item.boardId}`);
  return {};
}

/** 核准或退回一筆對應專案的非專案工時。核准後才計入那個專案的實際成本。 */
export async function decideActivityTime(
  entryId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.activityTimeEntry.findUnique({
    where: { id: entryId },
    include: { user: { select: { name: true } }, category: { select: { name: true } } },
  });
  if (!entry || !entry.boardId) return { error: "找不到這筆工時" };
  let capacity: string;
  try {
    const groups = (await groupIdsOfBoards([entry.boardId])).get(entry.boardId) ?? [];
    capacity = await assertMayDecideEntry(session, { key: "a", userId: entry.userId, groupIds: groups });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "權限不足" };
  }

  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "退回必須寫下原因" };

  await prisma.activityTimeEntry.update({
    where: { id: entryId },
    data: { status, decidedById: session.userId, decidedAt: new Date(), decisionNote: trimmed || null },
  });
  await logAudit(
    "APPROVAL",
    session.userId,
    `${status === "APPROVED" ? "核准" : "退回"}工時(以「${capacity}」身分):${entry.user.name} ${entry.date} ${Number(
      entry.hours
    )}h(${entry.category.name})${trimmed ? `:${trimmed}` : ""}`,
    entry.boardId
  );
  revalidatePath("/approvals");
  revalidatePath("/timesheet");
  revalidatePath(`/boards/${entry.boardId}`);
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
  const [reports, roles] = await Promise.all([
    prisma.user.count({ where: { supervisorId: session.userId } }),
    prisma.groupRoleAssignment.count({ where: { userId: session.userId, role: { in: [...APPROVER_ROLES] } } }),
  ]);
  return reports > 0 || roles > 0;
}
