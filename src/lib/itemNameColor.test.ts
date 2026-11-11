import { describe, expect, it } from "vitest";
import { resolveItemNameColor } from "./dashboard";
import type { BoardWithData, ColumnData, ItemData } from "@/types/board";

const statusColumn = {
  id: "col-status",
  name: "Status",
  type: "STATUS",
  options: {
    statuses: [
      { id: "planned", label: "Planned", color: "#00c875" },
      { id: "in_progress", label: "In Progress", color: "#a25ddc" },
      { id: "done", label: "Completed", color: "#e2445c" },
      { id: "pending", label: "Pending", color: "#c4c4c4" },
      { id: "hold-2", label: "卡關中", color: "#111111" },
    ],
  },
} as unknown as ColumnData;

const board = {
  progressColumnId: null,
  reportStatusColumnId: "col-status",
  reportDoneOptionIds: ["done"],
  reportPausedOptionIds: ["pending", "hold-2"],
  ganttCompletedColor: "#C",
  ganttOverdueColor: "#O",
  ganttInProgressColor: "#I",
  ganttPausedColor: "#P",
} as unknown as BoardWithData;

const item = (status: string) => ({ id: "i1", cellValues: [{ columnId: "col-status", value: status }] }) as unknown as ItemData;
const past = { start: new Date("2020-01-01"), end: new Date("2020-02-01") };

describe("resolveItemNameColor:暫停", () => {
  it("歸在報表「暫停」的狀態(自己加的也算)顯示暫停色", () => {
    expect(resolveItemNameColor(item("pending"), board, statusColumn, null)).toBe("#P");
    expect(resolveItemNameColor(item("hold-2"), board, statusColumn, null)).toBe("#P");
  });

  it("暫停優先於逾期:被擱置的項目過了預定日期不算逾期", () => {
    expect(resolveItemNameColor(item("pending"), board, statusColumn, past)).toBe("#P");
    expect(resolveItemNameColor(item("planned"), board, statusColumn, past)).toBe("#O");
  });

  it("完成優先於暫停", () => {
    const doneBoard = { ...board, reportDoneOptionIds: ["done", "pending"] } as BoardWithData;
    expect(resolveItemNameColor(item("pending"), doneBoard, statusColumn, past)).toBe("#C");
  });

  it("沒設報表分類的看板,名稱叫 Pending 也算暫停;其他狀態照舊", () => {
    const unconfigured = { ...board, reportStatusColumnId: null, reportPausedOptionIds: [] } as unknown as BoardWithData;
    expect(resolveItemNameColor(item("pending"), unconfigured, statusColumn, null)).toBe("#P");
    expect(resolveItemNameColor(item("hold-2"), unconfigured, statusColumn, null)).toBeUndefined();
    expect(resolveItemNameColor(item("in_progress"), board, statusColumn, null)).toBe("#I");
  });
});
