import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardWithData } from "@/types/board";
import { computeLeaderOverview } from "./leaderOverview";
import type { ProjectScope } from "./projectRoles";

/** 專案負責人總覽:只造這支函式用得到的欄位。 */
const START = "c_start";
const DAYS = "c_days";
const STATUS = "c_status";
const PERSON = "c_person";

function item(id: string, start: string, days: number, status: "done" | "plan", assignees: string[], via: "assignment" | "person" = "assignment") {
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
      ...(via === "person" ? [{ columnId: PERSON, value: assignees }] : []),
    ],
    assignments: via === "assignment" ? assignees.map((userId) => ({ userId })) : [],
  };
}

function board(items: ReturnType<typeof item>[]): BoardWithData {
  return {
    id: "b1",
    name: "M28E",
    ganttStartColumnId: START,
    ganttDurationColumnId: DAYS,
    ganttDurationMode: "CALENDAR",
    progressColumnId: null,
    reportStatusColumnId: null,
    reportDoneOptionIds: [],
    columns: [
      { id: STATUS, name: "Status", type: "STATUS", order: 0, options: { options: [{ id: "done", label: "Completed", color: "#0f0" }, { id: "plan", label: "Planned", color: "#999" }] } },
      { id: PERSON, name: "負責人", type: "PERSON", order: 1, options: {} },
    ],
    groups: [{ id: "g1", name: "EVT" }],
    items,
  } as unknown as BoardWithData;
}

const nameOf = new Map([
  ["alice", "Alice"],
  ["bob", "Bob"],
]);

describe("computeLeaderOverview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 台灣時間 2026-10-12(週一)上午 11:00
    vi.setSystemTime(new Date("2026-10-12T03:00:00.000Z"));
  });
  afterEach(() => vi.useRealTimers());

  const b = () =>
    board([
      item("A", "2026-10-05", 3, "plan", ["alice"]), // 計畫 10/07,逾期
      item("B", "2026-10-12", 1, "plan", ["alice"]), // 今天到期 → 未來 7 天
      item("C", "2026-10-05", 3, "done", ["bob"]), // 這週切成完成
      item("D", "2026-10-01", 3, "done", ["bob"]), // 上週完成
      item("E", "2026-10-05", 3, "plan", []), // 逾期、沒人負責
      item("F", "2026-10-14", 2, "plan", ["alice", "bob"]), // 兩個人共同
      item("G", "2026-11-20", 3, "plan", ["bob"]), // 很久以後
    ]);
  const run = () => computeLeaderOverview([b()], nameOf, new Set(), { C: "2026-10-12T01:00:00.000Z", D: "2026-10-02T01:00:00.000Z" })[0];

  it("整個專案的逾期、本週完成、未來 7 天,每一筆寫出負責人", () => {
    const o = run();
    expect(o.boardName).toBe("M28E");
    expect(o.overdue.map((e) => [e.itemName, e.assignees])).toEqual([
      ["A", ["Alice"]],
      ["E", []],
    ]);
    expect(o.completedThisWeek.map((e) => [e.itemName, e.date])).toEqual([["C", "2026-10-12"]]);
    expect(o.upcoming7.map((e) => e.itemName)).toEqual(["B", "F"]);
    expect(o.overdue[0].date).toBe("2026-10-07");
    expect(o.overdue[0].groupName).toBe("EVT");
  });

  it("沒有人負責的逾期 / 近期項目另外數出來", () => {
    expect(run().unassignedCount).toBe(1);
  });

  it("每個人的時程:沒完成的數量、逾期、未來 7 天、最早開始到最晚完成", () => {
    const alice = run().people.find((p) => p.id === "alice")!;
    expect(alice).toMatchObject({ name: "Alice", open: 3, overdue: 1, upcoming7: 2, completedThisWeek: 0, spanStart: "2026-10-05", spanEnd: "2026-10-15" });
    const bob = run().people.find((p) => p.id === "bob")!;
    expect(bob).toMatchObject({ open: 2, overdue: 0, upcoming7: 1, completedThisWeek: 1, spanStart: "2026-10-14", spanEnd: "2026-11-22" });
  });

  it("共同負責的項目,每個人名下各有一份", () => {
    const o = run();
    expect(o.people.find((p) => p.id === "alice")!.items.map((i) => i.itemName)).toContain("F");
    expect(o.people.find((p) => p.id === "bob")!.items.map((i) => i.itemName)).toContain("F");
  });

  it("個人的項目:沒完成的依開始日排在前面,這週完成的排最後,更早完成的不列", () => {
    const bob = run().people.find((p) => p.id === "bob")!;
    expect(bob.items.map((i) => [i.itemName, i.kind])).toEqual([
      ["F", "notStarted"],
      ["G", "notStarted"],
      ["C", "done"],
    ]);
    expect(bob.items.some((i) => i.itemName === "D")).toBe(false);
  });

  it("人員排序:逾期最多的在最前面", () => {
    expect(run().people.map((p) => p.name)).toEqual(["Alice", "Bob"]);
  });

  it("負責人放在人員欄位(PERSON)也算,跟甘特的人員分配一樣", () => {
    const o = computeLeaderOverview([board([item("P", "2026-10-05", 3, "plan", ["bob"], "person")])], nameOf, new Set(), {})[0];
    expect(o.overdue[0].assignees).toEqual(["Bob"]);
    expect(o.people[0]).toMatchObject({ id: "bob", overdue: 1 });
  });

  it("人員被刪掉、名稱查不到:不會壞掉,寫(已刪除的使用者)", () => {
    const o = computeLeaderOverview([board([item("Z", "2026-10-05", 3, "plan", ["ghost"])])], nameOf, new Set(), {})[0];
    expect(o.people[0].name).toBe("(已刪除的使用者)");
  });

  describe("依角色篩範圍", () => {
    const done = { C: "2026-10-12T01:00:00.000Z", D: "2026-10-02T01:00:00.000Z" };
    const run = (scope: ProjectScope | null) => computeLeaderOverview([b()], nameOf, new Set(), done, () => scope)[0];
    const dm = (...ids: string[]): ProjectScope => ({ roles: ["SW_DM"], groups: new Map([["g1", new Set(ids)]]) });

    it("DM:只看自己組員(名單上的人)負責的工作項,別人的、沒人負責的都不算", () => {
      const o = run(dm("alice"));
      expect(o.overdue.map((e) => e.itemName)).toEqual(["A"]);
      expect(o.upcoming7.map((e) => e.itemName)).toEqual(["B", "F"]);
      expect(o.completedThisWeek).toEqual([]);
      expect(o.unassignedCount).toBe(0);
    });

    it("DM:人員清單只列名單上的人;跟外人共同負責的項目仍算,但外人不會出現成一列", () => {
      const o = run(dm("alice"));
      expect(o.people.map((p) => p.id)).toEqual(["alice"]);
      // F 是 alice 與 bob 共同負責:alice 名下有 F,清單上寫出兩個負責人
      expect(o.people[0].items.map((i) => i.itemName)).toContain("F");
      expect(o.upcoming7.find((e) => e.itemName === "F")!.assignees).toEqual(["Alice", "Bob"]);
    });

    it("名單有兩個人:兩個人的項目都算", () => {
      const o = run(dm("alice", "bob"));
      expect(o.people.map((p) => p.id).sort()).toEqual(["alice", "bob"]);
      expect(o.completedThisWeek.map((e) => e.itemName)).toEqual(["C"]);
    });

    it("整個分組(Team Leader / PMD)跟沒有範圍一樣", () => {
      const all: ProjectScope = { roles: ["TEAM_LEADER"], groups: new Map([["g1", "all" as const]]) };
      expect(run(all)).toEqual(run(null));
    });

    it("在這個分組沒有任何角色:什麼都不算", () => {
      const o = run({ roles: ["TEAM_LEADER"], groups: new Map([["別的分組", "all" as const]]) });
      expect(o.overdue).toEqual([]);
      expect(o.people).toEqual([]);
    });
  });

  it("沒有排程欄位的看板:不會當掉,只是沒有清單", () => {
    const noGantt = { ...board([item("X", "2026-10-05", 3, "plan", ["alice"])]), ganttStartColumnId: null, ganttDurationColumnId: null } as unknown as BoardWithData;
    const o = computeLeaderOverview([noGantt], nameOf, new Set(), {})[0];
    expect(o.overdue).toEqual([]);
    expect(o.people[0]).toMatchObject({ open: 1, spanStart: null, spanEnd: null });
  });
});
