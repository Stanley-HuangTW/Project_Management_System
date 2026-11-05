/**
 * 兩份 BOM 的差異(例如 EVT 到 DVT 增減了哪些料、改了價、換了廠商)。純函式,不碰資料庫與畫面。
 *
 * BOM 的列在複製時會換新的 id,沒有「這一列是從那一列來的」這種紀錄,所以只能靠內容對:
 *   1. 先用「型號/料號」對——料號是零件的身分,同一顆料搬到別的子集底下也認得出來(算「移動」);
 *      同一個料號出現好幾列的話,照樹的順序一對一對。
 *   2. 剩下的,在「已經對上的上層」底下用「名稱」對——換料(料號變了、名字沒變)就算同一列、改了料號;
 *      最上層則是跟最上層對。
 *   3. 都對不上的:只在基準裡 = 移除,只在對象裡 = 新增。
 * 對上的一對再逐欄比:名稱、廠商、型號/料號、數量、單價(含幣別)、匯率、交期、備註與自訂欄位,
 * 還有上層(移動)與類型(零件 ↔ 子集)。只比畫面上看得到的欄位(隱藏的欄位不比)、不比檔案附件。
 *
 * 子集自己的單價是底下加起來的,所以兩邊都是子集時不比它的單價;它的「小計」變了,
 * 就是底下有變動的結果,這一列只當上下文列出來(status = same,dirty = true)。
 */
import { flattenBom, type BomNode } from "@/lib/bom";
import { BUILT_IN_FIELD, isBuiltInColumn, isMoneyBlock, isStoredCustomColumn, type BomColumnDef } from "@/lib/bomColumns";

export type FieldChange = { label: string; before: string; after: string };

/** 一列的狀態怎麼稱呼。「沒變」但底下有變動的列(dirty)寫「子項有變動」,完全沒變的寫「沒變」。 */
export const DIFF_STATUS_LABELS = { added: "新增", removed: "移除", changed: "修改", same: "子項有變動" } as const;

export const diffStatusLabel = (row: Pick<BomDiffRow, "status" | "dirty">): string =>
  row.status === "same" && !row.dirty ? "沒變" : DIFF_STATUS_LABELS[row.status];

export type BomDiffRow = {
  /** 這一列在差異表裡的唯一代號。 */
  key: string;
  /** 在差異表裡的縮排(對象那份的樹為準;只在基準裡的列,掛在它原本的上層底下)。 */
  depth: number;
  status: "added" | "removed" | "changed" | "same";
  /** 對象裡的名稱;移除的列是基準裡的名稱。 */
  name: string;
  partNumber: string;
  changes: FieldChange[];
  /** 這一列(含底下的子項目)在基準 / 對象裡的小計(台幣)。新增沒有基準、移除沒有對象。 */
  beforeTotalTwd: number | null;
  afterTotalTwd: number | null;
  /** 這一列自己或底下有任何變動。「沒變」的列只有它是 true 才需要出現在「只看有變動的」裡。 */
  dirty: boolean;
};

export type BomDiff = {
  rows: BomDiffRow[];
  baseUnitCostTwd: number;
  targetUnitCostTwd: number;
  counts: { added: number; removed: number; changed: number; same: number };
};

type Merged = {
  base?: BomNode;
  target?: BomNode;
  parent: Merged | null;
  children: Merged[];
};

const norm = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();

const numberText = (n: number): string => String(Math.round(n * 10000) / 10000);

const sameNumber = (a: number, b: number): boolean => Math.round(a * 10000) === Math.round(b * 10000);

/** 兩份樹裡哪一列對哪一列。 */
function matchNodes(baseRoots: BomNode[], targetRoots: BomNode[]): { toTarget: Map<string, BomNode>; toBase: Map<string, BomNode> } {
  const toTarget = new Map<string, BomNode>();
  const toBase = new Map<string, BomNode>();
  const pair = (b: BomNode, t: BomNode) => {
    toTarget.set(b.id, t);
    toBase.set(t.id, b);
  };

  // 1. 料號。
  const targetsByPart = new Map<string, BomNode[]>();
  for (const t of flattenBom(targetRoots)) {
    const key = norm(t.partNumber);
    if (key) targetsByPart.set(key, [...(targetsByPart.get(key) ?? []), t]);
  }
  const takenIndex = new Map<string, number>();
  for (const b of flattenBom(baseRoots)) {
    const key = norm(b.partNumber);
    if (!key) continue;
    const list = targetsByPart.get(key);
    const at = takenIndex.get(key) ?? 0;
    if (!list || at >= list.length) continue;
    takenIndex.set(key, at + 1);
    pair(b, list[at]);
  }

  // 2. 名稱:在已經對上的上層底下,一層一層往下。
  const queue: { b: BomNode | null; t: BomNode | null }[] = [{ b: null, t: null }];
  for (const b of flattenBom(baseRoots)) {
    const t = toTarget.get(b.id);
    if (t) queue.push({ b, t });
  }
  while (queue.length > 0) {
    const { b, t } = queue.shift()!;
    const baseKids = (b ? b.children : baseRoots).filter((k) => !toTarget.has(k.id));
    const targetKids = (t ? t.children : targetRoots).filter((k) => !toBase.has(k.id));
    if (baseKids.length === 0 || targetKids.length === 0) continue;
    const used = new Set<string>();
    for (const bk of baseKids) {
      const key = norm(bk.name);
      const tk = targetKids.find((k) => !used.has(k.id) && norm(k.name) === key);
      if (!tk) continue;
      used.add(tk.id);
      pair(bk, tk);
      queue.push({ b: bk, t: tk });
    }
  }
  return { toTarget, toBase };
}

/** 兩邊都有的一列,逐欄比。順序照表格的欄位順序。 */
function diffFields(
  b: BomNode,
  t: BomNode,
  columns: BomColumnDef[],
  userName: (id: string) => string,
  parentName: { before: string; after: string; moved: boolean }
): FieldChange[] {
  const changes: FieldChange[] = [];
  const push = (label: string, before: string, after: string) => {
    if (before !== after) changes.push({ label, before: before || "—", after: after || "—" });
  };

  push("名稱", b.name, t.name);
  if (parentName.moved) push("上層", parentName.before, parentName.after);
  if (b.isAssembly !== t.isAssembly) push("類型", b.isAssembly ? "子集" : "零件", t.isAssembly ? "子集" : "零件");

  const money = () => {
    if (!sameNumber(b.qty, t.qty)) push("數量", numberText(b.qty), numberText(t.qty));
    // 子集自己的單價不算數(底下加起來),零件 ↔ 子集的轉換由「類型」那一條說明。
    if (!b.isAssembly && !t.isAssembly) {
      push("單價", `${numberText(b.unitPrice)} ${b.currency}`, `${numberText(t.unitPrice)} ${t.currency}`);
      if ((b.currency !== "TWD" || t.currency !== "TWD") && !sameNumber(b.fxRate, t.fxRate)) {
        push("匯率", numberText(b.fxRate), numberText(t.fxRate));
      }
    }
  };

  const customText = (node: BomNode, column: BomColumnDef): string => {
    const v = node.extra?.[column.id];
    if (v === null || v === undefined || v === false || v === "") return "";
    if (column.type === "CHECKBOX") return v === true ? "是" : "";
    if (column.type === "PERSON") return userName(String(v));
    if (column.type === "NUMBER" && typeof v === "number") return numberText(v);
    return String(v);
  };

  for (const column of columns) {
    if (isMoneyBlock(column)) {
      money();
      continue;
    }
    if (!column.visible) continue;
    if (isBuiltInColumn(column)) {
      const field = BUILT_IN_FIELD[column.id as keyof typeof BUILT_IN_FIELD];
      push(column.name, String(b[field] ?? ""), String(t[field] ?? ""));
    } else if (isStoredCustomColumn(column)) {
      push(column.name, customText(b, column), customText(t, column));
    }
  }
  return changes;
}

/**
 * 比兩份 BOM。baseRoots / targetRoots 是 summariseBom 長出來的最上層節點(已經有小計)。
 * columns 是這個看板 BOM 的欄位設定(決定比哪些欄位、欄位叫什麼名字);userName 把人員欄位的 id 換成姓名。
 */
export function diffBoms(
  baseRoots: BomNode[],
  targetRoots: BomNode[],
  columns: BomColumnDef[],
  userName: (id: string) => string = (id) => id
): BomDiff {
  const { toTarget, toBase } = matchNodes(baseRoots, targetRoots);

  // 合併成一棵樹:對象的列照它的位置,只在基準裡的列掛在它原本上層對到的那一列底下。
  const roots: Merged[] = [];
  const mergedOfBase = new Map<string, Merged>();
  const baseById = new Map(flattenBom(baseRoots).map((n) => [n.id, n]));

  const addTarget = (t: BomNode, parent: Merged | null) => {
    const m: Merged = { base: toBase.get(t.id), target: t, parent, children: [] };
    (parent ? parent.children : roots).push(m);
    if (m.base) mergedOfBase.set(m.base.id, m);
    for (const c of t.children) addTarget(c, m);
  };
  for (const t of targetRoots) addTarget(t, null);

  for (const b of flattenBom(baseRoots)) {
    if (toTarget.has(b.id)) continue;
    const parent = b.parentId ? (mergedOfBase.get(b.parentId) ?? null) : null;
    const m: Merged = { base: b, parent, children: [] };
    (parent ? parent.children : roots).push(m);
    mergedOfBase.set(b.id, m);
  }

  const rows: BomDiffRow[] = [];
  const counts = { added: 0, removed: 0, changed: 0, same: 0 };

  /** 後序:先知道底下有沒有變動,再決定這一列的 dirty。回傳這個子樹有沒有任何變動。 */
  const emit = (m: Merged, depth: number): boolean => {
    const index = rows.length;
    const node = (m.target ?? m.base)!;
    let status: BomDiffRow["status"];
    let changes: FieldChange[] = [];
    if (!m.base) status = "added";
    else if (!m.target) status = "removed";
    else {
      const baseParent = m.base.parentId ? mergedOfBase.get(m.base.parentId) : undefined;
      const moved = (baseParent ?? null) !== m.parent;
      const nameOf = (x: Merged | null | undefined) => (x ? (x.target ?? x.base)!.name : "最上層");
      changes = diffFields(m.base, m.target, columns, userName, {
        moved,
        before: m.base.parentId ? (baseById.get(m.base.parentId)?.name ?? "最上層") : "最上層",
        after: nameOf(m.parent),
      });
      status = changes.length > 0 ? "changed" : "same";
    }
    counts[status]++;

    const row: BomDiffRow = {
      key: `${m.base?.id ?? "-"}:${m.target?.id ?? "-"}`,
      depth,
      status,
      name: node.name,
      partNumber: node.partNumber,
      changes,
      beforeTotalTwd: m.base ? m.base.extendedTwd : null,
      afterTotalTwd: m.target ? m.target.extendedTwd : null,
      dirty: status !== "same",
    };
    rows.push(row);
    let anyBelow = false;
    for (const c of m.children) if (emit(c, depth + 1)) anyBelow = true;
    if (anyBelow) rows[index].dirty = true;
    return rows[index].dirty;
  };
  for (const m of roots) emit(m, 0);

  const sum = (nodes: BomNode[]) => Math.round(nodes.reduce((t, n) => t + n.extendedTwd, 0) * 100) / 100;
  return { rows, baseUnitCostTwd: sum(baseRoots), targetUnitCostTwd: sum(targetRoots), counts };
}
