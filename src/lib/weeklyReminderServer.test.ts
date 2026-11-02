import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 提醒信的流程:什麼時候寄、寄給誰(只寄給會寄週報的專案的成員)、寄過了不重寄、全部失敗就放回去下次再試。
 * 資料庫與寄信換成記憶體版——行為在流程裡,不在 Postgres 或 SMTP 裡。
 */

type Board = {
  id: string;
  ownerId: string;
  members: { userId: string }[];
  roleAssignments: { userId: string }[];
  groups: { members: { userId: string }[]; roleAssignments: { userId: string }[] }[];
};

const emptyBoard = (id: string, ownerId: string): Board => ({ id, ownerId, members: [], roleAssignments: [], groups: [] });

const state = {
  subscriptions: 1,
  programs: [] as { name: string; boards: Board[] }[],
  users: [] as { id: string; email: string | null }[],
  claimable: true,
  claims: [] as unknown[],
  sent: [] as { to: string; subject: string; text: string }[],
  mailOk: true,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    programReportSubscription: { count: async () => state.subscriptions },
    program: { findMany: async () => state.programs },
    // 刻意沒有 assignment、cellValue:被指派到工作項不算專案成員,誰去查它們這個測試就會直接壞掉。
    user: {
      findMany: async (args: { where: { id: { in: string[] } } }) => state.users.filter((u) => args.where.id.in.includes(u.id)),
    },
    systemSettings: {
      updateMany: async (args: { data: { weeklyReportReminderLastWeek: string | null } }) => {
        state.claims.push(args.data.weeklyReportReminderLastWeek);
        return { count: state.claimable ? 1 : 0 };
      },
    },
  },
}));

vi.mock("@/lib/mail", () => ({
  sendMailChecked: async (to: string, subject: string, text: string) => {
    if (!state.mailOk) return { ok: false, reason: "SMTP 未設定" };
    state.sent.push({ to, subject, text });
    return { ok: true };
  },
}));

const { sendWeeklyReportReminder } = await import("@/lib/weeklyReminderServer");

const settings = {
  weeklyReportEnabled: true,
  weeklyReportDow: 1,
  weeklyReportHour: 16,
  weeklyReportMinute: 0,
  weeklyReportRangeStartDow: 3,
  weeklyReportRangeEndDow: 2,
  weeklyReportLastRunWeek: null as string | null,
  weeklyReportReminderHours: 24,
  weeklyReportReminderLastWeek: null as string | null,
};

// 台北週日 17:00(= UTC 09:00):週一 16:00 的前 24 小時已經開始
const INSIDE = new Date("2026-10-25T09:00:00Z");
// 台北週六 17:00:還早
const TOO_EARLY = new Date("2026-10-24T09:00:00Z");

beforeEach(() => {
  state.subscriptions = 1;
  // M3:擁有者 owner、看板成員 member、分組成員 grouper、分組 Team Leader tl。
  // assignee、cellowner 只被指派到 M3 的工作項(人員分配、負責人欄),不在上面任何名單裡。
  // PS30:只有 member(跟 M3 重疊的人)與 ps30only。
  state.programs = [
    {
      name: "M3",
      boards: [
        {
          ...emptyBoard("b-m3", "owner"),
          members: [{ userId: "member" }],
          groups: [{ members: [{ userId: "grouper" }], roleAssignments: [{ userId: "tl" }] }],
        },
      ],
    },
    { name: "PS30", boards: [{ ...emptyBoard("b-ps30", "owner"), members: [{ userId: "member" }, { userId: "ps30only" }] }] },
  ];
  state.users = [
    "owner",
    "member",
    "grouper",
    "tl",
    "assignee",
    "cellowner",
    "ps30only",
    "sophie", // 不在任何專案裡的同仁
  ].map((id) => ({ id, email: `${id}@example.com` }));
  state.claimable = true;
  state.claims = [];
  state.sent = [];
  state.mailOk = true;
});

describe("sendWeeklyReportReminder", () => {
  it("mails the members of the projects that send a report — and nobody else", async () => {
    const out = await sendWeeklyReportReminder(settings, INSIDE);
    expect(out).toMatchObject({ sent: true, failed: 0, week: "2026 W44" });
    const to = state.sent.map((m) => m.to).sort();
    expect(to).toEqual(["grouper", "member", "owner", "ps30only", "tl"].map((id) => `${id}@example.com`).sort());
    expect(to).not.toContain("sophie@example.com");
    expect(state.claims).toEqual(["2026 W44"]);
  });

  it("says which project the person belongs to, in the subject and the body", async () => {
    await sendWeeklyReportReminder(settings, INSIDE);
    const grouper = state.sent.find((m) => m.to === "grouper@example.com")!;
    expect(grouper.subject).toContain("M3");
    expect(grouper.subject).not.toContain("PS30");
    expect(grouper.subject).toContain("2026-10-26(週一)16:00");
    expect(grouper.text).toContain("你所屬的專案:M3");
    const only = state.sent.find((m) => m.to === "ps30only@example.com")!;
    expect(only.subject).toContain("PS30");
    expect(only.subject).not.toContain("M3");
  });

  it("being assigned to an item is not enough to count as a project member", async () => {
    await sendWeeklyReportReminder(settings, INSIDE);
    const to = state.sent.map((m) => m.to);
    expect(to).not.toContain("assignee@example.com");
    expect(to).not.toContain("cellowner@example.com");
  });

  it("someone in two projects gets one mail that names both", async () => {
    await sendWeeklyReportReminder(settings, INSIDE);
    const mine = state.sent.filter((m) => m.to === "member@example.com");
    expect(mine).toHaveLength(1);
    expect(mine[0].subject).toContain("M3、PS30");
    expect(mine[0].text).toContain("你所屬的專案:M3、PS30");
  });

  it("a project whose report has no recipients does not pull its members into the reminder", async () => {
    // 查詢本身就只取「有設定收件人」的專案(見 loadSubscribedProgramMembers 的 where);
    // 這裡確認:只剩一個專案時,另一個專案的人不會被提醒。
    state.programs = state.programs.filter((p) => p.name === "PS30");
    await sendWeeklyReportReminder(settings, INSIDE);
    expect(state.sent.map((m) => m.to).sort()).toEqual(["member@example.com", "owner@example.com", "ps30only@example.com"]);
  });

  it("skips members without an email address", async () => {
    state.users = state.users.map((u) => (u.id === "tl" ? { ...u, email: null } : u));
    await sendWeeklyReportReminder(settings, INSIDE);
    expect(state.sent.map((m) => m.to)).not.toContain("tl@example.com");
    expect(state.sent.length).toBe(4);
  });

  it("does not use up the round when there is nobody to remind", async () => {
    state.programs = [{ name: "M3", boards: [] }];
    const out = await sendWeeklyReportReminder(settings, INSIDE);
    expect(out).toMatchObject({ sent: false, reason: "會寄週報的專案裡沒有可以提醒的成員" });
    expect(state.sent).toEqual([]);
    expect(state.claims).toEqual([]);
  });

  it("says nothing before the window opens", async () => {
    const out = await sendWeeklyReportReminder(settings, TOO_EARLY);
    expect(out).toMatchObject({ sent: false, reason: "還沒到提醒時間" });
    expect(state.sent).toEqual([]);
    expect(state.claims).toEqual([]);
  });

  it("is off by default (0 hours) and when the schedule itself is off", async () => {
    expect((await sendWeeklyReportReminder({ ...settings, weeklyReportReminderHours: 0 }, INSIDE)).sent).toBe(false);
    expect((await sendWeeklyReportReminder({ ...settings, weeklyReportEnabled: false }, INSIDE)).sent).toBe(false);
    expect(state.sent).toEqual([]);
  });

  it("does not mail twice for the same round", async () => {
    const out = await sendWeeklyReportReminder({ ...settings, weeklyReportReminderLastWeek: "2026 W44" }, INSIDE);
    expect(out).toMatchObject({ sent: false, reason: "這一輪已經提醒過了" });
    expect(state.sent).toEqual([]);
  });

  it("loses gracefully when another tick claimed the round first", async () => {
    state.claimable = false;
    const out = await sendWeeklyReportReminder(settings, INSIDE);
    expect(out).toMatchObject({ sent: false, reason: "被搶先寄過了" });
    expect(state.sent).toEqual([]);
  });

  it("does not promise a report that nobody will receive", async () => {
    state.subscriptions = 0;
    const out = await sendWeeklyReportReminder(settings, INSIDE);
    expect(out).toMatchObject({ sent: false, reason: "沒有任何專案設定週報收件人" });
    expect(state.sent).toEqual([]);
    expect(state.claims).toEqual([]);
  });

  it("puts the round back when not a single mail got out, so the next tick tries again", async () => {
    state.mailOk = false;
    const out = await sendWeeklyReportReminder(settings, INSIDE);
    expect(out).toMatchObject({ sent: false, mailed: 0, failed: 5 });
    // 先標成寄過(搶鎖),全部失敗再還原成原本的值
    expect(state.claims).toEqual(["2026 W44", null]);
  });
});
