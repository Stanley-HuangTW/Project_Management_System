import { describe, expect, it } from "vitest";
import { chatLink, itemLink, riskLink } from "./notificationLink";
import { appUrl, mailBody } from "./appUrl";

describe("notification links", () => {
  it("opens an item on its board, optionally on a tab", () => {
    expect(itemLink("b1", "i1")).toBe("/boards/b1?highlight=i1");
    expect(itemLink("b1", "i1", "updates")).toBe("/boards/b1?highlight=i1&highlightTab=updates");
  });

  it("opens the risk tab, straight onto one risk when there is one", () => {
    expect(riskLink("b1")).toBe("/boards/b1?view=risks");
    expect(riskLink("b1", null)).toBe("/boards/b1?view=risks");
    expect(riskLink("b1", "r1")).toBe("/boards/b1?view=risks&risk=r1");
  });

  it("opens a conversation", () => {
    expect(chatLink("c1")).toBe("/chat?c=c1");
  });

  it("turns into a full address in the mail body", () => {
    const previous = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://pm.example.com/";
    try {
      expect(appUrl(itemLink("b1", "i1"))).toBe("https://pm.example.com/boards/b1?highlight=i1");
      expect(mailBody("指派給你,配置 50%", itemLink("b1", "i1"))).toBe(
        "指派給你,配置 50%\n\n開啟:https://pm.example.com/boards/b1?highlight=i1"
      );
    } finally {
      if (previous === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = previous;
    }
  });
});
