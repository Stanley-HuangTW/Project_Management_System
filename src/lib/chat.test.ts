import { describe, expect, it } from "vitest";
import {
  MAX_GROUP_TITLE_LENGTH,
  MAX_MESSAGE_LENGTH,
  clockLabel,
  conversationTitle,
  dayKey,
  dayLabel,
  directNotificationText,
  dmKeyOf,
  formatSseEvent,
  mentionNotificationText,
  normalizeGroupTitle,
  normalizeMessageBody,
  planChatNotifications,
  snippet,
  startsNewRun,
} from "./chat";

describe("dmKeyOf", () => {
  it("is the same pair whoever opens it", () => {
    expect(dmKeyOf("u_b", "u_a")).toBe("u_a:u_b");
    expect(dmKeyOf("u_a", "u_b")).toBe(dmKeyOf("u_b", "u_a"));
  });
});

describe("normalizeMessageBody", () => {
  it("trims and normalizes line endings", () => {
    expect(normalizeMessageBody("  hi\r\nthere \n")).toEqual({ body: "hi\nthere" });
  });

  it("refuses an empty message", () => {
    expect(normalizeMessageBody("   \n ")).toEqual({ error: "訊息不可為空" });
  });

  it("refuses a message over the limit but takes one at the limit", () => {
    expect(normalizeMessageBody("a".repeat(MAX_MESSAGE_LENGTH))).toEqual({ body: "a".repeat(MAX_MESSAGE_LENGTH) });
    expect(normalizeMessageBody("a".repeat(MAX_MESSAGE_LENGTH + 1))).toHaveProperty("error");
  });
});

describe("normalizeGroupTitle", () => {
  it("trims, refuses empty and refuses too long", () => {
    expect(normalizeGroupTitle("  DVT 試作 ")).toEqual({ title: "DVT 試作" });
    expect(normalizeGroupTitle("  ")).toHaveProperty("error");
    expect(normalizeGroupTitle("x".repeat(MAX_GROUP_TITLE_LENGTH + 1))).toHaveProperty("error");
  });
});

describe("snippet", () => {
  it("flattens whitespace and truncates", () => {
    expect(snippet("a\n\n  b   c")).toBe("a b c");
    expect(snippet("x".repeat(70), 60)).toBe(`${"x".repeat(60)}…`);
    expect(snippet("x".repeat(60), 60)).toBe("x".repeat(60));
  });
});

describe("startsNewRun", () => {
  const at = (iso: string) => ({ authorId: "a", createdAt: iso });

  it("starts a run on the first message", () => {
    expect(startsNewRun(null, at("2026-10-22T02:00:00.000Z"))).toBe(true);
  });

  it("joins the same author's messages sent close together", () => {
    expect(startsNewRun(at("2026-10-22T02:00:00.000Z"), at("2026-10-22T02:04:59.000Z"))).toBe(false);
  });

  it("starts a new run for another author, a long gap, or another day", () => {
    expect(startsNewRun(at("2026-10-22T02:00:00.000Z"), { authorId: "b", createdAt: "2026-10-22T02:00:30.000Z" })).toBe(true);
    expect(startsNewRun(at("2026-10-22T02:00:00.000Z"), at("2026-10-22T02:05:01.000Z"))).toBe(true);
    // 23:59 and 00:01 Taipei time are two minutes apart but on different days.
    expect(startsNewRun(at("2026-10-22T15:59:00.000Z"), at("2026-10-22T16:01:00.000Z"))).toBe(true);
  });
});

describe("day and clock labels (Taipei time)", () => {
  it("dayKey rolls over at midnight in Taipei, not UTC", () => {
    expect(dayKey("2026-10-22T15:59:00.000Z")).toBe("2026-10-22");
    expect(dayKey("2026-10-22T16:00:00.000Z")).toBe("2026-10-23");
  });

  it("clockLabel is HH:mm in Taipei time", () => {
    expect(clockLabel("2026-10-22T02:05:00.000Z")).toBe("10:05");
    expect(clockLabel("2026-10-22T16:30:00.000Z")).toBe("00:30");
  });

  it("dayLabel says today, yesterday, then the date (with the year only across years)", () => {
    const now = new Date("2026-10-22T04:00:00.000Z");
    expect(dayLabel("2026-10-22T01:00:00.000Z", now)).toBe("今天");
    expect(dayLabel("2026-10-21T08:00:00.000Z", now)).toBe("昨天");
    expect(dayLabel("2026-10-05T08:00:00.000Z", now)).toBe("10/5");
    expect(dayLabel("2025-12-31T08:00:00.000Z", now)).toBe("2025/12/31");
  });
});

describe("conversationTitle", () => {
  it("names a DM after the other person, a channel after its board, a group after itself", () => {
    expect(conversationTitle({ kind: "DM", title: null, boardName: null, otherName: "Schumi Su" })).toBe("Schumi Su");
    expect(conversationTitle({ kind: "BOARD", title: null, boardName: "M28E", otherName: null })).toBe("M28E");
    expect(conversationTitle({ kind: "GROUP", title: "DVT 試作", boardName: null, otherName: null })).toBe("DVT 試作");
  });

  it("has a fallback when the other person is gone", () => {
    expect(conversationTitle({ kind: "DM", title: null, boardName: null, otherName: null })).toBe("(已刪除的使用者)");
  });
});

describe("formatSseEvent", () => {
  it("writes the event name and a one-line JSON body ended by a blank line", () => {
    const text = formatSseEvent({ type: "message", c: "conv1", u: "u1", m: "m1" });
    expect(text).toBe('event: message\ndata: {"type":"message","c":"conv1","u":"u1","m":"m1"}\n\n');
  });
});

describe("planChatNotifications", () => {
  const base = { conversationName: "DVT 試作", actorId: "a", actorName: "Alex", memberIds: ["a", "b", "c"], mentionedIds: [] as string[], alreadyUnread: new Set<string>() };

  it("tells every other member of a group or DM, but not the sender", () => {
    expect(planChatNotifications({ ...base, kind: "GROUP" })).toEqual([
      { userId: "b", message: "Alex 在「DVT 試作」有新訊息" },
      { userId: "c", message: "Alex 在「DVT 試作」有新訊息" },
    ]);
    expect(planChatNotifications({ ...base, kind: "DM", memberIds: ["a", "b"] })).toEqual([{ userId: "b", message: "Alex 傳了訊息給你" }]);
  });

  it("tells someone only once per stretch of unread messages", () => {
    expect(planChatNotifications({ ...base, kind: "GROUP", alreadyUnread: new Set(["b"]) }).map((n) => n.userId)).toEqual(["c"]);
  });

  it("always tells the person who was @-mentioned, with the mention wording, even mid-stretch", () => {
    const plan = planChatNotifications({ ...base, kind: "GROUP", mentionedIds: ["b"], alreadyUnread: new Set(["b"]) });
    expect(plan).toContainEqual({ userId: "b", message: "Alex 在「DVT 試作」提到你" });
    expect(plan.filter((n) => n.userId === "b")).toHaveLength(1);
  });

  it("tells nobody in a board channel except those mentioned", () => {
    expect(planChatNotifications({ ...base, kind: "BOARD", conversationName: "M28E" })).toEqual([]);
    expect(planChatNotifications({ ...base, kind: "BOARD", conversationName: "M28E", mentionedIds: ["c"] })).toEqual([
      { userId: "c", message: "Alex 在「M28E」提到你" },
    ]);
  });

  it("never tells the sender, even about their own mention of themselves", () => {
    expect(planChatNotifications({ ...base, kind: "BOARD", mentionedIds: ["a"] })).toEqual([]);
  });
});

describe("notification text", () => {
  it("says who mentioned you, and where", () => {
    expect(mentionNotificationText("Stanley", "M28E", "BOARD")).toBe("Stanley 在「M28E」提到你");
    expect(mentionNotificationText("Stanley", "Schumi", "DM")).toBe("Stanley 在私訊中提到你");
  });

  it("says a new message arrived", () => {
    expect(directNotificationText("Stanley", "Schumi", "DM")).toBe("Stanley 傳了訊息給你");
    expect(directNotificationText("Stanley", "DVT 試作", "GROUP")).toBe("Stanley 在「DVT 試作」有新訊息");
  });
});
