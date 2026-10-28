import { describe, expect, it } from "vitest";
import type { BoardWithData } from "@/types/board";
import {
  daysUntil,
  deadlineStage,
  describeDeadline,
  formatDueShort,
  isValidDueDate,
  reminderMessage,
  taipeiClock,
  todoDeadlineEntries,
} from "./todoDeadline";

describe("isValidDueDate", () => {
  it("accepts a real calendar date and nothing else", () => {
    expect(isValidDueDate("2026-10-28")).toBe(true);
    expect(isValidDueDate("2026-02-30")).toBe(false);
    expect(isValidDueDate("2026-13-01")).toBe(false);
    expect(isValidDueDate("2026-1-5")).toBe(false);
    expect(isValidDueDate("")).toBe(false);
    expect(isValidDueDate(null)).toBe(false);
    expect(isValidDueDate(20261028)).toBe(false);
  });
});

describe("taipeiClock", () => {
  it("is eight hours ahead of UTC, and the date follows", () => {
    expect(taipeiClock(new Date("2026-10-21T01:30:00Z"))).toEqual({ date: "2026-10-21", hour: 9 });
    expect(taipeiClock(new Date("2026-10-21T16:30:00Z"))).toEqual({ date: "2026-10-22", hour: 0 });
  });
});

describe("deadlineStage / daysUntil", () => {
  it("counts whole calendar days", () => {
    expect(daysUntil("2026-10-21", "2026-10-21")).toBe(0);
    expect(daysUntil("2026-10-21", "2026-10-28")).toBe(7);
    expect(daysUntil("2026-10-21", "2026-10-19")).toBe(-2);
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("is 0 until the day before, then 1 / 2 / 3", () => {
    expect(deadlineStage("2026-10-21", "2026-10-23")).toBe(0);
    expect(deadlineStage("2026-10-21", "2026-10-22")).toBe(1);
    expect(deadlineStage("2026-10-21", "2026-10-21")).toBe(2);
    expect(deadlineStage("2026-10-21", "2026-10-20")).toBe(3);
    expect(deadlineStage("2026-10-21", "2026-01-01")).toBe(3);
  });
});

describe("describeDeadline", () => {
  it("says how far away it is, with a tone for colouring", () => {
    expect(describeDeadline("2026-10-21", "2026-10-18")).toEqual({ text: "逾期 3 天", tone: "overdue" });
    expect(describeDeadline("2026-10-21", "2026-10-21")).toEqual({ text: "今天到期", tone: "today" });
    expect(describeDeadline("2026-10-21", "2026-10-22")).toEqual({ text: "明天到期", tone: "soon" });
    expect(describeDeadline("2026-10-21", "2026-10-26")).toEqual({ text: "5 天後", tone: "later" });
  });
});

describe("formatDueShort / reminderMessage", () => {
  it("drops the year and the leading zeros", () => {
    expect(formatDueShort("2026-10-08")).toBe("10/8");
    expect(formatDueShort("2026-12-31")).toBe("12/31");
  });

  it("names the work item, the todo and the date for each stage", () => {
    const args = { itemName: "vision box ID 新設計", todoText: "送樣確認", dueDate: "2026-10-28" };
    expect(reminderMessage(1, args)).toBe("工作項目「vision box ID 新設計」的待辦事項「送樣確認」明天(2026-10-28)到期");
    expect(reminderMessage(2, args)).toContain("今天(2026-10-28)到期");
    expect(reminderMessage(3, args)).toContain("已經逾期(期限 2026-10-28)");
  });
});

describe("todoDeadlineEntries", () => {
  const board = {
    id: "b1",
    name: "M28E",
    groups: [{ id: "g1", name: "分組一" }],
    columns: [{ id: "owner", type: "PERSON" }],
    items: [
      { id: "i1", name: "B 項目", groupId: "g1", assignments: [{ userId: "u1" }], cellValues: [] },
      { id: "i2", name: "A 項目", groupId: "g1", assignments: [], cellValues: [{ columnId: "owner", value: ["u2"] }] },
      { id: "i3", name: "沒人負責", groupId: "g1", assignments: [], cellValues: [] },
    ],
  } as unknown as BoardWithData;

  const todo = (id: string, itemId: string, dueDate: string | null, extra: Partial<{ done: boolean; createdById: string | null }> = {}) => ({
    id,
    itemId,
    text: `待辦 ${id}`,
    dueDate,
    done: extra.done ?? false,
    createdById: extra.createdById ?? null,
  });

  it("lists open todos with a deadline, nearest first", () => {
    const rows = todoDeadlineEntries(
      [board],
      [todo("t1", "i1", "2026-11-05"), todo("t2", "i2", "2026-10-30"), todo("t3", "i1", "2026-10-30")],
      undefined
    );
    expect(rows.map((r) => r.todoId)).toEqual(["t2", "t3", "t1"]); // 同一天照工作項目名稱排
    expect(rows[0]).toMatchObject({ itemName: "A 項目", boardName: "M28E", groupName: "分組一", dueDate: "2026-10-30" });
  });

  it("skips done todos, todos without a deadline, and items the person cannot see", () => {
    const rows = todoDeadlineEntries(
      [board],
      [todo("t1", "i1", null), todo("t2", "i1", "2026-10-30", { done: true }), todo("t3", "gone", "2026-10-30")],
      undefined
    );
    expect(rows).toEqual([]);
  });

  it("for one person: items assigned to them (assignment or person column) and todos they wrote", () => {
    const todos = [
      todo("t1", "i1", "2026-10-30"), // u1 的指派
      todo("t2", "i2", "2026-10-30"), // u2 的負責人欄位
      todo("t3", "i3", "2026-10-30", { createdById: "u1" }), // 沒人負責,但 u1 自己寫的
      todo("t4", "i3", "2026-10-30"), // 跟 u1 無關
    ];
    expect(todoDeadlineEntries([board], todos, ["u1"]).map((r) => r.todoId).sort()).toEqual(["t1", "t3"]);
    expect(todoDeadlineEntries([board], todos, ["u2"]).map((r) => r.todoId)).toEqual(["t2"]);
    expect(todoDeadlineEntries([board], todos, ["u1", "u2"]).map((r) => r.todoId).sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("a todo assigned to someone shows in their list even when the item is not theirs", () => {
    const assigned = { ...todo("t1", "i3", "2026-10-30"), assigneeId: "u9" }; // i3 沒人負責,指定 u9 處理
    expect(todoDeadlineEntries([board], [assigned], ["u9"]).map((r) => r.todoId)).toEqual(["t1"]);
    expect(todoDeadlineEntries([board], [assigned], ["u1"])).toEqual([]);
  });
});
