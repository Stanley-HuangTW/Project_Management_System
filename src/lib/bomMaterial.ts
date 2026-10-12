import { prisma } from "@/lib/prisma";
import { bomMaterialBudget, summariseBom, type BomLineInput } from "@/lib/bom";

/**
 * 重算一個階段的材料預算:每個產品的單台 BOM 價 × 樣機計畫裡那個產品在
 * 這個階段要幾台,各產品分別算完再加總。
 *
 * 只要這個階段還有任何一筆 BOM,材料預算就整個由這裡驅動(即使算出來是
 * 0,也是「BOM 說目前是 0」而不是「還沒人設定」)——沒有 BOM 的階段完全
 * 不動,材料預算照舊是手動填的那一欄。跟人力規劃表驅動人力預算是同一個
 * 設計。
 */
export async function resyncBomMaterial(boardId: string, phaseId: string): Promise<void> {
  const bomLines = await prisma.bomLine.findMany({
    where: { boardId, phaseId },
    select: {
      product: true,
      parentId: true,
      name: true,
      vendor: true,
      partNumber: true,
      qty: true,
      unitPrice: true,
      currency: true,
      fxRate: true,
      note: true,
      deliveryDate: true,
      order: true,
      id: true,
    },
  });
  if (bomLines.length === 0) {
    // 這個階段現在完全沒有 BOM 了——可能是從沒有過,也可能是剛把最後一筆
    // 刪光。只清掉「由 BOM 表算出來」的那個殘值,不能不分青紅皂白刪
    // MATERIAL,不然會把使用者自己手動填的預算也一起沖掉。
    await prisma.budget.deleteMany({
      where: { phaseId, category: "MATERIAL", note: "由 BOM 表計算" },
    });
    return;
  }

  const byProduct = new Map<string, BomLineInput[]>();
  for (const line of bomLines) {
    const list = byProduct.get(line.product) ?? [];
    list.push({
      id: line.id,
      parentId: line.parentId,
      name: line.name,
      vendor: line.vendor,
      partNumber: line.partNumber,
      qty: Number(line.qty),
      unitPrice: Number(line.unitPrice),
      currency: line.currency,
      fxRate: Number(line.fxRate),
      note: line.note,
      deliveryDate: line.deliveryDate,
      order: line.order,
    });
    byProduct.set(line.product, list);
  }

  const qtyRows = await prisma.protoPlan.groupBy({
    by: ["product"],
    where: { boardId, phaseId, product: { in: [...byProduct.keys()] } },
    _sum: { qty: true },
  });
  const qtyByProduct = new Map(qtyRows.map((r) => [r.product, r._sum.qty ?? 0]));

  const perProduct = [...byProduct.entries()].map(([product, lines]) => ({
    product,
    unitCostTwd: summariseBom(lines).unitCostTwd,
    qty: qtyByProduct.get(product) ?? 0,
  }));
  const amount = bomMaterialBudget(perProduct);

  // 算出來跟存的一樣就不寫:看預算時每次都會對一次(refreshBomMaterial),不要每次看都改一次資料。
  const stored = await prisma.budget.findUnique({
    where: { phaseId_category: { phaseId, category: "MATERIAL" } },
    select: { amount: true, note: true },
  });
  if (amount > 0) {
    if (stored?.amount === amount && stored.note === "由 BOM 表計算") return;
    await prisma.budget.upsert({
      where: { phaseId_category: { phaseId, category: "MATERIAL" } },
      create: { phaseId, category: "MATERIAL", amount, note: "由 BOM 表計算" },
      update: { amount, note: "由 BOM 表計算" },
    });
  } else if (stored) {
    await prisma.budget.deleteMany({ where: { phaseId, category: "MATERIAL" } });
  }
}

/**
 * 看預算之前,把這幾個階段的材料預算跟 BOM × 樣機計畫對一次——有 BOM 的階段才算。
 *
 * 材料預算是存起來的一個數字,靠每次改 BOM 或台數時重算寫進去;只要有哪一次沒走到那條路(舊資料、
 * 還沒有這個功能之前填的、從備份還原、直接動資料庫),畫面就會寫著「由樣機 BOM 計算」卻是「—」,
 * 而且連手動填的入口都被收起來了。所以讀的時候順手對一次,不一樣才寫。
 */
export async function refreshBomMaterial(phases: { id: string; boardId: string }[]): Promise<void> {
  for (const { id, boardId } of phases) {
    if ((await prisma.bomLine.count({ where: { phaseId: id } })) === 0) continue;
    await resyncBomMaterial(boardId, id);
  }
}
