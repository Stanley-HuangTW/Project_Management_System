/**
 * 工時行事曆(週視圖)的版面計算。純邏輯:畫面只負責把這裡算出來的位置畫出來。
 * 時間一律是「從 00:00 起算的分鐘數」(見 timeOfDay.ts)。
 */
import { MINUTES_PER_DAY } from "./timeOfDay";

/** 一小時佔幾個像素。 */
export const HOUR_PX = 48;
/** 拖曳、拉長時對齊到幾分鐘。 */
export const SNAP_MINUTES = 15;
/** 一筆工時最短畫多高(分鐘),再短的也要點得到。 */
export const MIN_EVENT_MINUTES = 15;

export function minuteToPx(minute: number): number {
  return (minute / 60) * HOUR_PX;
}

export function pxToMinute(px: number): number {
  return (px / HOUR_PX) * 60;
}

/** 對齊到 SNAP_MINUTES,並夾在 [0, 一天) 之內。 */
export function snapToGrid(minute: number): number {
  const snapped = Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(MINUTES_PER_DAY - SNAP_MINUTES, Math.max(0, snapped));
}

/** 時數對齊到 0.25 小時(15 分鐘),至少一格。 */
export function snapHours(hours: number): number {
  return Math.max(SNAP_MINUTES / 60, Math.round(hours * 4) / 4);
}

/** 開始時間 + 時數 → 結束時間(分鐘)。 */
export function endMinuteOf(startMinute: number, hours: number): number {
  return startMinute + Math.round(hours * 60);
}

/**
 * 拖曳選一段時間(新增用):起點、終點任意順序,各自對齊後回傳開始時間與時數(至少一格)。
 * 終點不會超過午夜。
 */
export function selectionToSlot(anchorMinute: number, currentMinute: number): { startMinute: number; hours: number } {
  const a = snapToGrid(anchorMinute);
  const b = Math.round(currentMinute / SNAP_MINUTES) * SNAP_MINUTES;
  const start = Math.min(a, snapToGrid(Math.min(anchorMinute, currentMinute)));
  const end = Math.min(MINUTES_PER_DAY, Math.max(a, b) + (a === b ? SNAP_MINUTES : 0));
  const startMinute = Math.min(start, end - SNAP_MINUTES);
  return { startMinute, hours: (end - startMinute) / 60 };
}

export type LayoutEvent = { key: string; startMinute: number; endMinute: number };
export type LayoutSlot = { lane: number; lanes: number };

/**
 * 同一天裡重疊的事件並排顯示(像 Google 行事曆):互相重疊的連成一群,群裡每個事件放進
 * 第一條不衝突的車道,整群共用「最多同時幾條」當寬度分母。不重疊的事件各自佔滿整列。
 * 太短的事件以 MIN_EVENT_MINUTES 計算,不然兩筆緊鄰的短事件會被畫成疊在一起。
 */
export function layoutDayEvents(events: LayoutEvent[]): Map<string, LayoutSlot> {
  const sorted = [...events]
    .map((e) => ({ ...e, endMinute: Math.max(e.endMinute, e.startMinute + MIN_EVENT_MINUTES) }))
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const result = new Map<string, LayoutSlot>();
  let cluster: { key: string; lane: number }[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];

  const flush = () => {
    for (const item of cluster) result.set(item.key, { lane: item.lane, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };

  for (const event of sorted) {
    if (cluster.length > 0 && event.startMinute >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= event.startMinute);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(event.endMinute);
    } else {
      laneEnds[lane] = event.endMinute;
    }
    cluster.push({ key: event.key, lane });
    clusterEnd = Math.max(clusterEnd, event.endMinute);
  }
  flush();
  return result;
}
