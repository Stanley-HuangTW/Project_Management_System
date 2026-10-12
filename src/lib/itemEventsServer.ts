import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ItemEventKind, ItemEventSummary } from "@/lib/itemEvents";

type LastRow = { itemId: string; eventKind: string; createdAt: Date; message: string; actorId: string | null };
type StatusRow = { itemId: string; statusKind: string; createdAt: Date };

/**
 * 這幾塊看板上每個工作項的事件摘要:最近一次切成進行中、切成完成的時間,以及最近一筆更新或變化。
 *
 * 每個項目只取最近的一筆(DISTINCT ON),不是把整份活動紀錄拉出來再挑。visibleItemIds 一定要給——
 * 只回傳這個人看得到的工作項,私人項目的動態不會被帶到畫面上。
 */
export async function loadItemEventSummaries(
  boardIds: string[],
  visibleItemIds: Set<string>
): Promise<Record<string, ItemEventSummary>> {
  if (boardIds.length === 0 || visibleItemIds.size === 0) return {};

  const [lastRows, statusRows] = await Promise.all([
    prisma.$queryRaw<LastRow[]>(Prisma.sql`
      SELECT DISTINCT ON ("itemId") "itemId", "eventKind", "createdAt", "message", "actorId"
      FROM "ActivityLogEntry"
      WHERE "boardId" = ANY(${boardIds}) AND "itemId" IS NOT NULL AND "eventKind" IS NOT NULL
      ORDER BY "itemId", "createdAt" DESC`),
    prisma.$queryRaw<StatusRow[]>(Prisma.sql`
      SELECT DISTINCT ON ("itemId", "statusKind") "itemId", "statusKind", "createdAt"
      FROM "ActivityLogEntry"
      WHERE "boardId" = ANY(${boardIds}) AND "eventKind" = 'STATUS' AND "statusKind" IN ('done', 'inProgress')
      ORDER BY "itemId", "statusKind", "createdAt" DESC`),
  ]);

  const actorIds = [...new Set(lastRows.filter((r) => visibleItemIds.has(r.itemId)).map((r) => r.actorId).filter((id): id is string => !!id))];
  const actors = actorIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  const out: Record<string, ItemEventSummary> = {};
  const entry = (itemId: string): ItemEventSummary => (out[itemId] ??= { startedAt: null, completedAt: null, last: null });
  for (const r of lastRows) {
    if (!visibleItemIds.has(r.itemId)) continue;
    entry(r.itemId).last = {
      kind: r.eventKind as ItemEventKind,
      at: r.createdAt.toISOString(),
      actorName: r.actorId ? (actorName.get(r.actorId) ?? null) : null,
      summary: r.message,
    };
  }
  for (const r of statusRows) {
    if (!visibleItemIds.has(r.itemId)) continue;
    const e = entry(r.itemId);
    if (r.statusKind === "done") e.completedAt = r.createdAt.toISOString();
    else e.startedAt = r.createdAt.toISOString();
  }
  return out;
}
