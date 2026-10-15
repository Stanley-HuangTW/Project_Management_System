import type { GanttDurationMode } from "@prisma/client";
import type { DateRange } from "@/lib/gantt";
import {
  buildWbsIndexFromItems,
  computeScheduledRange,
  formatPredEntries,
  parsePredEntries,
  type PredEntry,
  type RelationshipType,
  type WbsIndex,
} from "@/lib/predecessorLink";
import { countDaysInRange } from "@/lib/workday";

/**
 * 甘特圖上建立前置依賴(連結)的純邏輯:拖曳的兩端決定關係、檢查這條連結合不合理、改寫 Pred 格的值,
 * 以及「保持目前日期」要補多少延遲。畫面與伺服器動作共用這一份,規則才不會兩邊各說各話。
 */

export type LinkEdge = "start" | "end";

/**
 * 從前置任務的哪一端拉到後續任務的哪一端,決定是哪一種關係(MS Project 的習慣):
 * 完成→開始 = FS、開始→開始 = SS、完成→完成 = FF、開始→完成 = SF。
 */
export function relationshipForEdges(fromEdge: LinkEdge, toEdge: LinkEdge): RelationshipType {
  if (fromEdge === "end") return toEdge === "start" ? "FS" : "FF";
  return toEdge === "start" ? "SS" : "SF";
}

export const RELATIONSHIP_NAMES: Record<RelationshipType, string> = {
  FS: "完成到開始(FS)",
  SS: "開始到開始(SS)",
  FF: "完成到完成(FF)",
  SF: "開始到完成(SF)",
};

export type LinkItem = {
  id: string;
  parentId: string | null;
  order: number;
  groupId: string;
  cellValues: { columnId: string; value: unknown }[];
};

function predValueOf(item: LinkItem, predColumnId: string): unknown {
  return item.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
}

/**
 * 把 predId 設成 succId 的前置,合不合理?合理回 null,不合理回要告訴使用者的原因。
 * 擋:連到自己、已經是前置、父項與子項互連(父項的時程是子項目統計出來的)、會形成循環。
 */
export function validateNewLink(
  items: LinkItem[],
  predColumnId: string,
  predId: string,
  succId: string,
  index: WbsIndex = buildWbsIndexFromItems(items)
): string | null {
  if (predId === succId) return "不能把項目連到自己。";
  const byId = new Map(items.map((i) => [i.id, i]));
  const pred = byId.get(predId);
  const succ = byId.get(succId);
  if (!pred || !succ) return "找不到要連結的項目(可能已被刪除,或不在這個看板上)。";

  const isAncestor = (ancestorId: string, itemId: string) => {
    const seen = new Set<string>();
    let cursor = byId.get(itemId)?.parentId ?? null;
    while (cursor && !seen.has(cursor)) {
      if (cursor === ancestorId) return true;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return false;
  };
  if (isAncestor(predId, succId) || isAncestor(succId, predId)) {
    return "父項目與它底下的子項目不能互相當前置——父項目的時程本來就是由子項目統計出來的。";
  }

  const existing = parsePredEntries(index, succ.groupId, predValueOf(succ, predColumnId));
  if (existing.some((e) => e.itemId === predId)) return "這條前置依賴已經存在了,要改關係或延遲,請點箭頭。";

  // 循環:前置自己(直接或間接)已經在等後續任務。沿著「等誰」一路往回走,走得到後續任務就是循環。
  const seen = new Set<string>();
  const stack = [predId];
  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (seen.has(currentId)) continue;
    seen.add(currentId);
    const current = byId.get(currentId);
    if (!current) continue;
    for (const entry of parsePredEntries(index, current.groupId, predValueOf(current, predColumnId))) {
      if (entry.itemId === succId) return "這條連結會形成循環(前置任務自己已經在等這個任務),無法建立。";
      stack.push(entry.itemId);
    }
  }
  return null;
}

/** 新增(或取代同一個前置的)一條依賴之後,Pred 格要存的值。 */
export function withPredEntry(
  index: WbsIndex,
  groupId: string,
  raw: unknown,
  entry: { itemId: string; relationship: RelationshipType; lag: number | null }
): string | null {
  const others = parsePredEntries(index, groupId, raw).filter((e) => e.itemId !== entry.itemId);
  const next: PredEntry = { itemId: entry.itemId, relationship: entry.relationship, lag: entry.lag };
  return formatPredEntries([...others, next]);
}

/** 拿掉一條依賴之後,Pred 格要存的值(沒有任何依賴了就是 null,整格清空)。 */
export function withoutPredEntry(index: WbsIndex, groupId: string, raw: unknown, predId: string): string | null {
  return formatPredEntries(parsePredEntries(index, groupId, raw).filter((e) => e.itemId !== predId));
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * 「保持目前日期」:後續任務的日期不動,要補多少延遲天數,排出來才剛好是現在這個日期。
 * FS/SS 對準開始日、FF/SF 對準完成日;用排程引擎自己的算法反推(延遲的單位、週末與假日都跟引擎一致),
 * 在 ±730 天內由近到遠找。找不到(目標日落在週末或假日,排不出來)回 null。
 */
export function lagToKeepDates(
  predRange: DateRange,
  succRange: DateRange,
  relationship: RelationshipType,
  mode: GanttDurationMode,
  holidays: Set<string>
): number | null {
  const myDays = countDaysInRange(succRange.start, succRange.end, mode, holidays);
  if (myDays === null) return null;
  const anchorsStart = relationship === "FS" || relationship === "SS";
  const target = isoDay(anchorsStart ? succRange.start : succRange.end);
  for (let distance = 0; distance <= 730; distance++) {
    for (const lag of distance === 0 ? [0] : [distance, -distance]) {
      const computed = computeScheduledRange(predRange, myDays, relationship, lag, mode, holidays);
      if (computed && isoDay(anchorsStart ? computed.start : computed.end) === target) return lag;
    }
  }
  return null;
}
