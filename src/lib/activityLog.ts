import type { AuditCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";
import { attributeAudit } from "@/lib/impersonation";
import type { ItemEventKind, StatusKind } from "@/lib/itemEvents";

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

/** 活動紀錄的結構化資訊:什麼種類的事;狀態切換再加切到哪個選項、算進行中還是完成。沒給就當一般的欄位修改。 */
export type ActivityDetail = {
  kind: ItemEventKind;
  statusKind?: StatusKind;
  statusLabel?: string;
  /** 待辦事項的紀錄:對到哪一個待辦事項,以及它要不要彙整進週報(之後改旗標時,跟著這個 id 一起改)。 */
  todoItemId?: string;
  inWeeklyReport?: boolean;
};

/**
 * 工作項上的一筆活動紀錄.
 *
 * The board is looked up rather than passed, so every existing caller keeps
 * its two-argument shape — the audit page needs the board to filter on, and
 * making forty call sites carry it would be forty chances to pass the wrong
 * one.
 */
export async function logActivity(itemId: string, actorId: string | null, message: string, detail?: ActivityDetail) {
  const item = await prisma.item.findUnique({ where: { id: itemId }, select: { boardId: true } });
  const entry = await attributed(actorId, message);
  await prisma.activityLogEntry.create({
    data: {
      itemId,
      boardId: item?.boardId ?? null,
      actorId: entry.actorId,
      message: entry.message,
      category: "ITEM",
      eventKind: detail?.kind ?? "FIELD",
      statusKind: detail?.statusKind ?? null,
      statusLabel: detail?.statusLabel ?? null,
      todoItemId: detail?.todoItemId ?? null,
      inWeeklyReport: detail?.inWeeklyReport ?? true,
    },
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
