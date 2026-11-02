import { prisma } from "@/lib/prisma";
import type { BoardWithData } from "@/types/board";
import { computeProtoUsage, EMPTY_PROTO_USAGE, type ProtoUsage } from "@/lib/protoUsage";
import type { WeekColumn } from "@/lib/workload";

/**
 * 儀表板的樣機使用時程:這些看板上,每一台有工作項在用的樣機,以及用它的工作項;沒人在用的另外列成閒置。
 * boards 要是已經套過可見範圍的(看不到的工作項不在 items 裡,自然不會列出來)。
 */
export async function loadProtoUsage(boards: BoardWithData[], weeks: WeekColumn[], holidays: Set<string>): Promise<ProtoUsage> {
  if (boards.length === 0) return EMPTY_PROTO_USAGE;
  const itemIds = boards.flatMap((b) => b.items.map((i) => i.id));

  const [units, rows, phases] = await Promise.all([
    prisma.protoUnit.findMany({
      where: { boardId: { in: boards.map((b) => b.id) } },
      select: { id: true, boardId: true, product: true, unit: true, phaseId: true, seq: true },
    }),
    itemIds.length === 0
      ? Promise.resolve([])
      : prisma.itemProtoUnit.findMany({ where: { itemId: { in: itemIds } }, select: { itemId: true, protoUnitId: true, usagePct: true } }),
    prisma.budgetPhase.findMany({
      where: { boardId: { in: boards.map((b) => b.id) } },
      select: { id: true, name: true, order: true },
    }),
  ]);
  if (units.length === 0) return EMPTY_PROTO_USAGE;

  return computeProtoUsage(
    boards,
    units,
    phases,
    rows.map((r) => ({ itemId: r.itemId, protoUnitId: r.protoUnitId, usagePct: r.usagePct })),
    weeks,
    holidays
  );
}
