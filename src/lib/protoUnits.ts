/**
 * 樣機計畫排出來的「每一台樣機」(ProtoUnit):樣機計畫一格「M3 / SW / EVT1 要 3 台」= 3 筆(第 1、2、3 台)。
 * 純邏輯,不碰 Prisma——資料庫的部分在 protoUnitsServer.ts。
 */

export type ProtoUnitKey = { product: string; unit: string; phaseId: string };

/** 樣機計畫的一格。 */
export type ProtoPlanCell = ProtoUnitKey & { qty: number };

/** 已經存在的一台樣機。 */
export type ExistingProtoUnit = ProtoUnitKey & { id: string; seq: number };

const keyOf = (k: ProtoUnitKey) => JSON.stringify([k.product, k.unit, k.phaseId]);

/** 一台樣機的名字:「M3 / EVT1 / SW #2」(產品 / 階段 / 用途 #第幾台)。 */
export function protoUnitLabel(unit: { product: string; unit: string; seq: number }, phaseName: string): string {
  return `${unit.product} / ${phaseName} / ${unit.unit} #${unit.seq}`;
}

/**
 * 樣機計畫現在的樣子 vs 已經有的樣機:要補哪幾台、要拿掉哪幾台。
 *
 * 每一格 qty = N 就該有第 1 ~ N 台。少的補上;多的(號碼比 N 大)拿掉,所以台數減少時是從最大的號碼開始拿,
 * 小號碼的(通常已經被工作項參照了)保留。計畫上已經沒有的格子(列被刪、產品被刪、台數改成 0)底下的全部拿掉。
 */
export function planProtoUnitSync(
  cells: ProtoPlanCell[],
  existing: ExistingProtoUnit[]
): { create: (ProtoUnitKey & { seq: number })[]; remove: ExistingProtoUnit[] } {
  const wanted = new Map<string, number>();
  for (const cell of cells) wanted.set(keyOf(cell), Math.max(0, Math.floor(cell.qty)));

  const have = new Set(existing.map((u) => `${keyOf(u)}#${u.seq}`));
  const create: (ProtoUnitKey & { seq: number })[] = [];
  for (const cell of cells) {
    const qty = wanted.get(keyOf(cell)) ?? 0;
    for (let seq = 1; seq <= qty; seq++) {
      if (!have.has(`${keyOf(cell)}#${seq}`)) create.push({ product: cell.product, unit: cell.unit, phaseId: cell.phaseId, seq });
    }
  }

  const remove = existing
    .filter((u) => u.seq > (wanted.get(keyOf(u)) ?? 0))
    .sort((a, b) => keyOf(a).localeCompare(keyOf(b)) || a.seq - b.seq);
  return { create, remove };
}

/** 同步的結果,給畫面講「拿掉了哪幾台、哪些工作項的參照被解除」。 */
export type ProtoSyncSummary = {
  added: number;
  removed: { label: string }[];
  /** 原本用到被拿掉的樣機、現在參照已經解除的工作項。 */
  cleared: { itemId: string; itemName: string; labels: string[] }[];
};

export const EMPTY_PROTO_SYNC: ProtoSyncSummary = { added: 0, removed: [], cleared: [] };

const MAX_LISTED = 8;

/**
 * 台數減少時告訴使用者:拿掉了幾台,哪些工作項原本在用、參照已經一併解除。沒有東西被拿掉就是 null(不用打擾)。
 * 不擋修改——這只是事後通知。
 */
export function protoSyncNotice(summary: ProtoSyncSummary): string | null {
  if (summary.removed.length === 0) return null;
  const lines = [`樣機計畫的台數減少了,已拿掉 ${summary.removed.length} 台樣機:`];
  const labels = summary.removed.slice(0, MAX_LISTED).map((r) => r.label);
  lines.push(labels.join("、") + (summary.removed.length > MAX_LISTED ? `…等 ${summary.removed.length} 台` : ""));
  if (summary.cleared.length > 0) {
    lines.push("", `其中有 ${summary.cleared.length} 個工作項原本在使用,它們的「使用樣機」已經解除這幾台:`);
    for (const item of summary.cleared.slice(0, MAX_LISTED)) lines.push(`・${item.itemName}:${item.labels.join("、")}`);
    if (summary.cleared.length > MAX_LISTED) lines.push(`…還有 ${summary.cleared.length - MAX_LISTED} 個工作項`);
    lines.push("", "需要的話,請重新替它們選別的樣機。");
  }
  return lines.join("\n");
}
