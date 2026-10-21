/**
 * 項目名稱欄(表格與甘特圖共用)一開始要多寬,才看得到每一個項目的全名。
 *
 * 只算數字、不碰畫面:量字的函式由呼叫端給(畫面上用 canvas 量),所以整個測得到。
 * 一列需要的寬度 = 縮排(每一層多少 px × 深度)+ WBS 編號 + 名稱 + 列上其餘的東西(勾選框、箭頭、
 * 留言 / 指派 / 選單圖示、間距——呼叫端量好的固定值 chrome)。取全部項目裡最寬的那一列,
 * 不是只看畫面上展開著的:收合的子項目一展開也要看得到。
 */

export type FitItem = { id: string; name: string; parentId: string | null };

export function fitNameColumnWidth(args: {
  items: FitItem[];
  /** 項目的 WBS 編號(沒有就不算這一段)。 */
  codeOf?: (id: string) => string | undefined;
  /** 量一段字有多寬(px)。kind 讓呼叫端用不同的字級:名稱是 "name"、編號是 "code"。 */
  measure: (text: string, kind: "name" | "code") => number;
  /** 每往下一層縮排多少 px。 */
  indentPerLevel: number;
  /** 一列上名稱以外、不隨項目變的寬度。 */
  chrome: number;
  /** 最窄不低於(預設寬度)、最寬不超過(整塊表被一個超長的名稱吃光)。 */
  min: number;
  max: number;
}): number {
  const byId = new Map(args.items.map((item) => [item.id, item]));
  let widest = 0;
  for (const item of args.items) {
    // 往上數幾層;走過頭(資料壞了、迴圈)就停,不會卡住。
    let depth = 0;
    let current = item;
    for (let guard = 0; current.parentId && guard < args.items.length; guard++) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      depth++;
      current = parent;
    }
    const code = args.codeOf?.(item.id);
    const width =
      depth * args.indentPerLevel +
      (code ? args.measure(code, "code") : 0) +
      args.measure(item.name, "name") +
      args.chrome;
    if (width > widest) widest = width;
  }
  if (widest === 0) return args.min;
  return Math.min(args.max, Math.max(args.min, Math.ceil(widest)));
}

/**
 * 自動調整寬度的上限:容器的一半,但不低於 floor、不高於 ceiling——名稱欄寬到看得到全名,
 * 也不能把時間軸 / 資料欄擠沒了。使用者之後還是可以手動拖得更寬。
 */
export function autoFitCap(containerWidth: number, floor: number, ceiling = 720): number {
  return Math.min(ceiling, Math.max(floor, Math.round(containerWidth * 0.5)));
}
