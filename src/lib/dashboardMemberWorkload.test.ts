import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardWithData } from "@/types/board";
import { computeMemberItemWorkload, computeMemberItemWorkloadForUsers, type WorkloadPeriod } from "./dashboard";

/**
 * computeMemberItemWorkloadForUsers 是為了效能把「每個人 × 每個期間各掃一遍全部項目」改成「每個項目只看一次」。
 * 結果必須跟舊的逐一呼叫完全一樣——這裡用固定種子的亂數造各種奇怪的看板去比。
 */
const PERIODS: WorkloadPeriod[] = ["day", "week", "month"];

describe("computeMemberItemWorkloadForUsers 跟逐一呼叫 computeMemberItemWorkload 的結果一樣", () => {
  vi.setConfig({ testTimeout: 60_000 }); // 整套平行跑、機器忙的時候單獨跑 1 秒的會拖到十幾秒
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T03:00:00.000Z")); // 週三
  });
  afterEach(() => vi.useRealTimers());

  let seed = 20261109;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const users = Array.from({ length: 10 }, (_, i) => `u${i}`);

  function makeBoard(n: number, mode: "CALENDAR" | "BUSINESS"): BoardWithData {
    const ganttOn = rand() < 0.85;
    const items = Array.from({ length: Math.floor(rand() * 60) }, (_, i) => {
      const startOffset = Math.floor(rand() * 90) - 45;
      const start = new Date(Date.UTC(2026, 9, 14 + startOffset)).toISOString().slice(0, 10);
      const cellValues: { columnId: string; value: unknown }[] = [
        { columnId: "start", value: rand() < 0.93 ? start : pick([null, "不是日期", 5]) },
        { columnId: "days", value: rand() < 0.93 ? Math.floor(rand() * 30) : pick([-1, "3", null]) },
      ];
      for (const columnId of ["owner", "reviewer"]) {
        const r = rand();
        if (r < 0.35) cellValues.push({ columnId, value: pick(users) });
        else if (r < 0.55) cellValues.push({ columnId, value: [pick(users), pick(users)] });
        else if (r < 0.65) cellValues.push({ columnId, value: pick(["", null, []]) });
      }
      cellValues.push({ columnId: "note", value: pick(users) }); // 不是人員欄位:就算寫了人名也不算
      const assignments = Array.from({ length: Math.floor(rand() * 3) }, () => ({ userId: pick(users), allocationPct: pick([0, 25, 50, 100]) }));
      return { id: `b${n}-i${i}`, name: `項目 ${n}-${i}`, groupId: "g", parentId: null, order: i, cellValues, assignments };
    });
    return {
      id: `b${n}`,
      name: `看板 ${n}`,
      ganttStartColumnId: ganttOn ? "start" : null,
      ganttDurationColumnId: ganttOn ? "days" : null,
      ganttDurationMode: mode,
      columns: [
        { id: "owner", type: "PERSON" },
        { id: "reviewer", type: "PERSON" },
        { id: "note", type: "TEXT" },
      ],
      items,
    } as unknown as BoardWithData;
  }

  it("隨機看板 300 輪(日曆 / 工作天、假日、預設比例 0 / 20 / 50、同一人多筆分配、各種壞資料)", () => {
    let nonEmpty = 0; // 確認亂數真的造出了有內容的結果,不是兩邊都空空地「一樣」
    for (let round = 0; round < 300; round++) {
      const boards = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, n) => makeBoard(n, pick(["CALENDAR", "BUSINESS"])));
      const holidays = new Set<string>(rand() < 0.5 ? [] : ["2026-10-10", "2026-10-15", "2026-10-20", "2026-11-02"]);
      const pct = pick([0, 20, 50]);
      const scope = users.filter(() => rand() < 0.7);

      const batch = computeMemberItemWorkloadForUsers(boards, scope, holidays, pct);
      expect(Object.keys(batch).sort()).toEqual([...scope].sort());
      for (const userId of scope) {
        for (const period of PERIODS) {
          expect(batch[userId][period], `round ${round} ${userId} ${period}`).toEqual(computeMemberItemWorkload(boards, userId, period, holidays, pct));
          if (batch[userId][period].length > 0) nonEmpty++;
        }
      }
    }
    expect(nonEmpty).toBeGreaterThan(1000);
  });

  it("沒有人、沒有看板:空結果,不丟例外", () => {
    expect(computeMemberItemWorkloadForUsers([], [])).toEqual({});
    expect(computeMemberItemWorkloadForUsers([], ["u1"])).toEqual({ u1: { day: [], week: [], month: [] } });
  });
});
