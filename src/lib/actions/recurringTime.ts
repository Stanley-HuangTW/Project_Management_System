"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { recurrenceDates, validateRecurrence, type RecurrenceRule } from "@/lib/recurrence";
import { applySpecs, type EntrySpec } from "@/lib/timesheetCreate";
import type { ApplyResult } from "@/lib/timeTemplates";

/**
 * 一次建立一批重複的工時(例行會議):從 startDate 起,依規則到 until 為止,符合的每一天各一筆。
 * 每一筆都走一般登記流程——對應專案的要核准、免審核的人直接生效、一天超過 24 小時的會被擋下並說明;
 * 同一天已經有一樣的就不重複建立。這一批共用一個 seriesId,之後可以一次刪掉某一筆之後的整批。
 */
export async function createRecurringEntries(input: {
  spec: EntrySpec;
  startDate: string;
  rule: RecurrenceRule;
  until: string;
  label: string;
}): Promise<ApplyResult | { error: string }> {
  const session = await requireSession();
  const invalid = validateRecurrence(input.startDate, input.rule, input.until);
  if (invalid) return { error: invalid };

  const seriesId = randomUUID();
  const dates = recurrenceDates(input.startDate, input.rule, input.until);
  const result = await applySpecs(
    session.userId,
    dates.map((date) => ({ date, label: input.label, spec: input.spec, seriesId }))
  );
  revalidatePath("/timesheet");
  revalidatePath("/approvals");
  return result;
}

/** 刪掉這一筆和它之後(同一批、日期不早於它)的重複工時;只能刪自己的(管理者可以刪別人的)。 */
export async function deleteSeriesFrom(
  kind: "project" | "activity",
  entryId: string
): Promise<{ error?: string; deleted?: number }> {
  const session = await requireSession();
  const entry =
    kind === "project"
      ? await prisma.timeEntry.findUnique({ where: { id: entryId }, select: { userId: true, seriesId: true, date: true } })
      : await prisma.activityTimeEntry.findUnique({ where: { id: entryId }, select: { userId: true, seriesId: true, date: true } });
  if (!entry) return { error: "找不到這筆工時" };
  if (entry.userId !== session.userId && session.role !== "ADMIN") return { error: "只能刪除自己登記的工時" };
  if (!entry.seriesId) return { error: "這筆不是用「重複」建立的" };

  const where = { userId: entry.userId, seriesId: entry.seriesId, date: { gte: entry.date } };
  const { count } = kind === "project" ? await prisma.timeEntry.deleteMany({ where }) : await prisma.activityTimeEntry.deleteMany({ where });
  revalidatePath("/timesheet");
  revalidatePath("/approvals");
  return { deleted: count };
}
