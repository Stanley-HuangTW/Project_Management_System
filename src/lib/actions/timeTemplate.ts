"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { accessibleBoardWhere, requireItemBoardAccess } from "@/lib/boardAccess";
import { addDaysIso, isValidIsoDate } from "@/lib/timesheet";
import {
  templateDates,
  validateTemplateDraft,
  type ApplyResult,
  type TemplateDraft,
  type TemplateKind,
} from "@/lib/timeTemplates";
import { weekRangeOf } from "@/lib/weeklyReport";
import { logActivityTime } from "./activityTime";
import { logTime } from "./timeEntry";

export type TimeTemplateRow = {
  id: string;
  name: string;
  /** 管理者建立、大家都能用的共用範本。 */
  shared: boolean;
  kind: TemplateKind;
  categoryId: string | null;
  categoryName: string | null;
  itemId: string | null;
  itemName: string | null;
  boardId: string | null;
  /** 會議與其他:對應專案;專案工作項:工作項所在專案。 */
  boardName: string | null;
  startMinute: number | null;
  hours: number;
  note: string;
  weekdays: number[];
  /** 自己的範本、或管理者看共用範本,才能刪。 */
  canDelete: boolean;
};

export async function listTimeTemplates(): Promise<{ templates: TimeTemplateRow[]; isAdmin: boolean }> {
  const session = await requireSession();
  const rows = await prisma.timeTemplate.findMany({
    where: { OR: [{ ownerId: null }, { ownerId: session.userId }] },
    orderBy: { createdAt: "asc" },
    include: {
      category: { select: { name: true } },
      item: { select: { name: true, board: { select: { id: true, name: true } } } },
      board: { select: { name: true } },
    },
  });
  const templates = rows.map((t) => ({
    id: t.id,
    name: t.name,
    shared: t.ownerId === null,
    kind: (t.itemId ? "project" : "activity") as TemplateKind,
    categoryId: t.categoryId,
    categoryName: t.category?.name ?? null,
    itemId: t.itemId,
    itemName: t.item?.name ?? null,
    boardId: t.boardId ?? t.item?.board.id ?? null,
    boardName: t.board?.name ?? t.item?.board.name ?? null,
    startMinute: t.startMinute,
    hours: Number(t.hours),
    note: t.note ?? "",
    weekdays: [...t.weekdays].sort((a, b) => a - b),
    canDelete: t.ownerId === null ? session.role === "ADMIN" : true,
  }));
  return { templates, isAdmin: session.role === "ADMIN" };
}

export async function createTimeTemplate(draft: TemplateDraft): Promise<{ error?: string }> {
  const session = await requireSession();
  const invalid = validateTemplateDraft(draft);
  if (invalid) return { error: invalid };
  if (draft.shared && session.role !== "ADMIN") return { error: "只有管理者可以建立共用範本" };

  if (draft.kind === "project") {
    try {
      await requireItemBoardAccess(draft.itemId!, session);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "找不到這個工作項" };
    }
  } else {
    const category = await prisma.timeCategory.findUnique({
      where: { id: draft.categoryId! },
      select: { active: true, allowProject: true },
    });
    if (!category) return { error: "找不到這個類別" };
    if (!category.active) return { error: "這個類別已經停用" };
    if (draft.boardId) {
      if (!category.allowProject) return { error: "這個類別不能對應專案" };
      const board = await prisma.board.findFirst({
        where: { id: draft.boardId, ...accessibleBoardWhere(session) },
        select: { id: true },
      });
      if (!board) return { error: "找不到這個專案,或你沒有它的存取權限" };
    }
  }

  await prisma.timeTemplate.create({
    data: {
      name: draft.name.trim(),
      ownerId: draft.shared ? null : session.userId,
      categoryId: draft.kind === "activity" ? draft.categoryId : null,
      itemId: draft.kind === "project" ? draft.itemId : null,
      boardId: draft.kind === "activity" ? draft.boardId || null : null,
      startMinute: draft.startMinute,
      hours: draft.hours,
      note: draft.note.trim() || null,
      weekdays: [...new Set(draft.weekdays)].sort((a, b) => a - b),
    },
  });
  return {};
}

export async function deleteTimeTemplate(templateId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const template = await prisma.timeTemplate.findUnique({ where: { id: templateId }, select: { ownerId: true } });
  if (!template) return { error: "找不到這個範本" };
  const mine = template.ownerId === session.userId;
  const sharedByAdmin = template.ownerId === null && session.role === "ADMIN";
  if (!mine && !sharedByAdmin) return { error: "只能刪除自己的範本(共用範本只有管理者能刪)" };
  await prisma.timeTemplate.delete({ where: { id: templateId } });
  return {};
}

/** 要建立的一筆工時,不含日期。 */
type EntrySpec =
  | { kind: "project"; itemId: string; startMinute: number | null; hours: number; note: string }
  | {
      kind: "activity";
      categoryId: string;
      boardId: string | null;
      riskEntryId: string | null;
      startMinute: number | null;
      hours: number;
      note: string;
    };

/**
 * 在某一天建立一筆工時。同一天已經有一樣的(同工作項/類別、專案、開始時間、時數)就不重複建立。
 * 走一般登記的 logTime / logActivityTime,所以審核、24 小時上限、免審核等規則都一樣。
 */
async function createFromSpec(userId: string, date: string, spec: EntrySpec): Promise<"created" | "exists" | string> {
  if (spec.kind === "project") {
    const dup = await prisma.timeEntry.findFirst({
      where: { userId, date, itemId: spec.itemId, startMinute: spec.startMinute, hours: spec.hours, status: { not: "REJECTED" } },
      select: { id: true },
    });
    if (dup) return "exists";
    try {
      const { error } = await logTime(spec.itemId, date, spec.hours, spec.note, undefined, spec.startMinute);
      return error ?? "created";
    } catch (err) {
      return err instanceof Error ? err.message : "建立失敗";
    }
  }
  const dup = await prisma.activityTimeEntry.findFirst({
    where: {
      userId,
      date,
      categoryId: spec.categoryId,
      boardId: spec.boardId,
      startMinute: spec.startMinute,
      hours: spec.hours,
      status: { not: "REJECTED" },
    },
    select: { id: true },
  });
  if (dup) return "exists";
  const { error } = await logActivityTime({
    date,
    hours: spec.hours,
    categoryId: spec.categoryId,
    note: spec.note,
    riskEntryId: spec.riskEntryId,
    boardId: spec.boardId,
    startMinute: spec.startMinute,
  });
  return error ?? "created";
}

async function applySpecs(userId: string, items: { date: string; label: string; spec: EntrySpec }[]): Promise<ApplyResult> {
  const result: ApplyResult = { created: 0, existing: 0, failed: [] };
  // 依序建立:前面建好的會算進當天 24 小時上限。
  for (const { date, label, spec } of items) {
    const outcome = await createFromSpec(userId, date, spec);
    if (outcome === "created") result.created++;
    else if (outcome === "exists") result.existing++;
    else result.failed.push(`${date} ${label}:${outcome}`);
  }
  return result;
}

function validWeekStart(weekStart: string): boolean {
  return isValidIsoDate(weekStart) && weekRangeOf(weekStart).weekStart === weekStart;
}

/** 把範本套用到某一週(weekStart 是那週的週一):範本選的每個星期各建立一筆。 */
export async function applyTimeTemplate(templateId: string, weekStart: string): Promise<ApplyResult | { error: string }> {
  const session = await requireSession();
  if (!validWeekStart(weekStart)) return { error: "日期格式不正確" };
  const template = await prisma.timeTemplate.findUnique({
    where: { id: templateId },
    include: { item: { select: { deletedAt: true } } },
  });
  if (!template || (template.ownerId !== null && template.ownerId !== session.userId)) {
    return { error: "找不到這個範本" };
  }
  if (template.itemId && template.item?.deletedAt) return { error: "這個範本的工作項已經刪除了" };

  const hours = Number(template.hours);
  const note = template.note ?? "";
  const spec: EntrySpec = template.itemId
    ? { kind: "project", itemId: template.itemId, startMinute: template.startMinute, hours, note }
    : {
        kind: "activity",
        categoryId: template.categoryId!,
        boardId: template.boardId,
        riskEntryId: null,
        startMinute: template.startMinute,
        hours,
        note,
      };
  return applySpecs(
    session.userId,
    templateDates(weekStart, template.weekdays).map((date) => ({ date, label: template.name, spec }))
  );
}

/** 複製上一週(不含被退回的)到 weekStart 這一週:同一個星期、同一個時間,已經有一樣的就不重複建立。 */
export async function copyPreviousWeek(weekStart: string): Promise<ApplyResult | { error: string }> {
  const session = await requireSession();
  if (!validWeekStart(weekStart)) return { error: "日期格式不正確" };
  const prevStart = addDaysIso(weekStart, -7);
  const range = { gte: prevStart, lte: addDaysIso(prevStart, 6) };
  const [project, activity] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { userId: session.userId, date: range, status: { not: "REJECTED" } },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      include: { item: { select: { name: true } } },
    }),
    prisma.activityTimeEntry.findMany({
      where: { userId: session.userId, date: range, status: { not: "REJECTED" } },
      orderBy: [{ date: "asc" }, { startMinute: "asc" }],
      include: { category: { select: { name: true } } },
    }),
  ]);
  const items = [
    ...project.map((e) => ({
      date: addDaysIso(e.date, 7),
      label: e.item.name,
      spec: {
        kind: "project",
        itemId: e.itemId,
        startMinute: e.startMinute,
        hours: Number(e.hours),
        note: e.note ?? "",
      } satisfies EntrySpec,
    })),
    ...activity.map((e) => ({
      date: addDaysIso(e.date, 7),
      label: e.category.name,
      spec: {
        kind: "activity",
        categoryId: e.categoryId,
        boardId: e.boardId,
        riskEntryId: e.riskEntryId,
        startMinute: e.startMinute,
        hours: Number(e.hours),
        note: e.note ?? "",
      } satisfies EntrySpec,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (items.length === 0) return { created: 0, existing: 0, failed: [] };
  return applySpecs(session.userId, items);
}
