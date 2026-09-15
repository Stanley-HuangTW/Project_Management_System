import { describe, expect, it } from "vitest";
import { groupTasksByBoardAndGroup } from "./workload";

describe("groupTasksByBoardAndGroup", () => {
  const task = (boardId: string, boardName: string, groupId: string, groupName: string, itemId: string) => ({
    boardId,
    boardName,
    groupId,
    groupName,
    itemId,
    itemName: itemId,
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
