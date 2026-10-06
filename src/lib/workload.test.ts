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

describe("computeMemberTaskBreakdown", () => {
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
  const pcts = (byUser: ReturnType<typeof computeMemberTaskBreakdown>, id: string) =>
    byUser.get(id)?.map((t) => t.allocationPct);

  it("被分配的人照人員分配的百分比", () => {
    expect(pcts(computeMemberTaskBreakdown([board], ["u1", "u2"]), "u1")).toEqual([30]);
  });

  it("只掛在負責人欄位的人:預設算 2%,不是 100%", () => {
    expect(pcts(computeMemberTaskBreakdown([board], ["u1", "u2"]), "u2")).toEqual([2]);
  });

  it("預設比例可以改(系統設定),0 代表不計入", () => {
    expect(pcts(computeMemberTaskBreakdown([board], ["u2"], new Set(), 5), "u2")).toEqual([5]);
    expect(computeMemberTaskBreakdown([board], ["u2"], new Set(), 0).has("u2")).toBe(false);
  });

  it("負責人同時有人員分配:只出現一次,百分比是人員分配的", () => {
    const withBoth = {
      ...board,
      items: [{ ...board.items[0], assignments: [{ userId: "u2", allocationPct: 25 }] }],
    } as unknown as BoardWithData;
    expect(pcts(computeMemberTaskBreakdown([withBoth], ["u2"]), "u2")).toEqual([25]);
  });
});
