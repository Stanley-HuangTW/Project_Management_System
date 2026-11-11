"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { notifyActivityApprovalNeeded } from "@/lib/approvalNotify";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import type { SessionPayload } from "@/lib/jwt";
import { weekRangeOf } from "@/lib/weeklyReport";
import { riskLinkTag } from "@/lib/riskRegister";
import { validateStartMinute } from "@/lib/timeOfDay";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { DAILY_LIMIT_HOURS, hoursAlreadyLoggedOn } from "@/lib/timesheetHours";
import {
  EXEMPT_DECISION_NOTE,
  formatApprovers,
  groupIdsOfBoards,
  isTimesheetExempt,
  resolveApprovers,
} from "@/lib/timesheetApproval";
import {
  MAX_STATS_RANGE_DAYS,
  PROJECT_CATEGORY_LABEL,
  UNASSIGNED_PROJECT_LABEL,
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
  boardId: string;
  boardName: string;
  hours: number;
  /** 從工作項預估匯入時當初的預估時數(hours 是實際);不是匯入的是 null。 */
  estimateHours: number | null;
  note: string;
  status: ApprovalStatus;
  /** 一天中的開始時間(從 00:00 起算的分鐘數),null = 沒排時間。 */
  startMinute: number | null;
  /** 用「重複」一次建立的一批共用的識別;單獨登記的是 null。 */
  seriesId: string | null;
  decisionNote: string | null;
  /** 待審時:可以核准的人(姓名與身分)。 */
  approvers: string[];
  /** 核准或退回的人;免審核的沒有。 */
  decidedByName: string | null;
};

export type ActivityDayEntry = {
  id: string;
  hours: number;
  note: string;
  categoryId: string;
  categoryName: string;
  riskEntryId: string | null;
  riskTitle: string | null;
  /** 連結的風險/議題是什麼:風險、議題,或 Mantis 編號。 */
  riskTag: string | null;
  /** 對應的專案;有的話要主管核准才計入那個專案的成本。 */
  boardId: string | null;
  boardName: string | null;
  startMinute: number | null;
  seriesId: string | null;
  status: ApprovalStatus;
  decisionNote: string | null;
  approvers: string[];
  decidedByName: string | null;
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
  categories: { id: string; name: string; linkIssue: boolean; allowProject: boolean }[];
  /** 指派給我、而且我看得到的工作項。 */
  items: { id: string; name: string; boardName: string }[];
  /** 我看得到的專案(看板),給「對應專案」選。 */
  boards: { id: string; name: string }[];
  /** 我看得到的看板上的風險與議題(含從 Mantis 同步來的),給「連結風險 / 議題」選。 */
  risks: { id: string; title: string; boardName: string; closed: boolean; tag: string }[];
};


async function loadViewer(session: SessionPayload): Promise<TimesheetViewer> {
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { canViewAllTimesheets: true },
  });
  return { id: session.userId, role: session.role, canViewAllTimesheets: user?.canViewAllTimesheets ?? false };
}


export async function listMyWeek(weekStart: string): Promise<MyWeek | { error: string }> {
  const session = await requireSession();
  if (!isValidIsoDate(weekStart)) return { error: "日期格式不正確" };
  const range = weekRangeOf(weekStart);

  const [project, activity] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId: session.userId, date: { gte: range.weekStart, lte: range.weekEnd } },
      orderBy: { createdAt: "asc" },
      include: {
        item: { select: { name: true, groupId: true, board: { select: { id: true, name: true } } } },
        decidedBy: { select: { name: true } },
      },
    }),
    prisma.activityTimeEntry.findMany({
      where: { userId: session.userId, date: { gte: range.weekStart, lte: range.weekEnd } },
      orderBy: { createdAt: "asc" },
      include: {
        category: { select: { name: true } },
        riskEntry: { select: { title: true, kind: true, mantisId: true } },
        board: { select: { name: true } },
      },
    }),
  ]);

  // 待審的:誰可以核准;核准過的:誰核准的(對應專案的非專案工時,decidedById 是單純的 id)。
  const boardGroups = await groupIdsOfBoards([
    ...new Set(activity.filter((e) => e.status === "PENDING" && e.boardId).map((e) => e.boardId!)),
  ]);
  const approvers = await resolveApprovers([
    ...project
      .filter((e) => e.status === "PENDING")
      .map((e) => ({ key: `t:${e.id}`, userId: e.userId, groupIds: [e.item.groupId] })),
    ...activity
      .filter((e) => e.status === "PENDING" && e.boardId)
      .map((e) => ({ key: `a:${e.id}`, userId: e.userId, groupIds: boardGroups.get(e.boardId!) ?? [] })),
  ]);
  const decidedIds = [...new Set(activity.map((e) => e.decidedById).filter((id): id is string => !!id))];
  const deciders = decidedIds.length
    ? await prisma.user.findMany({ where: { id: { in: decidedIds } }, select: { id: true, name: true } })
    : [];
  const deciderName = new Map(deciders.map((u) => [u.id, u.name]));
  const approverText = (key: string) => formatApprovers(approvers.get(key) ?? []);

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
          boardId: e.item.board.id,
          boardName: e.item.board.name,
          hours: Number(e.hours),
          estimateHours: e.estimateHours === null ? null : Number(e.estimateHours),
          note: e.note ?? "",
          status: e.status,
          startMinute: e.startMinute,
          seriesId: e.seriesId,
          decisionNote: e.decisionNote,
          approvers: approverText(`t:${e.id}`),
          decidedByName: e.decidedBy?.name ?? null,
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
          riskTag: e.riskEntry ? riskLinkTag(e.riskEntry) : null,
          boardId: e.boardId,
          boardName: e.board?.name ?? null,
          startMinute: e.startMinute,
          seriesId: e.seriesId,
          status: e.status,
          decisionNote: e.decisionNote,
          approvers: approverText(`a:${e.id}`),
          decidedByName: e.decidedById ? (deciderName.get(e.decidedById) ?? null) : null,
        })),
    })),
  };
}

export async function getTimesheetOptions(): Promise<TimesheetOptions> {
  const session = await requireSession();
  const boardWhere = accessibleBoardWhere(session);

  const [categories, assignments, risks, boards] = await Promise.all([
    prisma.timeCategory.findMany({
      where: { active: true },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, linkIssue: true, allowProject: true },
    }),
    prisma.assignment.findMany({
      where: { userId: session.userId, item: { deletedAt: null, board: boardWhere } },
      select: { item: { select: { id: true, name: true, board: { select: { name: true } } } } },
    }),
    prisma.riskEntry.findMany({
      where: { board: boardWhere },
      orderBy: { updatedAt: "desc" },
      take: 500,
      select: { id: true, title: true, status: true, kind: true, mantisId: true, board: { select: { name: true } } },
    }),
    prisma.board.findMany({ where: boardWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    categories,
    boards,
    items: assignments
      .map((a) => ({ id: a.item.id, name: a.item.name, boardName: a.item.board.name }))
      .sort((a, b) => a.boardName.localeCompare(b.boardName, "zh-TW") || a.name.localeCompare(b.name, "zh-TW")),
    risks: risks.map((r) => ({
      id: r.id,
      title: r.title,
      boardName: r.board.name,
      closed: r.status === "CLOSED",
      tag: riskLinkTag(r),
    })),
  };
}

type ActivityInput = {
  date: string;
  hours: number;
  categoryId: string;
  note: string;
  riskEntryId: string | null;
  /** 對應的專案(看板)。要主管核准才計入那個專案的成本。 */
  boardId?: string | null;
  /** 一天中的開始時間(分鐘),行事曆用。 */
  startMinute?: number | null;
  /** 從外部日曆匯入時的識別,只在登記時寫入。 */
  externalId?: string | null;
  /** 用「重複」一次建立一批時共用的識別,只在登記時寫入。 */
  seriesId?: string | null;
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
    select: { active: true, linkIssue: true, allowProject: true },
  });
  if (!category) return "找不到這個類別";

  const startError = validateStartMinute(input.startMinute, input.hours);
  if (startError) return startError;

  if (input.boardId) {
    if (!category.allowProject) return "這個類別不能對應專案";
    const board = await prisma.board.findFirst({
      where: { id: input.boardId, ...accessibleBoardWhere(session) },
      select: { id: true },
    });
    if (!board) return "找不到這個專案,或你沒有它的存取權限";
  }

  if (input.riskEntryId) {
    if (!category.linkIssue) return "這個類別不能連結風險或議題";
    const risk = await prisma.riskEntry.findFirst({
      where: { id: input.riskEntryId, board: accessibleBoardWhere(session) },
      select: { id: true },
    });
    if (!risk) return "找不到這個風險或議題,或你沒有它所在看板的存取權限";
  }

  const already = await hoursAlreadyLoggedOn(userId, input.date, { activityEntryId: excludeActivityId });
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

  // 對應專案的要核准;管理者設定「工時免審核」的人直接生效。
  const exempt = input.boardId ? await isTimesheetExempt(session.userId) : false;

  await prisma.activityTimeEntry.create({
    data: {
      userId: session.userId,
      date: input.date,
      hours: input.hours,
      categoryId: input.categoryId,
      note: input.note.trim() || null,
      riskEntryId: input.riskEntryId,
      startMinute: input.startMinute ?? null,
      externalId: input.externalId ?? null,
      seriesId: input.seriesId ?? null,
      // 有對應專案的要主管核准才算進專案成本;沒有的登記即生效。
      boardId: input.boardId || null,
      status: input.boardId && !exempt ? "PENDING" : "APPROVED",
      ...(input.boardId && exempt ? { decidedAt: new Date(), decisionNote: EXEMPT_DECISION_NOTE } : {}),
    },
  });
  if (input.boardId && !exempt) await notifyActivityApprovalNeeded(session.userId, input.boardId);
  revalidatePath("/timesheet");
  revalidatePath("/approvals");
  return {};
}

export async function updateActivityTime(
  entryId: string,
  input: ActivityInput
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.activityTimeEntry.findUnique({
    where: { id: entryId },
    select: { userId: true, categoryId: true, date: true, hours: true, boardId: true, status: true },
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

  // 改了日期、時數、類別或專案,就要重新送審;只改備註或開始時間(不影響成本)就維持原本的審核結果。
  const boardId = input.boardId || null;
  const affectsCost =
    entry.date !== input.date ||
    Number(entry.hours) !== input.hours ||
    entry.categoryId !== input.categoryId ||
    entry.boardId !== boardId;
  const exempt = boardId ? await isTimesheetExempt(entry.userId) : false;
  const resubmit = boardId !== null && (affectsCost || entry.status === "REJECTED");
  await prisma.activityTimeEntry.update({
    where: { id: entryId },
    data: {
      date: input.date,
      hours: input.hours,
      categoryId: input.categoryId,
      note: input.note.trim() || null,
      riskEntryId: input.riskEntryId,
      startMinute: input.startMinute ?? null,
      boardId,
      ...(boardId === null
        ? { status: "APPROVED", decidedById: null, decidedAt: null, decisionNote: null }
        : resubmit
          ? exempt
            ? { status: "APPROVED", decidedById: null, decidedAt: new Date(), decisionNote: EXEMPT_DECISION_NOTE }
            : { status: "PENDING", decidedById: null, decidedAt: null, decisionNote: null }
          : {}),
    },
  });
  if (boardId && resubmit && !exempt) await notifyActivityApprovalNeeded(entry.userId, boardId);
  revalidatePath("/timesheet");
  revalidatePath("/approvals");
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

/** 統計頁的人員篩選——只有看得到工時的人才會出現在名單裡;附上所屬單位,讓畫面可以依部門選取。 */
export async function listViewableUsers(): Promise<{
  users: { id: string; name: string; discipline: string | null }[];
  units: { code: string; label: string }[];
}> {
  const session = await requireSession();
  const viewer = await loadViewer(session);
  const [users, units] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, discipline: true },
      orderBy: { order: "asc" },
    }),
    loadOrgUnits(),
  ]);
  return {
    users: users
      .filter((u) => canViewTimesheetOf(viewer, u))
      .map((u) => ({ id: u.id, name: u.name, discipline: u.discipline })),
    units: units.map((u) => ({ code: u.code, label: u.label })),
  };
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
      select: { userId: true, date: true, hours: true, item: { select: { board: { select: { name: true } } } } },
    }),
    prisma.activityTimeEntry.findMany({
      where: {
        userId: { in: selectedIds },
        date: { gte: input.from, lte: input.to },
        // 沒對應專案的登記即生效(APPROVED);對應專案的跟專案工時同一個規則。
        status: input.includePending ? { not: "REJECTED" } : "APPROVED",
      },
      select: {
        userId: true,
        date: true,
        hours: true,
        category: { select: { name: true } },
        board: { select: { name: true } },
      },
    }),
  ]);

  const rows: TimesheetRow[] = [
    ...project.map((e) => ({
      userId: e.userId,
      date: e.date,
      hours: Number(e.hours),
      categoryLabel: PROJECT_CATEGORY_LABEL,
      projectLabel: e.item.board.name,
    })),
    ...activity.map((e) => ({
      userId: e.userId,
      date: e.date,
      hours: Number(e.hours),
      categoryLabel: e.category.name,
      projectLabel: e.board?.name ?? UNASSIGNED_PROJECT_LABEL,
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
