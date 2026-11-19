import { describe, expect, it } from "vitest";
import type { ProgramTask } from "@/lib/programView";
import {
  EMPTY_PROGRAM_FILTER,
  NO_VALUE,
  computeProgramVisibleIds,
  isProgramFilterActive,
  parseStoredProgramFilter,
} from "./programFilter";

function task(id: string, over: Partial<ProgramTask> = {}): ProgramTask {
  return {
    id,
    name: id,
    boardId: "b1",
    boardName: "B1",
    groupName: "G",
    groupId: "g1",
    depth: 0,
    parentId: null,
    wbsCode: "1",
    start: "2026-01-01",
    end: "2026-01-02",
    isSummary: false,
    isMilestone: false,
    type: "Task",
    assigneeNames: [],
    assigneeIds: [],
    status: null,
    preds: [],
    totalFloat: null,
    isCritical: false,
    priority: null,
    ...over,
  };
}

const tasks = [
  task("phase", { type: "Summary", isSummary: true }),
  task("a", { parentId: "phase", depth: 1, type: "Task", assigneeIds: ["u1"], status: "進行中" }),
  task("m1", { parentId: "phase", depth: 1, type: "Milestone", isMilestone: true, status: "完成" }),
  task("m2", { type: "Milestone", isMilestone: true, boardId: "b2" }),
  task("untyped", { type: null }),
];

describe("computeProgramVisibleIds", () => {
  it("沒有任何篩選就全部顯示(null)", () => {
    expect(computeProgramVisibleIds(tasks, EMPTY_PROGRAM_FILTER)).toBeNull();
    expect(isProgramFilterActive(EMPTY_PROGRAM_FILTER)).toBe(false);
  });

  it("只看 Milestone:留下符合的項目與它們的上層,其他不留", () => {
    const ids = computeProgramVisibleIds(tasks, { ...EMPTY_PROGRAM_FILTER, type: ["Milestone"] });
    expect([...ids!].sort()).toEqual(["m1", "m2", "phase"]);
  });

  it("同一欄多個值是「或者」", () => {
    const ids = computeProgramVisibleIds(tasks, { ...EMPTY_PROGRAM_FILTER, type: ["Milestone", "Task"] });
    expect([...ids!].sort()).toEqual(["a", "m1", "m2", "phase"]);
  });

  it("不同欄位之間是「而且」", () => {
    const ids = computeProgramVisibleIds(tasks, {
      ...EMPTY_PROGRAM_FILTER,
      type: ["Milestone"],
      status: ["完成"],
    });
    expect([...ids!].sort()).toEqual(["m1", "phase"]);
  });

  it("沒填的值可以用 NO_VALUE 找出來", () => {
    const ids = computeProgramVisibleIds(tasks, { ...EMPTY_PROGRAM_FILTER, type: [NO_VALUE] });
    expect([...ids!]).toEqual(["untyped"]);
    const unassigned = computeProgramVisibleIds(tasks, { ...EMPTY_PROGRAM_FILTER, assignee: [NO_VALUE] });
    expect(unassigned!.has("a")).toBe(false);
    expect(unassigned!.has("m1")).toBe(true);
  });

  it("負責人有多位時,任何一位符合就算", () => {
    const multi = [task("x", { assigneeIds: ["u1", "u2"] }), task("y", { assigneeIds: ["u3"] })];
    const ids = computeProgramVisibleIds(multi, { ...EMPTY_PROGRAM_FILTER, assignee: ["u2"] });
    expect([...ids!]).toEqual(["x"]);
  });

  it("壞資料的循環 parentId 不會卡死", () => {
    const loop = [task("p", { parentId: "q" }), task("q", { parentId: "p" })];
    const ids = computeProgramVisibleIds(loop, { ...EMPTY_PROGRAM_FILTER, type: ["Task"] });
    expect([...ids!].sort()).toEqual(["p", "q"]);
  });
});

describe("parseStoredProgramFilter", () => {
  it("讀不到或壞掉的內容回空篩選", () => {
    expect(parseStoredProgramFilter(null)).toEqual(EMPTY_PROGRAM_FILTER);
    expect(parseStoredProgramFilter("{oops")).toEqual(EMPTY_PROGRAM_FILTER);
    expect(parseStoredProgramFilter("null")).toEqual(EMPTY_PROGRAM_FILTER);
  });

  it("只收字串陣列,其餘欄位忽略", () => {
    expect(parseStoredProgramFilter(JSON.stringify({ type: ["Milestone", 3], status: "x", extra: ["y"] }))).toEqual({
      ...EMPTY_PROGRAM_FILTER,
      type: ["Milestone"],
    });
  });
});
