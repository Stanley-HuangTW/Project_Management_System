import type { AuditCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * 工作項上的一筆活動紀錄.
 *
 * The board is looked up rather than passed, so every existing caller keeps
 * its two-argument shape — the audit page needs the board to filter on, and
 * making forty call sites carry it would be forty chances to pass the wrong
 * one.
 */
export async function logActivity(itemId: string, actorId: string | null, message: string) {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  await prisma.activityLogEntry.create({
    data: { itemId, boardId: item?.boardId ?? null, actorId, message, category: "ITEM" },
  });
}

/**
 * 板級或系統級的一筆稽核紀錄.
 *
 * These are the ones that were missing: who changed somebody's rate, who
 * switched the baseline the whole project is measured against, who made a
 * project private, who deleted a board. All of them move money or commitments,
 * and none of them left a trace.
 *
 * Logging never fails the operation it is recording — an audit write that
 * throws would roll back a change the user was entitled to make, which is a
 * worse outcome than a missing line.
 */
export async function logAudit(
  category: AuditCategory,
  actorId: string | null,
  message: string,
  boardId?: string | null
) {
  try {
    await prisma.activityLogEntry.create({
      data: { category, actorId, message, boardId: boardId ?? null },
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}
