import { describe, expect, it } from "vitest";
import { resolvePredLamp } from "./predLamp";
import type { BoardWithData, ColumnData, ItemData } from "@/types/board";

const statusColumn = {
  id: "st",
  name: "Status",
  type: "STATUS",
  options: { statuses: [{ id: "done", label: "Completed", color: "#e2445c" }, { id: "planned", label: "Planned", color: "#00c875" }] },
} as unknown as ColumnData;

const board = {
  predColumnId: "pred",
  ganttStartColumnId: "start",
  ganttDurationColumnId: "days",
  ganttDurationMode: "CALENDAR",
  progressColumnId: null,
  reportStatusColumnId: "st",
  reportDoneOptionIds: ["done"],
  reportPausedOptionIds: [],
  predReadyColor: "#READY",
  predWaitingColor: "#WAIT",
  predBlockedColor: "#BLOCK",
} as unknown as BoardWithData;

const mk = (id: string, order: number, cells: Record<string, unknown>): ItemData =>
  ({
    id,
    name: id === "a" ? "前置作業" : "後續作業",
    groupId: "g",
    parentId: null,
    order,
    cellValues: Object.entries(cells).map(([columnId, value]) => ({ columnId, value })),
  }) as unknown as ItemData;

// 前置 a:5/10 起 11 天 = 5/10~5/20,已完成。後續 b 以 a 為前置(用 id 當 Pred),排在 5/21 開始。
const a = mk("a", 0, { start: "2026-05-10", days: 11, st: "done" });
const b = mk("b", 1, { start: "2026-05-21", days: 5, pred: "a" });
const items = [a, b];
const none = new Set<string>();

describe("resolvePredLamp:前置晚於預定才完成", () => {
  it("準時完成:可以開始", () => {
    expect(resolvePredLamp(b, items, board, statusColumn, none, { a: "2026-05-20T05:00:00.000Z" })?.state).toBe("ready");
  });

  it("沒給完成時間(舊的呼叫端):照舊,可以開始", () => {
    expect(resolvePredLamp(b, items, board, statusColumn, none)?.state).toBe("ready");
  });

  it("預定 5/20、5/30 才完成,後續還排 5/21 開始:要順延", () => {
    const lamp = resolvePredLamp(b, items, board, statusColumn, none, { a: "2026-05-30T05:00:00.000Z" });
    expect(lamp?.state).toBe("blocked");
    expect(lamp?.color).toBe("#BLOCK");
    expect(lamp?.label).toContain("05-20");
    expect(lamp?.label).toContain("05-30");
    expect(lamp?.label).toContain("晚 10 天");
    expect(lamp?.label).toContain("需要順延");
  });

  it("後續已經排在實際完成之後(例如 PM 已經順延過):可以開始", () => {
    const shifted = mk("b", 1, { start: "2026-05-31", days: 5, pred: "a" });
    expect(resolvePredLamp(shifted, [a, shifted], board, statusColumn, none, { a: "2026-05-30T05:00:00.000Z" })?.state).toBe("ready");
  });
});
