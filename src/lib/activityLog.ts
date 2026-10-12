import type { AuditCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { attributeAudit } from "@/lib/impersonation";

/**
 * 管理者以別人的身分操作時,紀錄要記真正動手的管理者並註記。不在請求裡(排程、MCP 之類
 * 沒有 cookie 可看)就照原樣——這裡不會丟例外,稽核紀錄不能因為這個壞掉。
 */
async function attributed(actorId: string | null, message: string) {
  try {
    return attributeAudit(await getSession(), actorId, message);
  } catch {
    return { actorId, message };
  }
}

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
  const entry = await attributed(actorId, message);
  await prisma.activityLogEntry.create({
    data: { itemId, boardId: item?.boardId ?? null, actorId: entry.actorId, message: entry.message, category: "ITEM" },
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
    const entry = await attributed(actorId, message);
    await prisma.activityLogEntry.create({
      data: { category, actorId: entry.actorId, message: entry.message, boardId: boardId ?? null },
    });
  } catch {
    // Deliberately swallowed — see above.
  }
}
