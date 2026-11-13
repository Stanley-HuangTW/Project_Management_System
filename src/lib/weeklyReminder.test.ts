import { describe, expect, it } from "vitest";
import {
  buildReminderMail,
  formatClock,
  nextTrigger,
  programsByRecipient,
  reminderTime,
  reminderWeekKey,
  reminderWindow,
} from "./weeklyReminder";

// 台北牆上時間放在 UTC 欄位裡(見 weeklyReminder.ts),所以測試也這樣寫。
const at = (iso: string) => new Date(`${iso}:00Z`);
const MON_16 = { dow: 1, hour: 16, minute: 0 };

describe("nextTrigger", () => {
  it("is later this week when the day has not come yet", () => {
    expect(nextTrigger(at("2026-10-21T10:00"), MON_16).toISOString()).toBe("2026-10-26T16:00:00.000Z");
  });

  it("is the same day when the time has not come yet", () => {
    expect(nextTrigger(at("2026-10-26T15:59"), MON_16).toISOString()).toBe("2026-10-26T16:00:00.000Z");
  });

  it("is next week once the moment has arrived — exactly on it counts as passed", () => {
    expect(nextTrigger(at("2026-10-26T16:00"), MON_16).toISOString()).toBe("2026-11-02T16:00:00.000Z");
    expect(nextTrigger(at("2026-10-26T17:00"), MON_16).toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });

  it("handles a Sunday trigger (dow 0)", () => {
    expect(nextTrigger(at("2026-10-26T10:00"), { dow: 0, hour: 9, minute: 30 }).toISOString()).toBe("2026-11-01T09:30:00.000Z");
  });

  it("rejects a day of the week that does not exist", () => {
    expect(() => nextTrigger(at("2026-10-26T10:00"), { dow: 9, hour: 9, minute: 0 })).toThrow();
  });
});

describe("reminderWindow", () => {
  it("opens N hours before the trigger and stays open until it", () => {
    // 週一 16:00 觸發、提前 24 小時 → 週日 16:00 起
    expect(reminderWindow(at("2026-10-25T15:59"), MON_16, 24).due).toBe(false);
    expect(reminderWindow(at("2026-10-25T16:00"), MON_16, 24).due).toBe(true);
    expect(reminderWindow(at("2026-10-26T15:59"), MON_16, 24).due).toBe(true);
  });

  it("is closed again right after the trigger — the next round is a week away", () => {
    expect(reminderWindow(at("2026-10-26T16:00"), MON_16, 24).due).toBe(false);
  });

  it("points at the trigger the reminder is about", () => {
    const window = reminderWindow(at("2026-10-25T20:00"), MON_16, 24);
    expect(window.triggerAt.toISOString()).toBe("2026-10-26T16:00:00.000Z");
    expect(window.reminderAt.toISOString()).toBe("2026-10-25T16:00:00.000Z");
  });

  it("never fires with 0 hours", () => {
    expect(reminderWindow(at("2026-10-26T15:59"), MON_16, 0).due).toBe(false);
  });

  it("a long lead opens the window in the previous week", () => {
    // 週一 16:00 的前 72 小時 = 週五 16:00
    expect(reminderWindow(at("2026-10-23T15:59"), MON_16, 72).due).toBe(false);
    expect(reminderWindow(at("2026-10-23T16:00"), MON_16, 72).due).toBe(true);
  });
});

describe("reminderWeekKey", () => {
  it("a Sunday reminder and the Monday run it announces share one key", () => {
    const trigger = at("2026-10-26T16:00");
    expect(reminderWeekKey(trigger)).toBe("2026 W44");
  });
});

describe("reminderTime / formatClock", () => {
  it("counts back across the day boundary", () => {
    expect(formatClock(reminderTime(MON_16, 24))).toBe("週日 16:00");
    expect(formatClock(reminderTime({ dow: 1, hour: 6, minute: 0 }, 12))).toBe("週日 18:00");
    expect(formatClock(reminderTime({ dow: 1, hour: 0, minute: 30 }, 1))).toBe("週日 23:30");
  });

  it("wraps around the week", () => {
    expect(formatClock(reminderTime({ dow: 0, hour: 9, minute: 0 }, 12))).toBe("週六 21:00");
    expect(formatClock(reminderTime(MON_16, 168))).toBe("週一 16:00");
  });
});

describe("buildReminderMail", () => {
  const mail = buildReminderMail({
    triggerAt: at("2026-10-26T16:00"),
    hours: 24,
    range: { startDow: 2, endDow: 1 },
    baseUrl: "https://pm.example.com",
  });

  it("says when the report is generated, in the subject and the body", () => {
    expect(mail.subject).toContain("2026-10-26(週一)16:00");
    expect(mail.text).toContain("2026-10-26(週一)16:00");
  });

  it("says which period the report covers — the one the schedule will really report", () => {
    // 週二到週一的範圍,週一 16:00 報的是已經結束的上一個範圍
    expect(mail.text).toContain("2026-10-13(週二) ~ 2026-10-19(週一)");
  });

  it("asks people to update their work items and links to the system", () => {
    expect(mail.text).toContain("更新你負責的工作事項");
    expect(mail.text).toContain("https://pm.example.com");
    expect(mail.text).toContain("24 小時");
  });
});

describe("buildReminderMail with project names", () => {
  const base = { triggerAt: at("2026-10-26T16:00"), hours: 24, range: { startDow: 2, endDow: 1 }, baseUrl: "https://pm.example.com" };

  it("names the projects in the subject and the body", () => {
    const mail = buildReminderMail({ ...base, programNames: ["M3", "PS30"] });
    expect(mail.subject).toContain("M3、PS30");
    expect(mail.text).toContain("你所屬的專案:M3、PS30");
    expect(mail.text).toContain("2026-10-13(週二) ~ 2026-10-19(週一)");
    expect(mail.text).toContain("更新你負責的工作事項");
  });

  it("keeps the generic wording when there are no project names", () => {
    for (const programNames of [undefined, []]) {
      const mail = buildReminderMail({ ...base, programNames });
      expect(mail.subject).toBe("【週報提醒】週報將於 2026-10-26(週一)16:00 產生,請先更新你的工作事項");
      expect(mail.text).not.toContain("你所屬的專案");
    }
  });
});

describe("programsByRecipient", () => {
  const emails = new Map([
    ["u1", "u1@example.com"],
    ["u2", "u2@example.com"],
  ]);

  it("lists each person's projects once, in the order of the projects", () => {
    const result = programsByRecipient(
      [
        { name: "M3", userIds: ["u1", "u2"] },
        { name: "PS30", userIds: new Set(["u1"]) },
        { name: "M3 二期", userIds: ["u1", "u1"] },
      ],
      emails
    );
    expect(result.get("u1@example.com")).toEqual(["M3", "PS30", "M3 二期"]);
    expect(result.get("u2@example.com")).toEqual(["M3"]);
  });

  it("leaves out people who have no email, and people nobody listed", () => {
    const result = programsByRecipient([{ name: "M3", userIds: ["u1", "ghost"] }], emails);
    expect([...result.keys()]).toEqual(["u1@example.com"]);
  });

  it("collapses two accounts that share an email into one mail", () => {
    const shared = new Map([
      ["a", "x@example.com"],
      ["b", "x@example.com"],
    ]);
    const result = programsByRecipient(
      [
        { name: "M3", userIds: ["a"] },
        { name: "PS30", userIds: ["b"] },
      ],
      shared
    );
    expect(result.size).toBe(1);
    expect(result.get("x@example.com")).toEqual(["M3", "PS30"]);
  });
});
