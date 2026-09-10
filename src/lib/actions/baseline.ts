"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { requireStructureAccess } from "@/lib/permissions";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";

/**
 * Saves every item's current Start/Finish/Days as the plan this board is
 * measured against from now on.
 *
 * Scheduling never touches these again — that is the point: the plan has to
 * stay still while the real dates move, or "how late are we?" has no answer.
 *
 * Re-capturing replaces the *active* plan but keeps the old one: every
 * capture is archived as a Baseline, so "跟三月那版比" stays answerable.
 * The item fields remain the active copy, which is what every existing
 * reader looks at.
 *
 * Items with no resolvable dates are cleared rather than left holding a stale
 * baseline from an earlier capture.
 */
export async function captureBaseline(boardId: string, name?: string): Promise<number> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ganttStartColumnId: true, ganttDurationColumnId: true, ganttDurationMode: true },
  });
  if (!board?.ganttStartColumnId || !board.ganttDurationColumnId) {
    throw new Error("此看板尚未設定甘特圖「開始日期」與「天數」欄位,無法建立基準線");
  }

  const [items, holidayRows] = await Promise.all([
    prisma.item.findMany({ where: { boardId, deletedAt: null }, select: { id: true, cellValues: true } }),
    listHolidays(),
  ]);
  const holidays = toHolidaySet(holidayRows);

  let captured = 0;
  const writes = items.map((item) => {
    const range = getItemDateRange(
      item,
      board.ganttStartColumnId!,
      board.ganttDurationColumnId!,
      board.ganttDurationMode,
      holidays
    );
    const daysValue = item.cellValues.find(
      (cv) => cv.columnId === board.ganttDurationColumnId
    )?.value;
    if (range) captured++;
    return prisma.item.update({
      where: { id: item.id },
      data: {
        baselineStart: range ? range.start.toISOString().slice(0, 10) : null,
        baselineEnd: range ? range.end.toISOString().slice(0, 10) : null,
        baselineDays: range && typeof daysValue === "number" ? Math.round(daysValue) : null,
      },
    });
  });

  const capturedAt = new Date();
  await prisma.$transaction([
    ...writes,
    prisma.board.update({ where: { id: boardId }, data: { baselineCapturedAt: capturedAt } }),
  ]);

  // Archived after the item writes so the snapshot is exactly what the
  // board now holds, not what it held a moment before.
  const snapshot = await prisma.item.findMany({
    where: { boardId, deletedAt: null, baselineStart: { not: null } },
    select: { id: true, baselineStart: true, baselineEnd: true, baselineDays: true },
  });
  await prisma.baseline.create({
    data: {
      boardId,
      name: name?.trim() || capturedAt.toISOString().slice(0, 16).replace("T", " "),
      capturedAt,
      capturedById: session.userId,
      itemCount: captured,
      entries: {
        create: snapshot.map((item) => ({
          itemId: item.id,
          start: item.baselineStart,
          end: item.baselineEnd,
          days: item.baselineDays,
        })),
      },
    },
  });

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
  return captured;
}

export type BaselineVersion = {
  id: string;
  name: string;
  capturedAt: string;
  capturedBy: string | null;
  itemCount: number;
  /** True for the version the board is currently measured against. */
  isActive: boolean;
};

/** Every saved plan on this board, newest first. */
export async function listBaselines(boardId: string): Promise<BaselineVersion[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [baselines, board, users] = await Promise.all([
    prisma.baseline.findMany({ where: { boardId }, orderBy: { capturedAt: "desc" } }),
    prisma.board.findUnique({ where: { id: boardId }, select: { baselineCapturedAt: true } }),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  const activeAt = board?.baselineCapturedAt?.getTime();

  return baselines.map((baseline) => ({
    id: baseline.id,
    name: baseline.name,
    capturedAt: baseline.capturedAt.toISOString(),
    capturedBy: baseline.capturedById ? (nameById.get(baseline.capturedById) ?? null) : null,
    itemCount: baseline.itemCount,
    // The active plan is the one whose capture time the board recorded —
    // there is no separate pointer to drift out of step with the item fields.
    isActive: activeAt !== undefined && baseline.capturedAt.getTime() === activeAt,
  }));
}

/**
 * Makes an archived plan the active one again: its entries are copied back
 * onto the items, and every comparison on the board switches to it.
 *
 * Items the archived plan never covered are cleared rather than left holding
 * a date from a different plan — a baseline is one plan, not a merge of
 * whichever ones happened to touch each row.
 */
export async function activateBaseline(baselineId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const baseline = await prisma.baseline.findUnique({
    where: { id: baselineId },
    include: { entries: true },
  });
  if (!baseline) return { error: "找不到這個基準線" };
  await requireBoardAccess(baseline.boardId, session);
  requireStructureAccess(session.role);

  const byItem = new Map(baseline.entries.map((e) => [e.itemId, e]));
  const items = await prisma.item.findMany({
    where: { boardId: baseline.boardId },
    select: { id: true },
  });

  await prisma.$transaction([
    ...items.map((item) => {
      const entry = byItem.get(item.id);
      return prisma.item.update({
        where: { id: item.id },
        data: {
          baselineStart: entry?.start ?? null,
          baselineEnd: entry?.end ?? null,
          baselineDays: entry?.days ?? null,
        },
      });
    }),
    prisma.board.update({
      where: { id: baseline.boardId },
      data: { baselineCapturedAt: baseline.capturedAt },
    }),
  ]);

  revalidatePath(`/boards/${baseline.boardId}`);
  revalidatePath("/settings");
  return {};
}

export async function renameBaseline(baselineId: string, name: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const baseline = await prisma.baseline.findUnique({ where: { id: baselineId }, select: { boardId: true } });
  if (!baseline) return { error: "找不到這個基準線" };
  await requireBoardAccess(baseline.boardId, session);
  requireStructureAccess(session.role);
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入名稱" };

  await prisma.baseline.update({ where: { id: baselineId }, data: { name: trimmed } });
  revalidatePath("/settings");
  return {};
}

/** Deletes one archived plan. The active one cannot be deleted from here —
 *  清除 is what removes the plan a board is being measured against, and it
 *  says so. */
export async function deleteBaseline(baselineId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const baseline = await prisma.baseline.findUnique({
    where: { id: baselineId },
    select: { boardId: true, capturedAt: true },
  });
  if (!baseline) return { error: "找不到這個基準線" };
  await requireBoardAccess(baseline.boardId, session);
  requireStructureAccess(session.role);

  const board = await prisma.board.findUnique({
    where: { id: baseline.boardId },
    select: { baselineCapturedAt: true },
  });
  if (board?.baselineCapturedAt?.getTime() === baseline.capturedAt.getTime()) {
    return { error: "這是目前套用中的基準線,請先套用別的版本,或用「清除」移除它" };
  }

  await prisma.baseline.delete({ where: { id: baselineId } });
  revalidatePath("/settings");
  return {};
}

/** Drops the saved plan entirely — every comparison stops showing. */
export async function clearBaseline(boardId: string): Promise<void> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);

  await prisma.$transaction([
    prisma.item.updateMany({
      where: { boardId },
      data: { baselineStart: null, baselineEnd: null, baselineDays: null },
    }),
    prisma.board.update({ where: { id: boardId }, data: { baselineCapturedAt: null } }),
  ]);

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}
