"use server";

import type { AuditCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { UserError } from "@/lib/userError";

export type AuditRow = {
  id: string;
  category: AuditCategory;
  actorName: string | null;
  message: string;
  boardName: string | null;
  createdAt: string;
};

export type AuditPage = {
  rows: AuditRow[];
  /** True when there are older entries than the page returned. */
  hasMore: boolean;
};

/**
 * 稽核軌跡.
 *
 * Admin-only, deliberately. The log names who changed whose rate and who made
 * whose work private; handing that to everyone would leak exactly the things
 * 可見範圍 exists to withhold.
 */
export async function listAuditLog(options: {
  category?: AuditCategory | "ALL";
  boardId?: string | null;
  actorId?: string | null;
  /** "YYYY-MM-DD", inclusive. */
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}): Promise<AuditPage> {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足:僅管理者可以檢視稽核軌跡");

  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  const rows = await prisma.activityLogEntry.findMany({
    where: {
      ...(options.category && options.category !== "ALL" ? { category: options.category } : {}),
      ...(options.boardId ? { boardId: options.boardId } : {}),
      ...(options.actorId ? { actorId: options.actorId } : {}),
      ...(options.from || options.to
        ? {
            createdAt: {
              ...(options.from ? { gte: new Date(`${options.from}T00:00:00.000Z`) } : {}),
              // Inclusive of the whole end day, not the instant it begins.
              ...(options.to ? { lt: new Date(`${options.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit + 1,
    include: {
      actor: { select: { name: true } },
      board: { select: { name: true } },
    },
  });

  const hasMore = rows.length > limit;
  return {
    hasMore,
    rows: rows.slice(0, limit).map((row) => ({
      id: row.id,
      category: row.category,
      actorName: row.actor?.name ?? null,
      message: row.message,
      boardName: row.board?.name ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export async function auditFilterOptions(): Promise<{
  boards: { id: string; name: string }[];
  actors: { id: string; name: string }[];
}> {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足");

  const [boards, actors] = await Promise.all([
    prisma.board.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return { boards, actors };
}
