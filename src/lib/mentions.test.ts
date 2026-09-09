import { describe, expect, it } from "vitest";
import { findMentionedUserIds, splitMentions, activeMentionQuery } from "./mentions";

const users = [
  { id: "u1", name: "Stanley Huang" },
  { id: "u2", name: "Alex" },
  { id: "u3", name: "Alex Chen" },
  { id: "u4", name: "青雲_PM_ALEX" },
];

describe("findMentionedUserIds", () => {
  it("matches a name with a space in it, not just the first word", () => {
    expect(findMentionedUserIds("@Stanley Huang 麻煩看一下", users)).toEqual(["u1"]);
  });

  it("prefers the longer name when one is a prefix of another", () => {
    expect(findMentionedUserIds("@Alex Chen 請確認", users)).toEqual(["u3"]);
    expect(findMentionedUserIds("@Alex 請確認", users)).toEqual(["u2"]);
  });

  it("handles a non-latin name", () => {
    expect(findMentionedUserIds("@青雲_PM_ALEX 這個排程", users)).toEqual(["u4"]);
  });

  it("returns each person once however many times they appear", () => {
    expect(findMentionedUserIds("@Alex 跟 @Alex 都要", users)).toEqual(["u2"]);
  });

  it("finds several people in one comment", () => {
    expect(findMentionedUserIds("@Alex 和 @Stanley Huang 討論", users).sort()).toEqual(["u1", "u2"]);
  });

  it("ignores an @ that is not a known name", () => {
    expect(findMentionedUserIds("寄到 me@example.com 就好", users)).toEqual([]);
    expect(findMentionedUserIds("@Nobody 在嗎", users)).toEqual([]);
  });
});

describe("splitMentions", () => {
  it("separates the mention runs from the surrounding text", () => {
    expect(splitMentions("嗨 @Alex 請看", users)).toEqual([
      { kind: "text", text: "嗨 " },
      { kind: "mention", text: "@Alex", userId: "u2" },
      { kind: "text", text: " 請看" },
    ]);
  });

  it("leaves a body with no mentions as one run of text", () => {
    expect(splitMentions("沒有提及任何人", users)).toEqual([{ kind: "text", text: "沒有提及任何人" }]);
  });

  it("keeps a stray @ as plain text", () => {
    expect(splitMentions("a@b", users)).toEqual([{ kind: "text", text: "a@b" }]);
  });
});

describe("activeMentionQuery", () => {
  it("reports what has been typed since the @", () => {
    // "嗨"=0, " "=1, "@"=2, so the mention starts at index 2.
    expect(activeMentionQuery("嗨 @Sta", 6)).toEqual({ query: "Sta", at: 2 });
  });

  it("keeps going past a space, since names contain them", () => {
    expect(activeMentionQuery("@Stanley Hu", 11)?.query).toBe("Stanley Hu");
  });

  it("is null when the caret is not after an @", () => {
    expect(activeMentionQuery("沒有提及", 4)).toBeNull();
  });

  it("is null for an @ inside a word, so an email address does not open the picker", () => {
    expect(activeMentionQuery("me@example", 10)).toBeNull();
  });

  it("gives up at a newline or a long run", () => {
    expect(activeMentionQuery("@Alex\n下一行", 9)).toBeNull();
    expect(activeMentionQuery("@" + "x".repeat(31), 32)).toBeNull();
  });
});
