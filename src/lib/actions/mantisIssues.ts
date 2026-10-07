"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import type { MantisIssueRow } from "@/lib/mantisIssues";

export type BoardMantisInfo = {
  baseUrl: string;
  projectName: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncError: string | null;
};

const PREVIEW_LENGTH = 400;

/** 看板「問題」分頁:這個看板同步下來的 Mantis 問題,與連線的狀態。看得到看板的人都看得到(唯讀)。 */
export async function listBoardMantisIssues(
  boardId: string
): Promise<{ connection: BoardMantisInfo | null; issues: MantisIssueRow[] }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [connection, risks] = await Promise.all([
    prisma.mantisConnection.findUnique({ where: { boardId } }),
    prisma.riskEntry.findMany({
      where: { boardId, mantisId: { not: null } },
      include: { owner: { select: { name: true } } },
    }),
  ]);

  return {
    connection: connection
      ? {
          baseUrl: connection.baseUrl,
          projectName: connection.projectName,
          enabled: connection.enabled,
          lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
          lastSyncError: connection.lastSyncError,
        }
      : null,
    issues: risks.map((r) => ({
      riskId: r.id,
      mantisId: r.mantisId!,
      url: r.mantisUrl,
      title: r.title,
      status: r.status,
      mantisStatus: r.mantisStatus,
      severity: r.mantisSeverity,
      priority: r.mantisPriority,
      category: r.mantisCategory,
      reporter: r.mantisReporter,
      handlerName: r.mantisHandler,
      ownerId: r.ownerId,
      ownerName: r.owner?.name ?? null,
      dueDate: r.dueDate,
      descriptionPreview: (r.description ?? "").slice(0, PREVIEW_LENGTH),
      impact: r.impact,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.mantisUpdatedAt?.toISOString() ?? null,
    })),
  };
}
