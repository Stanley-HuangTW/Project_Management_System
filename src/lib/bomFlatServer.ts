import { prisma } from "@/lib/prisma";
import { flattenBom, summariseBom } from "@/lib/bom";
import type { FlatBomLine } from "@/lib/bomLevel";

/**
 * 改 BOM 的階層、搬動、複製要用的:把某一份 BOM(某個產品、某個階段)載成「畫面上看到的順序」的平的清單,
 * 還有「單價不再算 / 改算自己的單價」的提醒。有碰資料庫,所以不放在純邏輯的 bomLevel.ts / bomBulk.ts 裡。
 * (不是 "use server" 檔,才能匯出同步的函式。)
 */

export type FlatBomRow = { id: string; parentId: string | null; name: string; order: number; unitPrice: unknown; currency: string };

export async function loadFlatBom(
  boardId: string,
  product: string,
  phaseId: string
): Promise<{ rows: FlatBomRow[]; flat: FlatBomLine[] }> {
  const rows = await prisma.bomLine.findMany({
    where: { boardId, product, phaseId },
    orderBy: { order: "asc" },
    select: { id: true, parentId: true, name: true, order: true, unitPrice: true, currency: true },
  });
  // 用畫面一樣的算法排出「看到的順序」(先序走訪),階層是從樹算出來的深度。
  const summary = summariseBom(
    rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      vendor: "",
      partNumber: "",
      qty: 1,
      unitPrice: 0,
      currency: "TWD",
      fxRate: 1,
      note: "",
      deliveryDate: null,
      order: r.order,
    }))
  );
  const flat = flattenBom(summary.nodes).map((n) => ({ id: n.id, parentId: n.parentId, depth: n.depth, order: n.order }));
  return { rows, flat };
}

/**
 * 一列有了子項目,它自己填的單價就不再算(改算底下的加總);失去全部子項目則反過來。
 * 改完之後回一段說明給畫面提醒,不然總價會無聲無息地變。
 * parentAfter:這份 BOM 裡每一列(包含剛放進來的新列)改完之後的上層;不在裡面的既有列表示已經離開這份 BOM。
 */
export function priceNotices(rows: FlatBomRow[], parentAfter: Map<string, string | null>): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parentsBefore = new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])));
  const parentsAfter = new Set([...parentAfter.values()].flatMap((p) => (p ? [p] : [])));
  const priceText = (id: string) => `${Number(byId.get(id)!.unitPrice)} ${byId.get(id)!.currency}`;
  const notes: string[] = [];
  for (const id of parentsAfter) {
    const row = byId.get(id);
    if (row && !parentsBefore.has(id) && Number(row.unitPrice) > 0) {
      notes.push(`「${row.name}」現在有子項目了,它自己填的單價(${priceText(id)})不再計算,改算底下子項目的加總。`);
    }
  }
  for (const id of parentsBefore) {
    if (!parentsAfter.has(id) && parentAfter.has(id) && byId.has(id)) {
      notes.push(`「${byId.get(id)!.name}」沒有子項目了,改算它自己填的單價(${priceText(id)})。`);
    }
  }
  return notes.slice(0, 5);
}
