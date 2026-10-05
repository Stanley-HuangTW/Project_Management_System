"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import type { SessionPayload } from "@/lib/jwt";
import { weekRangeOf } from "@/lib/weeklyReport";
import {
  MAX_STATS_RANGE_DAYS,
  PROJECT_CATEGORY_LABEL,
  aggregateTimesheet,
  canViewTimesheetOf,
  daysBetweenInclusive,
  isValidIsoDate,
  weekDays,
  type Granularity,
  type TimesheetRow,
  type TimesheetStats,
  type TimesheetViewer,
} from "@/lib/timesheet";

export type ProjectDayEntry = {
  id: string;
  itemId: string;
  itemName: string;
  boardName: string;
  hours: number;
  note: string;
  status: ApprovalStatus;
};

export type ActivityDayEntry = {
  id: string;
  hours: number;
  note: string;
  categoryId: string;
  categoryName: string;
  riskEntryId: string | null;
  riskTitle: string | null;
};

export type TimesheetDay = {
  date: string;
  project: ProjectDayEntry[];
  activity: ActivityDayEntry[];
};

export type MyWeek = {
  weekStart: string;
  weekEnd: string;
  days: TimesheetDay[];
};

export type TimesheetOptions = {
  /** 只列啟用中的類別——停用的不能再登記,但舊紀錄仍然顯示它的名字。 */
  categories: { id: string; name: string; linkIssue: boolean }[];
  /** 指派給我、而且我看得到的工作項。 */
  items: { id: string; name: string; boardName: string }[];
  /** 我看得到的看板上的議題。 */
  issues: { id: string; title: string; boardName: string; closed: boolean }[];
};

const DAILY_LIMIT_HOURS = 24;

async function loadViewer(session: SessionPayload): Promise<TimesheetViewer> {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { canViewAllTimesheets: true },
  });
  return { id: session.userId, role: session.role, canViewAllTimesheets: user?.canViewAllTimesheets ?? false };
}

/** 這個人這一天已經登記的時數(專案未退回 + 非專案),可以排除正在編輯的那一筆。 */
async function hoursAlreadyLoggedOn(userId: string, date: string, excludeActivityId?: string): Promise<number> {
  const [project, activity] = await Promise.all([
    prisma.timeEntry.aggregate({
      where: { userId, date, status: { not: "REJECTED" } },
      _sum: { hours: true },
    }),
    prisma.activityTimeEntry.aggregate({
      where: { userId, date, ...(excludeActivityId ? { id: { not: excludeActivityId } } : {}) },
      _sum: { hours: true },
    }),
  ]);
  return Number(project._sum.hours ?? 0) + Number(activity._sum.hours ?? 0);
}

export async function listMyWeek(weekStart: string): Promise<MyWeek | { error: string }> {
  const session = await requireSession();
  if (!isValidIsoDate(weekStart)) return { error: "日期格式不正確" };
  const range = weekRangeOf(weekStart);

  const [project, activity] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId: session.userId, date: { gte: range.weekStart, lte: range.weekEnd } },
      orderBy: { createdAt: "asc" },
      include: { item: { select: { name: true, board: { select: { name: true } } } } },
    }),
    prisma.activityTimeEntry.findMany({
      where: { userId: session.userId, date: { gte: range.weekStart, lte: range.weekEnd } },
      orderBy: { createdAt: "asc" },
      include: { category: { select: { name: true } }, riskEntry: { select: { title: true } } },
    }),
  ]);

  return {
    weekStart: range.weekStart,
    weekEnd: range.weekEnd,
    days: weekDays(range.weekStart).map((date) => ({
      date,
      project: project
        .filter((e) => e.date === date)
        .map((e) => ({
          id: e.id,
          itemId: e.itemId,
          itemName: e.item.name,
          boardName: e.item.board.name,
          hours: Number(e.hours),
          note: e.note ?? "",
          status: e.status,
        })),
      activity: activity
        .filter((e) => e.date === date)
        .map((e) => ({
          id: e.id,
          hours: Number(e.hours),
          note: e.note ?? "",
          categoryId: e.categoryId,
          categoryName: e.category.name,
          riskEntryId: e.riskEntryId,
          riskTitle: e.riskEntry?.title ?? null,
        })),
    })),
  };
}

export async function getTimesheetOptions(): Promise<TimesheetOptions> {
  const session = await requireSession();
  const boardWhere = accessibleBoardWhere(session);

  const [categories, assignments, issues] = await Promise.all([
    prisma.timeCategory.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, linkIssue: true },
    }),
    prisma.assignment.findMany({
      where: { userId: session.userId, item: { deletedAt: null, board: boardWhere } },
      select: { item: { select: { id: true, name: true, board: { select: { name: true } } } } },
    }),
    prisma.riskEntry.findMany({
      where: { kind: "ISSUE", board: boardWhere },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, title: true, status: true, board: { select: { name: true } } },
    }),
  ]);

  return {
    categories,
    items: assignments
      .map((a) => ({ id: a.item.id, name: a.item.name, boardName: a.item.board.name }))
      .sort((a, b) => a.boardName.localeCompare(b.boardName, "zh-TW") || a.name.localeCompare(b.name, "zh-TW")),
    issues: issues.map((r) => ({
      id: r.id,
      title: r.title,
      boardName: r.board.name,
      closed: r.status === "CLOSED",
    })),
  };
}

type ActivityInput = {
  date: string;
  hours: number;
  categoryId: string;
  note: string;
  riskEntryId: string | null;
};

/** 登記跟修改共用的檢查——回傳錯誤訊息,沒問題回 null。 */
async function validateActivityInput(
  session: SessionPayload,
  userId: string,
  input: ActivityInput,
  excludeActivityId?: string
): Promise<string | null> {
  if (!isValidIsoDate(input.date)) return "請選擇日期";
  if (!Number.isFinite(input.hours) || input.hours <= 0) return "工時必須大於 0";
  if (input.hours > DAILY_LIMIT_HOURS) return "一天不會超過 24 小時";

  const category = await prisma.timeCategory.findUnique({
    where: { id: input.categoryId },
    select: { active: true, linkIssue: true },
  });
  if (!category) return "找不到這個類別";

  if (input.riskEntryId) {
    if (!category.linkIssue) return "這個類別不能連結議題";
    const issue = await prisma.riskEntry.findFirst({
      where: { id: input.riskEntryId, kind: "ISSUE", board: accessibleBoardWhere(session) },
      select: { id: true },
    });
    if (!issue) return "找不到這個議題,或你沒有它所在看板的存取權限";
  }

  const already = await hoursAlreadyLoggedOn(userId, input.date, excludeActivityId);
  if (already + input.hours > DAILY_LIMIT_HOURS) {
    return `${input.date} 已經登記了 ${already} 小時,加上這筆會超過一天的 24 小時`;
  }
  return null;
}

/**
 * 登記非專案工時。登記即生效、不審核。
 *
 * 只能登記自己的——別人代填的工時是估計值穿著實際值的衣服。(專案工時的
 * logTime 允許 ADMIN 代登是為了補登紙本工時單,這邊沒有那個需求。)
 */
export async function logActivityTime(input: ActivityInput): Promise<{ error?: string }> {
  const session = await requireSession();
  const category = await prisma.timeCategory.findUnique({
    where: { id: input.categoryId },
    select: { active: true },
  });
  if (category && !category.active) return { error: "這個類別已經停用,不能再登記" };

  const error = await validateActivityInput(session, session.userId, input);
  if (error) return { error };

  await prisma.activityTimeEntry.create({
    data: {
      userId: session.userId,
      date: input.date,
      hours: input.hours,
      categoryId: input.categoryId,
      note: input.note.trim() || null,
      riskEntryId: input.riskEntryId,
    },
  });
  revalidatePath("/timesheet");
  return {};
}

export async function updateActivityTime(
  entryId: string,
  input: ActivityInput
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.activityTimeEntry.findUnique({
    where: { id: entryId },
    select: { userId: true, categoryId: true },
  });
  if (!entry) return { error: "找不到這筆工時" };
  if (entry.userId !== session.userId && session.role !== "ADMIN") {
    return { error: "只能修改自己登記的工時" };
  }
  // 改的是別的類別才要求它還啟用——只改時數/備註的舊紀錄,不該因為類別後來被
  // 停用就改不動。
  if (input.categoryId !== entry.categoryId) {
    const target = await prisma.timeCategory.findUnique({
      where: { id: input.categoryId },
      select: { active: true },
    });
    if (target && !target.active) return { error: "這個類別已經停用,不能改成它" };
  }

  const error = await validateActivityInput(session, entry.userId, input, entryId);
  if (error) return { error };

  await prisma.activityTimeEntry.update({
    where: { id: entryId },
    data: {
      date: input.date,
      hours: input.hours,
      categoryId: input.categoryId,
      note: input.note.trim() || null,
      riskEntryId: input.riskEntryId,
    },
  });
  revalidatePath("/timesheet");
  return {};
}

export async function deleteActivityTime(entryId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.activityTimeEntry.findUnique({
    where: { id: entryId },
    select: { userId: true },
  });
  if (!entry) return { error: "找不到這筆工時" };
  if (entry.userId !== session.userId && session.role !== "ADMIN") {
    return { error: "只能刪除自己登記的工時" };
  }
  await prisma.activityTimeEntry.delete({ where: { id: entryId } });
  revalidatePath("/timesheet");
  return {};
}

/** 統計頁的人員篩選——只有看得到工時的人才會出現在名單裡。 */
export async function listViewableUsers(): Promise<{ id: string; name: string }[]> {
  const session = await requireSession();
  const viewer = await loadViewer(session);
  const users = await prisma.user.findMany({
    select: { id: true, name: true, supervisorId: true },
    orderBy: { order: "asc" },
  });
  return users.filter((u) => canViewTimesheetOf(viewer, u)).map((u) => ({ id: u.id, name: u.name }));
}

export type TimesheetStatsInput = {
  from: string;
  to: string;
  granularity: Granularity;
  /** 沒帶就是「我看得到的全部人」。帶了也會再濾一次,不信前端。 */
  userIds?: string[];
  /** 專案工時要不要把待審核的算進去。非專案工時沒有審核,一律計入。 */
  includePending: boolean;
};

export type TimesheetStatsResult =
  | { error: string }
  | { stats: TimesheetStats; users: { id: string; name: string }[] };

export async function getTimesheetStats(input: TimesheetStatsInput): Promise<TimesheetStatsResult> {
  const session = await requireSession();
  if (!isValidIsoDate(input.from) || !isValidIsoDate(input.to)) return { error: "日期格式不正確" };
  if (input.from > input.to) return { error: "開始日期不能晚於結束日期" };
  if (daysBetweenInclusive(input.from, input.to) > MAX_STATS_RANGE_DAYS) {
    return { error: `一次最多統計 ${MAX_STATS_RANGE_DAYS} 天` };
  }
  if (!["day", "week", "month"].includes(input.granularity)) return { error: "不支援的統計粒度" };

  const viewer = await loadViewer(session);
  const everyone = await prisma.user.findMany({
    select: { id: true, name: true, supervisorId: true },
    orderBy: { order: "asc" },
  });
  const viewable = everyone.filter((u) => canViewTimesheetOf(viewer, u));
  const wanted = input.userIds ? new Set(input.userIds) : null;
  const selected = wanted ? viewable.filter((u) => wanted.has(u.id)) : viewable;
  const selectedIds = selected.map((u) => u.id);

  const [project, activity] = await Promise.all([
    prisma.timeEntry.findMany({
      // 沒有 item.deletedAt 的條件:工作項丟進垃圾桶,不代表那些時間沒花過。
      // (成本報表排除它是另一個問題——那邊算的是專案的錢。)
      where: {
        userId: { in: selectedIds },
        date: { gte: input.from, lte: input.to },
        status: input.includePending ? { not: "REJECTED" } : "APPROVED",
      },
      select: { userId: true, date: true, hours: true },
    }),
    prisma.activityTimeEntry.findMany({
      where: { userId: { in: selectedIds }, date: { gte: input.from, lte: input.to } },
      select: { userId: true, date: true, hours: true, category: { select: { name: true } } },
    }),
  ]);

  const rows: TimesheetRow[] = [
    ...project.map((e) => ({
      userId: e.userId,
      date: e.date,
      hours: Number(e.hours),
      categoryLabel: PROJECT_CATEGORY_LABEL,
    })),
    ...activity.map((e) => ({
      userId: e.userId,
      date: e.date,
      hours: Number(e.hours),
      categoryLabel: e.category.name,
    })),
  ];

  return {
    stats: aggregateTimesheet(rows, {
      from: input.from,
      to: input.to,
      granularity: input.granularity,
      userOrder: selectedIds,
    }),
    users: selected.map((u) => ({ id: u.id, name: u.name })),
  };
}
