import { prisma } from "@/lib/prisma";
import { taipeiDateOf } from "@/lib/itemEvents";
import { toOpenRiskRows, type OpenRiskRow } from "@/lib/dashboardRisks";

const MAX_ROWS = 500;

/**
 * 儀表板「未結案的風險與問題」要列的:這幾個看板(儀表板上目前看的那幾個,都是這個人看得到的)裡
 * 還沒結案的風險與問題(含 Mantis 同步來的)。風險登記冊本來就是看板成員都看得到,這裡沒有另外的可見範圍。
 */
export async function loadOpenRiskRows(boards: { id: string; name: string }[]): Promise<OpenRiskRow[]> {
  if (boards.length === 0) return [];
  const entries = await prisma.riskEntry.findMany({
    where: { boardId: { in: boards.map((b) => b.id) }, status: { not: "CLOSED" } },
    select: {
      id: true,
      boardId: true,
      kind: true,
      status: true,
      title: true,
      probability: true,
      impact: true,
      ownerId: true,
      owner: { select: { name: true } },
      dueDate: true,
      mantisId: true,
      mantisUrl: true,
      createdAt: true,
      reviewers: { select: { userId: true, approvedAt: true } },
    },
    take: MAX_ROWS,
  });
  return toOpenRiskRows(
    entries.map((e) => ({
      id: e.id,
      boardId: e.boardId,
      kind: e.kind,
      status: e.status,
      title: e.title,
      probability: e.probability,
      impact: e.impact,
      ownerId: e.ownerId,
      ownerName: e.owner?.name ?? null,
      dueDate: e.dueDate,
      mantisId: e.mantisId,
      mantisUrl: e.mantisUrl,
      createdAt: e.createdAt.toISOString(),
      // 申請結案之後還沒同意的審核人(只有「待審核」那一輪才有意義)。
      pendingReviewerIds: e.status === "PENDING_REVIEW" ? e.reviewers.filter((r) => !r.approvedAt).map((r) => r.userId) : [],
    })),
    new Map(boards.map((b) => [b.id, b.name])),
    taipeiDateOf(new Date().toISOString())
  );
}
