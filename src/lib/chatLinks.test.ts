import { describe, expect, it } from "vitest";
import { internalRefUrl, MAX_LINKS_PER_MESSAGE, normalizeChatLink, normalizeChatLinks } from "./chatLinks";

describe("normalizeChatLink", () => {
  it("收 http / https 的網址,沒取名字就用網域加路徑", () => {
    expect(normalizeChatLink({ url: "https://example.com/doc/spec" })).toEqual({
      link: { url: "https://example.com/doc/spec", label: "example.com/doc/spec" },
    });
    expect(normalizeChatLink({ url: "http://example.com" })).toMatchObject({ link: { label: "example.com" } });
  });

  it("沒寫通訊協定的補 https://", () => {
    expect(normalizeChatLink({ url: "example.com/a" })).toMatchObject({ link: { url: "https://example.com/a" } });
  });

  it("取了名字就用名字(空白壓成一個、過長截短)", () => {
    expect(normalizeChatLink({ url: "https://e.com", label: "  設計   文件 " })).toMatchObject({ link: { label: "設計 文件" } });
    const long = normalizeChatLink({ url: "https://e.com", label: "字".repeat(200) });
    expect("link" in long && long.link.label.length).toBe(80);
  });

  it("擋掉會執行東西或不是網頁的協定", () => {
    for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,<script>1</script>", "ftp://example.com/x", "file:///etc/passwd", "vbscript:x"]) {
      expect(normalizeChatLink({ url })).toHaveProperty("error");
    }
  });

  it("本系統看板底下的路徑可以(給引用工作項 / 風險 / 議題用),其他路徑不行", () => {
    expect(normalizeChatLink({ url: "/boards/abc123?highlight=item1", label: "工作項:外殼" })).toEqual({
      link: { url: "/boards/abc123?highlight=item1", label: "工作項:外殼" },
    });
    expect(normalizeChatLink({ url: "/boards/abc123?view=risks" })).toMatchObject({ link: { label: "本系統連結" } });
    for (const url of ["/api/users", "//evil.com/x", "/boards/../admin", "/boards/abc?x=<script>"]) {
      expect(normalizeChatLink({ url })).toHaveProperty("error");
    }
  });

  it("空的、格式不對的", () => {
    expect(normalizeChatLink({ url: "  " })).toEqual({ error: "請輸入連結的網址" });
    expect(normalizeChatLink({ url: "not a url" })).toHaveProperty("error");
    expect(normalizeChatLink({ url: "https://nodot" })).toHaveProperty("error");
  });
});

describe("normalizeChatLinks", () => {
  it("一則訊息最多 10 個", () => {
    const many = Array.from({ length: MAX_LINKS_PER_MESSAGE + 1 }, (_, i) => ({ url: `https://e.com/${i}` }));
    expect(normalizeChatLinks(many)).toHaveProperty("error");
    expect(normalizeChatLinks(many.slice(0, MAX_LINKS_PER_MESSAGE))).toHaveProperty("links");
  });

  it("有一個不合格就整批回錯誤", () => {
    expect(normalizeChatLinks([{ url: "https://e.com" }, { url: "javascript:1" }])).toHaveProperty("error");
  });
});

describe("internalRefUrl", () => {
  it("工作項指到那一列,風險、議題指到風險登記冊", () => {
    // 兩筆不同的風險要是不同的網址,同一則訊息才能都引用
    expect(internalRefUrl({ kind: "risk", boardId: "b1", id: "r1" })).not.toBe(internalRefUrl({ kind: "risk", boardId: "b1", id: "r2" }));
    expect(internalRefUrl({ kind: "item", boardId: "b1", id: "i1" })).toBe("/boards/b1?highlight=i1");
    expect(internalRefUrl({ kind: "risk", boardId: "b1", id: "r1" })).toBe("/boards/b1?view=risks&risk=r1");
    expect(internalRefUrl({ kind: "issue", boardId: "b1", id: "r2" })).toBe("/boards/b1?view=risks&risk=r2");
  });

  it("產生的位置一定通得過 normalizeChatLink", () => {
    const url = internalRefUrl({ kind: "item", boardId: "cmvq6ne6j0001ro2zrmgnhqxl", id: "cmuz354j5000dp224dp2kmdix" });
    expect(normalizeChatLink({ url })).toHaveProperty("link");
    const riskUrl = internalRefUrl({ kind: "issue", boardId: "cmvq6ne6j0001ro2zrmgnhqxl", id: "cmuz354j5000dp224dp2kmdix" });
    expect(normalizeChatLink({ url: riskUrl })).toHaveProperty("link");
  });
});
