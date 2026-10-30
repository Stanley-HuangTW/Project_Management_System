import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: { emailNotificationsEnabled: true, enabledNotificationTypes: ["DEADLINE", "ASSIGNED"] } as { emailNotificationsEnabled: boolean; enabledNotificationTypes: string[] } | null,
  pref: null as null | { email: boolean },
  user: { email: "li@example.com" } as { email: string } | null,
  sent: [] as { to: string; subject: string; text: string }[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    systemSettings: { findUnique: async () => state.settings },
    notificationPreference: { findUnique: async () => state.pref },
    user: { findUnique: async () => state.user },
  },
}));
vi.mock("@/lib/mail", () => ({
  sendMail: async (to: string, subject: string, text: string) => {
    state.sent.push({ to, subject, text });
  },
}));

import { notifyEmailIfNeeded } from "@/lib/notify";

beforeEach(() => {
  state.settings = { emailNotificationsEnabled: true, enabledNotificationTypes: ["DEADLINE", "ASSIGNED"] };
  state.pref = null;
  state.user = { email: "li@example.com" };
  state.sent = [];
  vi.stubEnv("APP_BASE_URL", "https://pm.example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("notifyEmailIfNeeded", () => {
  it("sends the message alone when there is no link", async () => {
    await notifyEmailIfNeeded("u1", "ASSIGNED", "你被指派了");
    expect(state.sent).toEqual([{ to: "li@example.com", subject: "工作管理平台通知", text: "你被指派了" }]);
  });

  it("adds the full URL under the message when a link is given, so the reader can click straight through", async () => {
    await notifyEmailIfNeeded("u1", "DEADLINE", "待辦事項已經逾期", "/boards/b1?highlight=i1&highlightTab=checklist");
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0].text).toBe("待辦事項已經逾期\n\n開啟:https://pm.example.com/boards/b1?highlight=i1&highlightTab=checklist");
  });

  it("still honours every gate: email off for the site, the type, or the person", async () => {
    state.settings = { emailNotificationsEnabled: false, enabledNotificationTypes: ["DEADLINE"] };
    await notifyEmailIfNeeded("u1", "DEADLINE", "x", "/boards/b1");
    state.settings = { emailNotificationsEnabled: true, enabledNotificationTypes: ["ASSIGNED"] };
    await notifyEmailIfNeeded("u1", "DEADLINE", "x", "/boards/b1");
    state.settings = { emailNotificationsEnabled: true, enabledNotificationTypes: ["DEADLINE"] };
    state.pref = { email: false };
    await notifyEmailIfNeeded("u1", "DEADLINE", "x", "/boards/b1");
    expect(state.sent).toEqual([]);
  });
});
