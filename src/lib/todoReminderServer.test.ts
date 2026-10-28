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
  assigneeId?: string | null;
  itemId: string;
  item: { name: string };
};

type RiskTodo = {
  id: string;
  text: string;
  dueDate: string;
  remindedStage: number;
  createdById: string | null;
  assigneeId?: string | null;
  riskId: string;
  risk: { title: string; ownerId: string | null };
};

const state = {
  todos: [] as Todo[],
  claimable: true,
  claims: [] as { id: string; stage: number }[],
  personCells: [] as { value: unknown }[],
  assignments: [] as { userId: string }[],
  realUsers: ["u1", "u2", "u3"],
  inAppAllowed: true,
  notifications: [] as { userId: string; itemId?: string; riskId?: string; message: string; type: string; actorId: null }[],
  emails: [] as { userId: string; type: string; message: string }[],
  queries: [] as unknown[],
  riskTodos: [] as RiskTodo[],
  riskClaims: [] as { id: string; stage: number }[],
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
    riskTodo: {
      findMany: async () => state.riskTodos,
      updateMany: async ({ where, data }: { where: { id: string }; data: { remindedStage: number } }) => {
        if (!state.claimable) return { count: 0 };
        state.riskClaims.push({ id: where.id, stage: data.remindedStage });
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
  state.riskTodos = [];
  state.riskClaims = [];
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

describe("風險 / 議題的待辦事項", () => {
  const riskTodo = (id: string, dueDate: string, extra: Partial<RiskTodo> = {}): RiskTodo => ({
    id,
    text: `風險待辦 ${id}`,
    dueDate,
    remindedStage: 0,
    createdById: null,
    riskId: "r1",
    risk: { title: "供應商交期延遲", ownerId: "u1" },
    ...extra,
  });

  it("提醒風險的負責人與新增這個待辦事項的人,通知指到那一筆風險", async () => {
    state.riskTodos = [riskTodo("rt1", "2026-10-22", { createdById: "u3" })];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out).toMatchObject({ ran: true, todos: 1, notified: 2 });
    expect(state.notifications.map((n) => n.userId).sort()).toEqual(["u1", "u3"]);
    expect(state.notifications[0]).toMatchObject({ type: "DEADLINE", riskId: "r1", actorId: null });
    expect(state.notifications[0].message).toContain("風險 / 議題「供應商交期延遲」的待辦事項「風險待辦 rt1」");
    expect(state.notifications[0].message).toContain("明天(2026-10-22)到期");
    expect(state.riskClaims).toEqual([{ id: "rt1", stage: 1 }]);
  });

  it("同一階段只提醒一次,但會往下一階段走", async () => {
    state.riskTodos = [riskTodo("sent", "2026-10-22", { remindedStage: 1 }), riskTodo("next", "2026-10-21", { remindedStage: 1 })];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.riskClaims).toEqual([{ id: "next", stage: 2 }]);
  });

  it("沒有負責人也沒有人寫這個待辦事項:沒人可通知,但照樣標記", async () => {
    state.riskTodos = [riskTodo("rt1", "2026-10-21", { risk: { title: "x", ownerId: null } })];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out.notified).toBe(0);
    expect(state.riskClaims).toEqual([{ id: "rt1", stage: 2 }]);
  });

  it("別的 worker 先標了就不重複通知", async () => {
    state.claimable = false;
    state.riskTodos = [riskTodo("rt1", "2026-10-21")];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out.notified).toBe(0);
    expect(state.notifications).toEqual([]);
  });

  it("工作項的待辦事項提醒的說法不變", async () => {
    state.todos = [todo("t1", "2026-10-22")];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications[0].message).toContain("工作項目「vision box」的待辦事項");
  });
});

describe("處理者", () => {
  it("工作項的待辦事項有指定處理者:提醒他(加上寫這一筆的人),不再提醒工作項的負責人", async () => {
    state.todos = [todo("t1", "2026-10-22", { assigneeId: "u3", createdById: "u2" })];
    const out = await sendTodoDeadlineReminders(MORNING);
    expect(out.notified).toBe(2);
    expect(state.notifications.map((n) => n.userId).sort()).toEqual(["u2", "u3"]);
    // u1(人員欄位的負責人)沒有被打擾
    expect(state.notifications.map((n) => n.userId)).not.toContain("u1");
  });

  it("只有處理者、沒有人寫這一筆(寫的人是自己就只算一次)", async () => {
    state.todos = [todo("t1", "2026-10-22", { assigneeId: "u3", createdById: "u3" })];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications.map((n) => n.userId)).toEqual(["u3"]);
  });

  it("處理者的帳號已經不存在:只剩寫這一筆的人", async () => {
    state.todos = [todo("t1", "2026-10-22", { assigneeId: "gone", createdById: "u2" })];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications.map((n) => n.userId)).toEqual(["u2"]);
  });

  it("沒指定處理者照舊:工作項的負責人加寫的人", async () => {
    state.todos = [todo("t1", "2026-10-22", { createdById: "u3" })];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications.map((n) => n.userId).sort()).toEqual(["u1", "u2", "u3"]);
  });

  it("風險的待辦事項有指定處理者:提醒他,不是風險的負責人", async () => {
    state.riskTodos = [
      {
        id: "rt1",
        text: "風險待辦",
        dueDate: "2026-10-22",
        remindedStage: 0,
        createdById: null,
        assigneeId: "u3",
        riskId: "r1",
        risk: { title: "供應商交期延遲", ownerId: "u1" },
      },
    ];
    await sendTodoDeadlineReminders(MORNING);
    expect(state.notifications.map((n) => n.userId)).toEqual(["u3"]);
  });
});
