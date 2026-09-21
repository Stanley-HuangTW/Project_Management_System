/**
 * 樣機 BOM 的加總。
 *
 * 一列可以是零件,也可以是子集(電池模組、主機板)。零件自己有單價;子集
 * 沒有,它的價錢是底下那些零件加起來的 —— 兩邊都填就會有一個永遠對不起來
 * 的數字,而且沒人知道該信哪一個。
 *
 * 往上加的是「小計」而不是「單價」:一個子集在上一層要用兩組,它的小計
 * 是「一組的內容 × 2」。所以每一層的乘法都只做一次,不會在遞迴裡重複乘。
 *
 * 不碰資料庫、不碰 DOM,所以整棵樹的算法測得到。
 */

export type BomLineInput = {
  id: string;
  parentId: string | null;
  name: string;
  vendor: string;
  partNumber: string;
  /** 上一層要用幾個。最上層就是一台裝置要幾個。 */
  qty: number;
  /** 幣別上的單價。有子項目時這個值不算數。 */
  unitPrice: number;
  currency: string;
  /** 換算台幣的匯率,凍結在填的當下。 */
  fxRate: number;
  note: string;
  order: number;
};

export type BomNode = BomLineInput & {
  /** 0 = 最上層。 */
  depth: number;
  children: BomNode[];
  /** 一個(這一列自己)換算成台幣要多少。子集 = 底下小計加起來。 */
  unitCostTwd: number;
  /** unitCostTwd × qty —— 這一列對上一層的貢獻。 */
  extendedTwd: number;
  /** 有沒有子項目。有的話單價是算出來的,不是填的。 */
  isAssembly: boolean;
};

export type BomSummary = {
  nodes: BomNode[];
  /** 一台裝置多少錢(台幣),最上層每一列的小計加起來。 */
  unitCostTwd: number;
  /** 幾列(含子集)。 */
  lineCount: number;
  /** 出現過的外幣,給畫面提示用 —— 台幣不列。 */
  foreignCurrencies: string[];
  /** 掛在不存在的上層、或自己繞成一圈的列。算不進總價,但要說出來。 */
  orphanIds: string[];
};

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * 把一張平的清單長成樹,順便把每一層的小計算出來。
 *
 * 掛在不存在的上層、或 parent 兜成一圈的列會被挑出來放進 orphanIds:
 * 靜靜地把它們當最上層的話,單台價格會突然多出一筆沒人看得懂的錢。
 */
export function summariseBom(lines: BomLineInput[]): BomSummary {
  const byId = new Map(lines.map((l) => [l.id, l]));

  // 先找出走得到根的那些列。繞圈的(A 的上層是 B,B 的上層是 A)一路往上
  // 走不到 null,就是孤兒。
  const rooted = new Set<string>();
  const orphanIds: string[] = [];
  for (const line of lines) {
    const seen = new Set<string>([line.id]);
    let cursor: string | null = line.parentId;
    let ok = true;
    while (cursor !== null) {
      if (seen.has(cursor) || !byId.has(cursor)) {
        ok = false;
        break;
      }
      seen.add(cursor);
      cursor = byId.get(cursor)!.parentId;
    }
    if (ok) rooted.add(line.id);
    else orphanIds.push(line.id);
  }

  const childrenOf = new Map<string | null, BomLineInput[]>();
  for (const line of lines) {
    if (!rooted.has(line.id)) continue;
    const key = line.parentId;
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), line]);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);

  let lineCount = 0;
  const currencies = new Set<string>();

  const build = (line: BomLineInput, depth: number): BomNode => {
    lineCount++;
    const kids = (childrenOf.get(line.id) ?? []).map((c) => build(c, depth + 1));
    const isAssembly = kids.length > 0;
    // 子集的單價是底下小計加起來;零件的是自己的單價換成台幣。
    const unitCostTwd = isAssembly
      ? round(
          kids.reduce((t, k) => t + k.extendedTwd, 0),
          4
        )
      : round(line.unitPrice * line.fxRate, 4);
    if (!isAssembly && line.currency !== "TWD") currencies.add(line.currency);

    return {
      ...line,
      depth,
      children: kids,
      isAssembly,
      unitCostTwd,
      extendedTwd: round(unitCostTwd * line.qty, 4),
    };
  };

  const nodes = (childrenOf.get(null) ?? []).map((l) => build(l, 0));

  return {
    nodes,
    unitCostTwd: round(
      nodes.reduce((t, n) => t + n.extendedTwd, 0),
      2
    ),
    lineCount,
    foreignCurrencies: [...currencies].sort(),
    orphanIds,
  };
}

/** 樹攤平成一列一列,照顯示順序 —— 表格要的是這個。 */
export function flattenBom(nodes: BomNode[]): BomNode[] {
  const out: BomNode[] = [];
  const walk = (list: BomNode[]) => {
    for (const node of list) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * 這個階段的材料預算:每個產品的單台價 × 那個階段要幾台,全部加起來。
 *
 * 台數來自樣機計畫。同一個階段可能同時排 M3 與充電站兩套,兩邊的料不一樣、
 * 台數也不一樣,所以要逐個產品算完再加,不能拿平均。
 */
export function bomMaterialBudget(
  perProduct: { product: string; unitCostTwd: number; qty: number }[]
): number {
  return Math.round(perProduct.reduce((t, p) => t + p.unitCostTwd * p.qty, 0));
}
