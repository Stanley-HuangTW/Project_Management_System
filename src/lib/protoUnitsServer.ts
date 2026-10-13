import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activityLog";
import { EMPTY_PROTO_SYNC, planProtoUnitSync, protoUnitLabel, type ProtoSyncSummary } from "@/lib/protoUnits";

/**
 * 讓「每一台樣機」(ProtoUnit)跟樣機計畫(ProtoPlan)一致:台數增加就補、減少就從最大的號碼開始拿掉、
 * 計畫上已經沒有的格子(列或產品被刪)底下的全部拿掉。每一個會寫 ProtoPlan 的地方,寫完都要呼叫一次。
 *
 * 不擋:樣機被拿掉時,參照它的工作項的「使用樣機」跟著刪除(資料庫連帶刪除),並在那些工作項的
 * 活動紀錄留一筆;被解除的清單回傳給呼叫端,由畫面事後告訴使用者。
 */
export async function syncProtoUnits(boardId: string, actorId: string): Promise<ProtoSyncSummary> {
  const [cells, existing, phases] = await Promise.all([
    prisma.protoPlan.findMany({ where: { boardId }, select: { product: true, unit: true, phaseId: true, qty: true } }),
    prisma.protoUnit.findMany({
      where: { boardId },
      select: {
        id: true,
        product: true,
        unit: true,
        phaseId: true,
        seq: true,
        items: { select: { item: { select: { id: true, name: true, deletedAt: true } } } },
      },
    }),
    prisma.budgetPhase.findMany({ where: { boardId }, select: { id: true, name: true } }),
  ]);

  const plan = planProtoUnitSync(cells, existing);
  if (plan.create.length === 0 && plan.remove.length === 0) return EMPTY_PROTO_SYNC;

  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const labelOf = (u: { product: string; unit: string; phaseId: string; seq: number }) =>
    protoUnitLabel(u, phaseName.get(u.phaseId) ?? "");

  // 拿掉之前先記下誰在用(拿掉之後連帶刪除就查不到了)。垃圾桶裡的工作項不算。
  const removedById = new Map(existing.filter((u) => plan.remove.some((r) => r.id === u.id)).map((u) => [u.id, u]));
  const clearedByItem = new Map<string, { itemId: string; itemName: string; labels: string[] }>();
  for (const unit of removedById.values()) {
    for (const { item } of unit.items) {
      if (item.deletedAt) continue;
      const entry = clearedByItem.get(item.id) ?? { itemId: item.id, itemName: item.name, labels: [] };
      entry.labels.push(labelOf(unit));
      clearedByItem.set(item.id, entry);
    }
  }

  await prisma.$transaction([
    prisma.protoUnit.deleteMany({ where: { id: { in: plan.remove.map((r) => r.id) } } }),
    prisma.protoUnit.createMany({ data: plan.create.map((c) => ({ boardId, ...c })), skipDuplicates: true }),
  ]);

  const cleared = [...clearedByItem.values()];
  for (const entry of cleared) {
    await logActivity(entry.itemId, actorId, `樣機計畫的台數減少,「使用樣機」已解除:${entry.labels.join("、")}`);
  }

  return {
    added: plan.create.length,
    removed: plan.remove.map((r) => ({ label: labelOf(removedById.get(r.id)!) })),
    cleared,
  };
}

/**
 * 表格「使用樣機」欄用的資料:這個看板所有可以選的樣機(產品 → 階段 → 用途 → 第幾台排好序),
 * 以及每個工作項目前用到哪幾台(只含看得到的工作項)。
 */
export async function loadProtoUnitsData(
  boardId: string,
  visibleItemIds: Set<string>
): Promise<{ options: ProtoUnitOptionData[]; byItem: Record<string, string[]> }> {
  const [units, phases, refs] = await Promise.all([
    prisma.protoUnit.findMany({ where: { boardId }, select: { id: true, product: true, unit: true, phaseId: true, seq: true } }),
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.itemProtoUnit.findMany({ where: { protoUnit: { boardId } }, select: { itemId: true, protoUnitId: true } }),
  ]);
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const options = units
    .map((u) => ({
      id: u.id,
      product: u.product,
      unit: u.unit,
      phaseId: u.phaseId,
      phaseName: phaseName.get(u.phaseId) ?? "",
      seq: u.seq,
      label: protoUnitLabel(u, phaseName.get(u.phaseId) ?? ""),
    }))
    .sort(
      (a, b) =>
        a.product.localeCompare(b.product) ||
        (phaseIndex.get(a.phaseId) ?? 0) - (phaseIndex.get(b.phaseId) ?? 0) ||
        a.unit.localeCompare(b.unit) ||
        a.seq - b.seq
    );
  const byItem: Record<string, string[]> = {};
  for (const r of refs) {
    if (!visibleItemIds.has(r.itemId)) continue;
    (byItem[r.itemId] ??= []).push(r.protoUnitId);
  }
  return { options, byItem };
}

export type ProtoUnitOptionData = {
  id: string;
  product: string;
  unit: string;
  phaseId: string;
  phaseName: string;
  seq: number;
  label: string;
};
