import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 待辦事項期限提醒的流程:什麼時候提醒、提醒給誰、同一階段只提醒一次。
 * 資料庫與通知換成記憶體版——行為在流程裡,不在 Postgres 或 SMTP 裡。
 */

type Todo = {
  id: string;
  text: string;
  dueDate: string;
  remindedStage: number;
  createdById: string | null;
  itemId: string;
  item: { name: string };
};

const state = {
  todos: [] as Todo[],
  claimable: true,
  claims: [] as { id: string; stage: number }[],
  personCells: [] as { value: unknown }[],
  assignments: [] as { userId: string }[],
  realUsers: ["u1", "u2", "u3"],
  inAppAllowed: true,
  notifications: [] as { userId: string; itemId: string; message: string; type: string; actorId: null }[],
  emails: [] as { userId: string; type: string; message: string }[],
  queries: [] as unknown[],
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    todoItem: {
      findMany: async (args: unknown) => {
        state.queries.push(args);
        return state.todos;
      },
      updateMany: async ({ where, data }: { where: { id: string }; data: { remindedStage: number } }) => {
        if (!state.claimable) return { count: 0 };
        state.claims.push({ id: where.id, stage: data.remindedStage });
        return { count: 1 };
      },
    },
    cellValue: { findMany: async () => state.personCells },
    assignment: { findMany: async () => state.assignments },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => state.realUsers.includes(id)).map((id) => ({ id })),
    },
    notification: {
      createMany: async ({ data }: { data: (typeof state.notifications)[number][] }) => {
        state.notifications.push(...data);
        return { count: data.length };
      },
    },
  },
}));

vi.mock("@/lib/notify", () => ({
  filterInAppRecipients: async (_tx: unknown, _type: string, ids: string[]) => (state.inAppAllowed ? ids : []),
  notifyEmailIfNeeded: async (userId: string, type: string, message: string) => {
    state.emails.push({ userId, type, message });
  },
}));

const { sendTodoDeadlineReminders } = await import("@/lib/todoReminderServer");

// 台北 2026-10-21 10:00(= UTC 02:00):已經過了早上 9 點
const MORNING = new Date("2026-10-21T02:00:00Z");
// 台北 2026-10-21 08:00(= UTC 00:00):還沒到
const TOO_EARLY = new Date("2026-10-21T00:00:00Z");

const todo = (id: string, dueDate: string, extra: Partial<Todo> = {}): Todo => ({
  id,
  text: `待辦 ${id}`,
  dueDate,
  remindedStage: 0,
  createdById: null,
  itemId: "i1",
  item: { name: "vision box" },
  ...extra,
});

beforeEach(() => {
  state.todos = [];
  state.claimable = true;
  state.claims = [];
  state.personCells = [{ value: ["u1"] }];
  state.assignments = [{ userId: "u2" }];
  state.realUsers = ["u1", "u2", "u3"];
  state.inAppAllowed = true;
  state.notifications = [];
  state.emails = [];
  state.queries = [];
});

describe("sendTodoDeadlineReminders", () => {
  it("stays quiet before 9am Taipei — and does not even look at the database", async () => {
    state.todos = [todo("t1", "2026-10-21")];
    const out = await sendTodoDeadlineReminders(TOO_EARLY);
    expect(out.ran).toBe(false);
    expect(state.queries).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  it("only asks for open todos due by tomorrow that have not had their last reminder", async () => {
    await sendTodoDeadlineReminders(MORNING);
    expect(state.queries[0]).toMatchObject({
      where: { done: false, remindedStage: { lt: 3 }, dueDate: { not: null, lte: "2026-10-22" }, item: { deletedAt: null } },
    });
  });

  it("reminds the item's assignees and whoever wrote the todo, once each", async () => {
    state.todos = [todo("t1", "2026-10-22", { createdById: "u3" })]; // 明天到期
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out).toMatchObject({ ran: true, todos: 1, notified: 3 });
    expect(state.notifications.map((n) => n.userId).sort()).toEqual(["u1", "u2", "u3"]);
    expect(state.notifications[0]).toMatchObject({ type: "DEADLINE", itemId: "i1", actorId: null });
    expect(state.notifications[0].message).toContain("明天(2026-10-22)到期");
    expect(state.notifications[0].message).toContain("待辦事項「待辦 t1」");
    expect(state.emails.map((e) => e.userId).sort()).toEqual(["u1", "u2", "u3"]);
    expect(state.claims).toEqual([{ id: "t1", stage: 1 }]);
  });

  it("says today / overdue at the right stage", async () => {
    state.todos = [todo("today", "2026-10-21"), todo("late", "2026-10-18")];
    await sendTodoDeadlineReminders(MORNING);
    const messages = state.notifications.map((n) => n.message);
    expect(messages.some((m) => m.includes("待辦 today") && m.includes("今天(2026-10-21)到期"))).toBe(true);
    expect(messages.some((m) => m.includes("待辦 late") && m.includes("已經逾期(期限 2026-10-18)"))).toBe(true);
    expect(state.claims).toEqual([
      { id: "today", stage: 2 },
      { id: "late", stage: 3 },
    ]);
  });

  it("does not repeat a stage that was already sent, but does move on to the next one", async () => {
    state.todos = [
      todo("sent", "2026-10-22", { remindedStage: 1 }), // 明天到期、已經提醒過「明天」
      todo("next", "2026-10-21", { remindedStage: 1 }), // 昨天提醒過「明天」,今天該提醒「今天」
    ];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.claims).toEqual([{ id: "next", stage: 2 }]);
  });

  it("skips a todo whose deadline is still days away", async () => {
    state.todos = [todo("far", "2026-10-30")];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out).toMatchObject({ ran: true, notified: 0 });
    expect(state.claims).toEqual([]);
  });

  it("does not notify twice when another worker claimed the stage first", async () => {
    state.claimable = false;
    state.todos = [todo("t1", "2026-10-21")];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out.notified).toBe(0);
    expect(state.notifications).toEqual([]);
    expect(state.emails).toEqual([]);
  });

  it("leaves out people-columns entries that are not accounts (tools, vendors)", async () => {
    state.personCells = [{ value: ["u1", "resource-1"] }];
    state.assignments = [];
    state.todos = [todo("t1", "2026-10-21")];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications.map((n) => n.userId)).toEqual(["u1"]);
  });

  it("an item nobody is assigned to and nobody wrote the todo for notifies no one, but is still marked", async () => {
    state.personCells = [];
    state.assignments = [];
    state.todos = [todo("t1", "2026-10-21")];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out.notified).toBe(0);
    expect(state.claims).toEqual([{ id: "t1", stage: 2 }]);
  });

  it("email is decided separately from the in-app switch", async () => {
    state.inAppAllowed = false; // 站內通知被關掉
    state.todos = [todo("t1", "2026-10-21")];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications).toEqual([]);
    expect(state.emails.map((e) => e.userId).sort()).toEqual(["u1", "u2"]);
  });
});
