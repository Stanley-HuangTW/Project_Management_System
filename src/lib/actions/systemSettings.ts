"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type GanttDurationMode, type NotificationType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { ALL_NOTIFICATION_TYPES } from "@/lib/notificationTypes";
import {
  BUILT_IN_DEFAULT_COLUMNS,
  parseDefaultColumns,
  type DefaultColumn,
} from "@/lib/defaultColumns";

export async function getSystemSettings() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" } });
  if (settings) return settings;
  return {
    id: "global",
    emailNotificationsEnabled: false,
    enabledNotificationTypes: ALL_NOTIFICATION_TYPES,
    levelColors: [] as string[],
    ganttDurationMode: "BUSINESS" as GanttDurationMode,
    ganttOverdueColor: "#e2445c",
    ganttCompletedColor: "#9ca3af",
    ganttInProgressColor: "#00c875",
    predReadyColor: "#00c875",
    predWaitingColor: "#fdab3d",
    predBlockedColor: "#e2445c",
    hoursPerDay: 8,
    workingDaysPerMonth: 21,
    defaultColumns: null as Prisma.JsonValue,
    weeklyReportEnabled: false,
    weeklyReportDow: 1,
    weeklyReportHour: 6,
    weeklyReportMinute: 0,
    weeklyReportLastRunWeek: null as string | null,
    backupEnabled: false,
    backupFrequency: "DAILY",
    backupDow: 1,
    backupHour: 3,
    backupMinute: 0,
    backupRetentionDays: 60,
    backupLastRunDate: null as string | null,
    updatedAt: new Date(),
  };
}

/** 新看板預設欄位, as the settings card shows them. Always a usable list —
 *  the built-in one when nobody has configured anything. */
export async function listDefaultBoardColumns(): Promise<{
  columns: DefaultColumn[];
  /** False while the built-in list is what new boards get. */
  configured: boolean;
}> {
  const settings = await getSystemSettings();
  return {
    columns: parseDefaultColumns(settings.defaultColumns),
    configured: Array.isArray(settings.defaultColumns) && settings.defaultColumns.length > 0,
  };
}

/**
 * 新看板要帶哪些欄位。
 *
 * Copied off a board that is already laid out the way this company's projects
 * actually look, rather than typed in field by field — that is how anyone
 * actually knows what they want, and it keeps the option lists (Type/Status/
 * Link) identical to the board they came from instead of subtly different.
 *
 * Existing boards are not touched. A board's columns hold its data; rewriting
 * them to match a new default would destroy it.
 */
export async function setDefaultBoardColumnsFromBoard(boardId: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      name: true,
      columns: { orderBy: { order: "asc" }, select: { name: true, type: true, options: true } },
    },
  });
  if (!board) throw new Error("找不到看板");
  if (board.columns.length === 0) throw new Error("這個看板沒有欄位可以複製");

  const columns = parseDefaultColumns(board.columns);
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", defaultColumns: columns as Prisma.InputJsonValue },
    update: { defaultColumns: columns as Prisma.InputJsonValue },
  });
  await logAudit(
    "SETTINGS",
    session.userId,
    `新看板預設欄位改為複製自「${board.name}」(${columns.length} 個欄位:${columns.map((c) => c.name).join("、")})`
  );

  revalidatePath("/settings");
  return columns;
}

/** 恢復內建的那一份 — new boards go back to the standard column set. */
export async function resetDefaultBoardColumns() {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", defaultColumns: Prisma.DbNull },
    update: { defaultColumns: Prisma.DbNull },
  });
  await logAudit("SETTINGS", session.userId, "新看板預設欄位恢復為內建的那一份");

  revalidatePath("/settings");
  return BUILT_IN_DEFAULT_COLUMNS;
}

/** 一天算幾小時 — the factor that turns "50% for 10 days" into hours, and
 *  therefore into money. */
export async function setHoursPerDay(hours: number) {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  if (!Number.isFinite(hours) || hours < 1 || hours > 24) {
    throw new Error("每日工時必須在 1 到 24 之間");
  }
  const value = Math.round(hours);
  const before = await getSystemSettings();
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", hoursPerDay: value },
    update: { hoursPerDay: value },
  });
  // 這是把「50% 排 10 天」換算成小時、再換算成錢的係數。
  await logAudit("SETTINGS", session.userId, `每日工時:${before.hoursPerDay} → ${value} 小時`);
  revalidatePath("/settings");
}

/** 一個人月算幾個工作天 — 把月薪換算成時薪、把人月換算成工時的係數。 */
export async function setWorkingDaysPerMonth(days: number) {
  const session = await requireSession();
  requireBoardAdmin(session.role);
  if (!Number.isFinite(days) || days < 1 || days > 31) {
    throw new Error("每月工作天數必須在 1 到 31 之間");
  }
  const value = Math.round(days);
  const before = await getSystemSettings();
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", workingDaysPerMonth: value },
    update: { workingDaysPerMonth: value },
  });
  await logAudit(
    "SETTINGS",
    session.userId,
    `每月工作天數:${before.workingDaysPerMonth} → ${value} 天`
  );
  revalidatePath("/settings");
}

export async function setEmailNotificationsEnabled(enabled: boolean) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", emailNotificationsEnabled: enabled },
    update: { emailNotificationsEnabled: enabled },
  });
  await logAudit("SETTINGS", session.userId, `Email 通知${enabled ? "開啟" : "關閉"}`);

  revalidatePath("/settings");
}

/** 管理者決定這套系統要啟用哪些通知類型——關掉的類型不管使用者個人怎麼
 *  設定,站內與 email 都不會再產生(見 notify.ts 的 filterInAppRecipients/
 *  notifyEmailIfNeeded)。 */
export async function setEnabledNotificationTypes(types: NotificationType[]) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const unique = ALL_NOTIFICATION_TYPES.filter((t) => types.includes(t));
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", enabledNotificationTypes: unique },
    update: { enabledNotificationTypes: unique },
  });
  await logAudit("SETTINGS", session.userId, `通知類型設定已更新:啟用 ${unique.join("、")}`);

  revalidatePath("/settings");
}

const DOW_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 專案週報分發的排程時間——星期幾、幾點幾分,見 weeklyReportTick 那條路。 */
export async function setWeeklyReportSchedule(schedule: {
  enabled: boolean;
  dow: number;
  hour: number;
  minute: number;
}): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (schedule.dow < 0 || schedule.dow > 6) return { error: "星期幾不合法" };
  if (schedule.hour < 0 || schedule.hour > 23) return { error: "小時不合法" };
  if (schedule.minute < 0 || schedule.minute > 59) return { error: "分鐘不合法" };

  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: {
      id: "global",
      weeklyReportEnabled: schedule.enabled,
      weeklyReportDow: schedule.dow,
      weeklyReportHour: schedule.hour,
      weeklyReportMinute: schedule.minute,
    },
    update: {
      weeklyReportEnabled: schedule.enabled,
      weeklyReportDow: schedule.dow,
      weeklyReportHour: schedule.hour,
      weeklyReportMinute: schedule.minute,
    },
  });
  await logAudit(
    "SETTINGS",
    session.userId,
    schedule.enabled
      ? `專案週報排程設定為每${DOW_LABELS[schedule.dow]} ${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`
      : "專案週報排程關閉"
  );
  revalidatePath("/settings");
  return {};
}

/**
 * 階層顏色 and 計算方式 used to be per-board settings; they're app-wide now.
 * A write here also broadcasts to every Board's own copy of the field, so
 * the many existing places that read board.levelColors/board.ganttDurationMode
 * don't need to change — they just always see the current global value.
 */
export async function setLevelColors(colors: string[]) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  await prisma.$transaction([
    prisma.systemSettings.upsert({
      where: { id: "global" },
      create: { id: "global", levelColors: colors },
      update: { levelColors: colors },
    }),
    prisma.board.updateMany({ data: { levelColors: colors } }),
  ]);
  await logAudit("SETTINGS", session.userId, `階層顏色更新(${colors.filter(Boolean).length} 層有設定)`);

  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
}

export async function setGanttDurationMode(mode: GanttDurationMode) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  await prisma.$transaction([
    prisma.systemSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ganttDurationMode: mode },
      update: { ganttDurationMode: mode },
    }),
    prisma.board.updateMany({ data: { ganttDurationMode: mode } }),
  ]);
  // 這一個開關會改變每一張甘特圖的結束日怎麼算出來。
  await logAudit(
    "SETTINGS",
    session.userId,
    `甘特圖計算方式改為${mode === "BUSINESS" ? "工作天" : "日曆天"}`
  );

  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
}

/**
 * Colors for the Gantt task-name text, by status: 逾期 (overdue, past its
 * end date and not done), 完成 (done), 實作中 (in progress, started but not
 * yet overdue/done). 尚未處理 (not started) deliberately has no color here —
 * it just gets the theme's normal text color.
 */
export async function setGanttStatusColors(colors: {
  overdue: string;
  completed: string;
  inProgress: string;
}) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const data = {
    ganttOverdueColor: colors.overdue,
    ganttCompletedColor: colors.completed,
    ganttInProgressColor: colors.inProgress,
  };

  await prisma.$transaction([
    prisma.systemSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ...data },
      update: data,
    }),
    prisma.board.updateMany({ data }),
  ]);
  await logAudit(
    "SETTINGS",
    session.userId,
    `甘特圖項目名稱顏色更新:逾期 ${colors.overdue}、完成 ${colors.completed}、實作中 ${colors.inProgress}`
  );

  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
}

/**
 * Colors for the Pred lamp, by what the predecessor's own state means for the
 * item that depends on it: ready (predecessor done — this may start), waiting
 * (predecessor still running), blocked (predecessor overdue). Mirrored onto
 * every board the same way setGanttStatusColors does, so any view that
 * already loads the board can read them without another query.
 */
export async function setPredLampColors(colors: {
  ready: string;
  waiting: string;
  blocked: string;
}) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const data = {
    predReadyColor: colors.ready,
    predWaitingColor: colors.waiting,
    predBlockedColor: colors.blocked,
  };

  await prisma.$transaction([
    prisma.systemSettings.upsert({
      where: { id: "global" },
      create: { id: "global", ...data },
      update: data,
    }),
    prisma.board.updateMany({ data }),
  ]);
  await logAudit(
    "SETTINGS",
    session.userId,
    `Pred 燈號顏色更新:可開始 ${colors.ready}、等待中 ${colors.waiting}、被卡住 ${colors.blocked}`
  );

  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
}
