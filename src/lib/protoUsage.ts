import type { BoardWithData } from "@/types/board";
import { getItemDateRange } from "@/lib/gantt";
import { isNonWorkingDay } from "@/lib/workday";
import { computeWbsCodes, compareWbsCodes } from "@/lib/wbs";
import { protoUnitLabel } from "@/lib/protoUnits";
import type { MemberTask, WeekColumn, WorkloadThresholdSettings } from "@/lib/workload";

/**
 * 樣機使用時程:每一台樣機被哪些工作項(例如測試項目)佔用、佔用多少、從哪天到哪天。
 * 畫面跟「成員工作量明細」同一個樣子——一台樣機相當於一個人,工作項相當於他的任務,
 * 工作項在這台樣機上的佔用百分比(預設 100%)相當於人員分配的百分比。
 * 純函式,吃儀表板已經載入的看板資料,不碰 Prisma(資料庫的部分在 protoUsageServer.ts)。
 */

export const DEFAULT_PROTO_USAGE_PCT = 100;

export type ProtoUsageUnit = { id: string; boardId: string; product: string; unit: string; phaseId: string; seq: number };
export type ProtoUsageLink = { itemId: string; protoUnitId: string; usagePct: number };

export type ProtoUsageMachine = {
  id: string;
  boardId: string;
  boardName: string;
  product: string;
  phaseName: string;
  /** 「M3 / EVT1 / SW #2」 */
  label: string;
};

export type ProtoUsage = {
  /** 只含有工作項在使用的樣機。 */
  machines: ProtoUsageMachine[];
  /** 這些看板上沒有任何(看得到的)工作項在用的樣機——看哪些還閒著。 */
  idle: ProtoUsageMachine[];
  /** 樣機 id → 用到它的工作項(allocationPct = 這個工作項佔用這台的百分比)。 */
  tasksByMachine: Record<string, MemberTask[]>;
  /** 樣機 id → 每週佔用 %,取那一週裡最滿的一天(不是平均:週末沒人用不該把重疊稀釋掉);超過 100 = 同一天不只一個工作項在用。 */
  weeklyLoadByMachine: Record<string, number[]>;
};

export const EMPTY_PROTO_USAGE: ProtoUsage = { machines: [], idle: [], tasksByMachine: {}, weeklyLoadByMachine: {} };

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function computeProtoUsage(
  boards: BoardWithData[],
  units: ProtoUsageUnit[],
  phases: { id: string; name: string; order: number }[],
  links: ProtoUsageLink[],
  weeks: WeekColumn[],
  holidays: Set<string> = new Set()
): ProtoUsage {
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const phaseById = new Map(phases.map((p) => [p.id, p]));

  // WBS 是項目在它自己分組樹裡的位置,一個分組算一次(跟成員工作量明細同一套)。
  const wbsByBoard = new Map<string, Map<string, string>>();
  const itemsByBoard = new Map<string, Map<string, BoardWithData["items"][number]>>();
  for (const board of boards) {
    const wbs = new Map<string, string>();
    for (const group of board.groups) {
      const groupItems = board.items.filter((i) => i.groupId === group.id);
      for (const [id, code] of computeWbsCodes(groupItems)) wbs.set(id, code);
    }
    wbsByBoard.set(board.id, wbs);
    itemsByBoard.set(board.id, new Map(board.items.map((i) => [i.id, i])));
  }

  const tasksByMachine: Record<string, MemberTask[]> = {};
  const dailyLoad = new Map<string, Map<string, number>>();
  const used = new Map<string, ProtoUsageUnit>();

  for (const link of links) {
    const unit = unitById.get(link.protoUnitId);
    const board = unit && boardById.get(unit.boardId);
    // 看不到的工作項(私人項目、垃圾桶)不在 board.items 裡,自然不會列出來。
    const item = unit && itemsByBoard.get(unit.boardId)?.get(link.itemId);
    if (!unit || !board || !item) continue;

    const hasRange = !!(board.ganttStartColumnId && board.ganttDurationColumnId);
    const range = hasRange
      ? getItemDateRange(item, board.ganttStartColumnId!, board.ganttDurationColumnId!, board.ganttDurationMode, holidays)
      : null;
    const group = board.groups.find((g) => g.id === item.groupId);
    (tasksByMachine[unit.id] ??= []).push({
      boardId: board.id,
      boardName: board.name,
      groupId: item.groupId,
      groupName: group?.name ?? "",
      itemId: item.id,
      itemName: item.name,
      wbsCode: wbsByBoard.get(board.id)?.get(item.id) ?? "",
      allocationPct: link.usagePct,
      startDate: range?.start ?? null,
      endDate: range?.end ?? null,
    });
    used.set(unit.id, unit);

    if (range) {
      let dayMap = dailyLoad.get(unit.id);
      if (!dayMap) dailyLoad.set(unit.id, (dayMap = new Map()));
      const cursor = new Date(range.start);
      while (cursor <= range.end) {
        if (board.ganttDurationMode !== "BUSINESS" || !isNonWorkingDay(cursor, holidays)) {
          const key = toIsoDate(cursor);
          dayMap.set(key, (dayMap.get(key) ?? 0) + link.usagePct);
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }
  }

  /** 看板 → 產品 → 階段順序 → 用途 → 第幾台。 */
  const arrange = (list: ProtoUsageUnit[]): ProtoUsageMachine[] =>
    list
      .map((u) => {
        const phase = phaseById.get(u.phaseId);
        return {
          unit: u,
          order: phase?.order ?? 0,
          machine: {
            id: u.id,
            boardId: u.boardId,
            boardName: boardById.get(u.boardId)?.name ?? "",
            product: u.product,
            phaseName: phase?.name ?? "",
            label: protoUnitLabel(u, phase?.name ?? ""),
          },
        };
      })
      .sort(
        (a, b) =>
          a.machine.boardName.localeCompare(b.machine.boardName) ||
          a.unit.product.localeCompare(b.unit.product) ||
          a.order - b.order ||
          a.unit.unit.localeCompare(b.unit.unit) ||
          a.unit.seq - b.unit.seq
      )
      .map((m) => m.machine);

  const machines = arrange([...used.values()]);
  // 傳進來的樣機(只要是這幾個看板的)裡,沒有人在用的,就是閒置。
  const idle = arrange(units.filter((u) => boardById.has(u.boardId) && !used.has(u.id)));

  // 工作項依分組、WBS 代號排,跟成員工作量明細一致。
  for (const tasks of Object.values(tasksByMachine)) {
    tasks.sort((a, b) => a.groupName.localeCompare(b.groupName) || compareWbsCodes(a.wbsCode, b.wbsCode));
  }

  const weeklyLoadByMachine: Record<string, number[]> = {};
  for (const machine of machines) {
    const dayMap = dailyLoad.get(machine.id);
    weeklyLoadByMachine[machine.id] = weeks.map((week) => {
      let peak = 0;
      for (let i = 0; i < 7; i++) peak = Math.max(peak, dayMap?.get(toIsoDate(addDays(week.start, i))) ?? 0);
      return peak;
    });
  }

  return { machines, idle, tasksByMachine, weeklyLoadByMachine };
}

/**
 * 樣機每週格子的顏色:有人在用是綠色(100% 就是正常的滿載);超過 100% = 同一天不只一個工作項在用這台,紅色。
 * 不用人員的黃綠紅門檻——人 70% 以上算忙,樣機排滿 100% 是本來就該有的樣子。
 */
export function machineLoadColor(pct: number, threshold: Pick<WorkloadThresholdSettings, "greenColor" | "redColor">): string {
  return pct > 100 ? threshold.redColor : threshold.greenColor;
}

/** 一台樣機上,佔用合計超過 100% 的那段日子。 */
export type OverloadSpan = {
  /** 超過 100% 的第一天與最後一天(YYYY-MM-DD)。 */
  from: string;
  to: string;
  /** 那些天裡最高的合計百分比。 */
  peak: number;
  /** 在超過 100% 的那些天裡有用到這台的工作項。 */
  itemIds: string[];
};

/**
 * 一台樣機被好幾個工作項用:同一天佔用加起來超過 100% 的那段日子(沒有就是 null)。
 * 跟每週格子變紅是同一個判斷(逐日加總、工作天模式略過週末與假日),只是回報的是「哪幾天、哪幾個工作項」,
 * 給選樣機、改百分比之後提醒用。沒排程(沒有起訖)的工作項不佔日子,不算。
 */
export function findOverload(
  entries: { itemId: string; pct: number; start: Date | null; end: Date | null; businessDaysOnly: boolean }[],
  holidays: Set<string> = new Set()
): OverloadSpan | null {
  const perDay = new Map<string, { sum: number; items: Set<string> }>();
  for (const e of entries) {
    if (!e.start || !e.end) continue;
    const cursor = new Date(e.start);
    while (cursor <= e.end) {
      if (!e.businessDaysOnly || !isNonWorkingDay(cursor, holidays)) {
        const key = toIsoDate(cursor);
        const day = perDay.get(key) ?? { sum: 0, items: new Set<string>() };
        day.sum += e.pct;
        day.items.add(e.itemId);
        perDay.set(key, day);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const over = [...perDay.entries()].filter(([, d]) => d.sum > 100).sort(([a], [b]) => a.localeCompare(b));
  if (over.length === 0) return null;
  return {
    from: over[0][0],
    to: over[over.length - 1][0],
    peak: Math.max(...over.map(([, d]) => d.sum)),
    itemIds: [...new Set(over.flatMap(([, d]) => [...d.items]))],
  };
}
