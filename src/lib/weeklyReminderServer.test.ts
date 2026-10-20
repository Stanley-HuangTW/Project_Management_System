import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * 提醒信的流程:什麼時候寄、寄給誰、寄過了不重寄、全部失敗就放回去下次再試。
 * 資料庫與寄信換成記憶體版——行為在流程裡,不在 Postgres 或 SMTP 裡。
 */

const state = {
  subscriptions: 1,
  users: [{ email: "a@example.com" }, { email: "b@example.com" }, { email: "a@example.com" }],
  claimable: true,
  lastWeek: null as string | null,
  claims: [] as unknown[],
  sent: [] as { to: string; subject: string; text: string }[],
  mailOk: true,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    programReportSubscription: { count: async () => state.subscriptions },
    user: { findMany: async () => state.users },
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
  state.users = [{ email: "a@example.com" }, { email: "b@example.com" }, { email: "a@example.com" }];
  state.claimable = true;
  state.claims = [];
  state.sent = [];
  state.mailOk = true;
});

describe("sendWeeklyReportReminder", () => {
  it("mails every colleague once (duplicates collapsed) when the window is open", async () => {
    const out = await sendWeeklyReportReminder(settings, INSIDE);
    expect(out).toMatchObject({ sent: true, mailed: 2, failed: 0, week: "2026 W44" });
    expect(state.sent.map((m) => m.to)).toEqual(["a@example.com", "b@example.com"]);
    expect(state.sent[0].subject).toContain("2026-10-26(週一)16:00");
    expect(state.claims).toEqual(["2026 W44"]);
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
    expect(out).toMatchObject({ sent: false, mailed: 0, failed: 2 });
    // 先標成寄過(搶鎖),全部失敗再還原成原本的值
    expect(state.claims).toEqual(["2026 W44", null]);
  });
});
