"use server";

import { revalidatePath } from "next/cache";
import type { GanttDurationMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";

export async function getSystemSettings() {
  const settings = await prisma.systemSettings.findUnique({ where: { id: "global" } });
  if (settings) return settings;
  return {
    id: "global",
    emailNotificationsEnabled: false,
    levelColors: [] as string[],
    ganttDurationMode: "BUSINESS" as GanttDurationMode,
    ganttOverdueColor: "#e2445c",
    ganttCompletedColor: "#9ca3af",
    ganttInProgressColor: "#00c875",
    predReadyColor: "#00c875",
    predWaitingColor: "#fdab3d",
    predBlockedColor: "#e2445c",
    hoursPerDay: 8,
    updatedAt: new Date(),
  };
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
