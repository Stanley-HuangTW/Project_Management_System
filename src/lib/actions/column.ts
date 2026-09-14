"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireStructureAccess } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";
import { requireBoardAccess } from "@/lib/boardAccess";
import type { ColumnType, StatusColumnOptions } from "@/types/column";
import { DEFAULT_STATUSES, getStatusOptions } from "@/types/column";

// The scheduling engine (predecessorLink.ts) only ever recognizes these 4
// labels as a valid Pred relationship — a Link column whose options were
// auto-populated from whatever values happened to appear during import can
// easily be missing one (e.g. a sheet that never used "SF"), silently
// making that relationship unselectable. Backfilled whenever a column is
// designated the board's Link column — see setLinkColumn.
const REQUIRED_LINK_OPTIONS: { label: string; color: string }[] = [
  { label: "FS", color: "#00c875" },
  { label: "FF", color: "#e2445c" },
  { label: "SS", color: "#a25ddc" },
  { label: "SF", color: "#579bfc" },
];

export async function createColumn(
  boardId: string,
  name: string,
  type: ColumnType
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("欄位名稱不可為空");

  const count = await prisma.column.count({ where: { boardId } });
  const options: StatusColumnOptions | Record<string, never> =
    type === "STATUS" ? { statuses: DEFAULT_STATUSES } : {};

  await prisma.column.create({
    data: { boardId, name: trimmed, type, order: count, options },
  });

  revalidatePath(`/boards/${boardId}`);
}

export async function renameColumn(
  boardId: string,
  columnId: string,
  name: string
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("欄位名稱不可為空");

  await prisma.column.update({
    where: { id: columnId },
    data: { name: trimmed },
  });
  revalidatePath(`/boards/${boardId}`);
}

export async function updateStatusOptions(
  boardId: string,
  columnId: string,
  statuses: StatusColumnOptions["statuses"]
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.column.update({
    where: { id: columnId },
    data: { options: { statuses } },
  });
  revalidatePath(`/boards/${boardId}`);
}

export async function reorderColumns(
  boardId: string,
  orderedColumnIds: string[]
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.$transaction(
    orderedColumnIds.map((id, index) =>
      prisma.column.update({ where: { id }, data: { order: index } })
    )
  );
  revalidatePath(`/boards/${boardId}`);
}

export async function deleteColumn(boardId: string, columnId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.column.delete({ where: { id: columnId } });
  revalidatePath(`/boards/${boardId}`);
}

/**
 * 記下一次欄位對應的改動。
 *
 * 這些設定決定了「哪一欄在驅動排程」——換掉 Pred 或 Start 欄位,整張甘特圖
 * 讀的就是另一組資料了,但畫面上只是一個下拉選單變了而已。
 */
async function logMapping(
  boardId: string,
  actorId: string,
  label: string,
  columnId: string | null
) {
  const column = columnId
    ? await prisma.column.findUnique({ where: { id: columnId }, select: { name: true } })
    : null;
  await logAudit("SETTINGS", actorId, `${label}欄位設為「${column?.name ?? "(未設定)"}」`, boardId);
}

export async function setProgressColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { progressColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "進度", columnId);
  revalidatePath(`/boards/${boardId}`);
}

export async function setGanttStartColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { ganttStartColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "甘特圖開始日期", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setGanttDurationColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { ganttDurationColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "甘特圖天數", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setGanttEndColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { ganttEndColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "甘特圖結束日期", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}


export async function setPredColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { predColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "前置(Pred)", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setLinkColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { linkColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "關聯(Link)", columnId);
  if (columnId) {
    const column = await prisma.column.findUnique({ where: { id: columnId }, select: { options: true } });
    const existing = getStatusOptions(column?.options);
    const missing = REQUIRED_LINK_OPTIONS.filter(
      (req) => !existing.some((o) => o.label === req.label)
    );
    if (missing.length > 0) {
      const updated = [...existing, ...missing.map((m) => ({ id: randomUUID().slice(0, 8), ...m }))];
      await prisma.column.update({
        where: { id: columnId },
        data: { options: { statuses: updated } },
      });
    }
  }
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setGanttLagColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { lagColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "延隔(Lag)", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setGanttTypeColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { typeColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "類型(Type)", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setManualStartColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { manualStartColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "手動開始日期", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setManualDurationColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: { manualDurationColumnId: columnId },
  });
  await logMapping(boardId, session.userId, "手動天數", columnId);
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/settings");
}

export async function setReportStatusColumn(
  boardId: string,
  columnId: string | null
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: {
      reportStatusColumnId: columnId,
      reportNotStartedOptionIds: [],
      reportPlannedOptionIds: [],
      reportPausedOptionIds: [],
      reportStuckOptionIds: [],
      reportDoneOptionIds: [],
    },
  });
  await logMapping(boardId, session.userId, "報表狀態", columnId);
  revalidatePath(`/boards/${boardId}`);
}

export async function setReportStatusBuckets(
  boardId: string,
  buckets: {
    notStartedOptionIds: string[];
    plannedOptionIds: string[];
    pausedOptionIds: string[];
    stuckOptionIds: string[];
    doneOptionIds: string[];
  }
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.board.update({
    where: { id: boardId },
    data: {
      reportNotStartedOptionIds: buckets.notStartedOptionIds,
      reportPlannedOptionIds: buckets.plannedOptionIds,
      reportPausedOptionIds: buckets.pausedOptionIds,
      reportStuckOptionIds: buckets.stuckOptionIds,
      reportDoneOptionIds: buckets.doneOptionIds,
    },
  });
  revalidatePath(`/boards/${boardId}`);
}

