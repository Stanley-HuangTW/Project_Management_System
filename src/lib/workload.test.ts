import { describe, expect, it } from "vitest";
import type { BoardWithData } from "@/types/board";
import { computeMemberTaskBreakdown, groupTasksByBoardAndGroup } from "./workload";

describe("groupTasksByBoardAndGroup", () => {
  const task = (boardId: string, boardName: string, groupId: string, groupName: string, itemId: string) => ({
    boardId,
    boardName,
    groupId,
    groupName,
    itemId,
    itemName: itemId,
    wbsCode: "1",
    allocationPct: 50,
    startDate: null,
    endDate: null,
  });

  it("收成看板 → 分組兩層,順序照原本的排序", () => {
    const grouped = groupTasksByBoardAndGroup([
      task("b1", "AMR", "g1", "POC", "i1"),
      task("b1", "AMR", "g1", "POC", "i2"),
      task("b1", "AMR", "g2", "EVT", "i3"),
      task("b2", "M3", "g3", "DVT", "i4"),
    ]);

    expect(grouped.map((b) => b.boardName)).toEqual(["AMR", "M3"]);
    expect(grouped[0].groups.map((g) => g.groupName)).toEqual(["POC", "EVT"]);
    expect(grouped[0].groups[0].rows.map((t) => t.itemId)).toEqual(["i1", "i2"]);
    expect(grouped[1].groups[0].rows.map((t) => t.itemId)).toEqual(["i4"]);
  });

  it("同一個分組的任務即使中間夾著別的看板也會收在一起", () => {
    const grouped = groupTasksByBoardAndGroup([
      task("b1", "AMR", "g1", "POC", "i1"),
      task("b2", "M3", "g3", "DVT", "i2"),
      task("b1", "AMR", "g1", "POC", "i3"),
    ]);

    expect(grouped).toHaveLength(2);
    expect(grouped[0].groups[0].rows.map((t) => t.itemId)).toEqual(["i1", "i3"]);
  });

  it("沒有任務就沒有任何一層", () => {
    expect(groupTasksByBoardAndGroup([])).toEqual([]);
  });
});

describe("computeMemberTaskBreakdown:只算人員分配", () => {
  const board = {
    id: "b1",
    name: "AMR",
    groups: [{ id: "g1", name: "POC" }],
    columns: [{ id: "owner", type: "PERSON" }],
    ganttStartColumnId: "s",
    ganttDurationColumnId: "d",
    ganttDurationMode: "CALENDAR",
    items: [
      {
        id: "i1",
        groupId: "g1",
        parentId: null,
        order: 0,
        name: "MCU Schematic",
        assignments: [{ userId: "u1", allocationPct: 30 }],
        cellValues: [
          { columnId: "s", value: "2026-10-05" },
          { columnId: "d", value: 2 },
          { columnId: "owner", value: "u2" },
        ],
      },
    ],
  } as unknown as BoardWithData;

  it("被分配的人有任務、百分比照人員分配", () => {
    const byUser = computeMemberTaskBreakdown([board], ["u1", "u2"]);
    expect(byUser.get("u1")?.map((t) => t.allocationPct)).toEqual([30]);
  });

  it("只掛在負責人欄位的人沒有任務(不再被當成 100%)", () => {
    const byUser = computeMemberTaskBreakdown([board], ["u1", "u2"]);
    expect(byUser.has("u2")).toBe(false);
  });
});
