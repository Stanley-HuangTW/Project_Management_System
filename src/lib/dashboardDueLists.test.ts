import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardWithData } from "@/types/board";
import { computeDashboardDueLists } from "./dashboard";

/**
 * 儀表板「本週完成」:以實際切成完成的時間為準;沒有切換紀錄的才退回用計畫完成日。
 * 只造這支函式用得到的欄位。
 */
const START = "c_start";
const DAYS = "c_days";
const STATUS = "c_status";

function item(id: string, start: string, days: number, status: string) {
  return {
    id,
    name: id,
    groupId: "g1",
    parentId: null,
    order: 0,
    cellValues: [
      { columnId: START, value: start },
      { columnId: DAYS, value: days },
      { columnId: STATUS, value: status },
    ],
    assignments: [],
  };
}

function board(items: ReturnType<typeof item>[]): BoardWithData {
  return {
    id: "b1",
    name: "看板",
    ganttStartColumnId: START,
    ganttDurationColumnId: DAYS,
    ganttDurationMode: "CALENDAR",
    progressColumnId: null,
    reportStatusColumnId: null,
    reportDoneOptionIds: [],
    columns: [
      {
        id: STATUS,
        name: "Status",
        type: "STATUS",
        order: 0,
        options: { options: [{ id: "done", label: "Completed", color: "#0f0" }, { id: "plan", label: "Planned", color: "#999" }] },
      },
    ],
    groups: [{ id: "g1", name: "分組" }],
    items,
  } as unknown as BoardWithData;
}

const names = (list: { itemName: string }[]) => list.map((e) => e.itemName).sort();

describe("computeDashboardDueLists:本週完成", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 台灣時間 2026-10-12(週一)上午 11:00
    vi.setSystemTime(new Date("2026-10-12T03:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("這週才切成完成的算本週完成,就算計畫完成日是上週(VCU選用:計畫 10/07,10/12 切成完成)", () => {
    const b = board([item("VCU選用", "2026-10-05", 3, "done")]);
    const { completedThisWeek } = computeDashboardDueLists([b], undefined, new Set(), { VCU選用: "2026-10-12T01:12:57.000Z" });
    expect(names(completedThisWeek)).toEqual(["VCU選用"]);
    // 列出的日期是實際完成的那天,不是計畫完成日
    expect(completedThisWeek[0].end.toISOString().slice(0, 10)).toBe("2026-10-12");
  });

  it("沒有切換紀錄(舊資料):退回計畫完成日——在本週才算,上週的不算", () => {
    const b = board([item("今天到期", "2026-10-12", 1, "done"), item("上週到期", "2026-10-05", 3, "done")]);
    const { completedThisWeek } = computeDashboardDueLists([b], undefined, new Set(), {});
    expect(names(completedThisWeek)).toEqual(["今天到期"]);
  });

  it("有切換紀錄、但是上週切的:不算本週完成,即使計畫完成日在本週", () => {
    const b = board([item("上週就完成了", "2026-10-12", 1, "done")]);
    const { completedThisWeek } = computeDashboardDueLists([b], undefined, new Set(), { 上週就完成了: "2026-10-08T05:00:00.000Z" });
    expect(completedThisWeek).toEqual([]);
  });

  it("提早完成:計畫完成日還在未來、這週切成完成,也算本週完成", () => {
    const b = board([item("提早完成", "2026-10-20", 3, "done")]);
    const { completedThisWeek, upcoming7, upcoming30 } = computeDashboardDueLists([b], undefined, new Set(), {
      提早完成: "2026-10-12T02:00:00.000Z",
    });
    expect(names(completedThisWeek)).toEqual(["提早完成"]);
    expect(upcoming7).toEqual([]);
    expect(upcoming30).toEqual([]);
  });

  it("還沒完成的項目不受影響:計畫完成日過了就是逾期", () => {
    const b = board([item("還沒做完", "2026-10-05", 3, "plan")]);
    const { overdue, completedThisWeek } = computeDashboardDueLists([b], undefined, new Set(), {});
    expect(names(overdue)).toEqual(["還沒做完"]);
    expect(completedThisWeek).toEqual([]);
  });

  it("週的邊界照台灣時間:台灣週一凌晨 1:30(UTC 週日 17:30)切成完成,算新的這一週", () => {
    vi.setSystemTime(new Date("2026-10-11T18:00:00.000Z")); // 台灣 10/12 02:00
    const b = board([item("週一凌晨完成", "2026-10-05", 3, "done")]);
    const { completedThisWeek } = computeDashboardDueLists([b], undefined, new Set(), { 週一凌晨完成: "2026-10-11T17:30:00.000Z" });
    expect(names(completedThisWeek)).toEqual(["週一凌晨完成"]);
  });
});
