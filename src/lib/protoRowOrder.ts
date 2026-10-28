/** 某個產品底下某個用途單位那一列,在表上排第幾(拖曳排過才有)。 */
export type ProtoRowOrderRecord = { product: string; unit: string; order: number };

const rowKey = (product: string, unit: string) => JSON.stringify([product, unit]);

/**
 * 樣機計畫表上列的順序。cells 照建立先後給進來:產品照第一次出現的順序;
 * 同一個產品裡,拖曳排過的列照排好的順序放前面,還沒排過的(之後才新增、匯入的)接在後面,維持建立先後。
 * 回傳重排後的 cells,summariseProtoPlan 照這個順序收成表格。
 */
export function orderProtoCells<T extends { product: string; unit: string }>(cells: T[], orders: ProtoRowOrderRecord[]): T[] {
  const productFirst = new Map<string, number>();
  const rowFirst = new Map<string, number>();
  cells.forEach((cell, i) => {
    if (!productFirst.has(cell.product)) productFirst.set(cell.product, i);
    const key = rowKey(cell.product, cell.unit);
    if (!rowFirst.has(key)) rowFirst.set(key, i);
  });
  const orderOf = new Map(orders.map((o) => [rowKey(o.product, o.unit), o.order]));

  return cells
    .map((cell, i) => ({ cell, i }))
    .sort((a, b) => {
      const byProduct = productFirst.get(a.cell.product)! - productFirst.get(b.cell.product)!;
      if (byProduct !== 0) return byProduct;
      const keyA = rowKey(a.cell.product, a.cell.unit);
      const keyB = rowKey(b.cell.product, b.cell.unit);
      if (keyA !== keyB) {
        const orderA = orderOf.get(keyA);
        const orderB = orderOf.get(keyB);
        if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
        if (orderA !== undefined) return -1;
        if (orderB !== undefined) return 1;
        return rowFirst.get(keyA)! - rowFirst.get(keyB)!;
      }
      return a.i - b.i;
    })
    .map((x) => x.cell);
}
