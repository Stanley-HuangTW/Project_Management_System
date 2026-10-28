import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { MantisError, explainEmptyResult, mantisGet } from "@/lib/mantisSync";

/** 假的 fetch:依序回應,並記下每次送出的 Authorization 標頭。 */
function stubFetch(responses: { status: number; body?: unknown; location?: string; text?: string }[]) {
  const sent: string[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: { headers: { authorization: string } }) => {
      sent.push(init.headers.authorization);
      const r = queue.shift() ?? { status: 500 };
      return new Response(r.text ?? (r.body === undefined ? "" : JSON.stringify(r.body)), {
        status: r.status,
        headers: r.location ? { location: r.location } : undefined,
      });
    })
  );
  return sent;
}

let n = 0;
const freshBase = () => `https://mantis-${++n}.test`;

describe("mantisGet", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("新版 Mantis:Bearer 一次就過,下次還是 Bearer", async () => {
    const base = freshBase();
    const sent = stubFetch([{ status: 200, body: { projects: [] } }, { status: 200, body: { projects: [] } }]);
    await mantisGet(base, "tok", "projects");
    await mantisGet(base, "tok", "projects");
    expect(sent).toEqual(["Bearer tok", "Bearer tok"]);
  });

  it("舊版 Mantis(2.27 之類):Bearer 被 401 就改用不加 Bearer 的 token,並且記住——下次直接用", async () => {
    const base = freshBase();
    const sent = stubFetch([
      { status: 401 },
      { status: 200, body: { issues: [] } },
      { status: 200, body: { issues: [] } },
      { status: 200, body: { issues: [] } },
    ]);
    await mantisGet(base, "tok", "issues");
    await mantisGet(base, "tok", "issues");
    await mantisGet(base, "tok", "issues");
    expect(sent).toEqual(["Bearer tok", "tok", "tok", "tok"]);
  });

  it("每個網站各自記,不會互相影響", async () => {
    const oldBase = freshBase();
    const newBase = freshBase();
    const sent = stubFetch([{ status: 401 }, { status: 200, body: {} }, { status: 200, body: {} }]);
    await mantisGet(oldBase, "a", "projects");
    await mantisGet(newBase, "b", "projects");
    expect(sent).toEqual(["Bearer a", "a", "Bearer b"]);
  });

  it("兩種寫法都 401:說 token 被拒,並提醒可能是 Apache 沒傳 Authorization 標頭", async () => {
    stubFetch([{ status: 401 }, { status: 401 }]);
    await expect(mantisGet(freshBase(), "bad", "projects")).rejects.toThrow(/拒絕了這個 API token[\s\S]*Authorization 標頭/);
  });

  it("403:同樣說被拒絕", async () => {
    stubFetch([{ status: 403 }]);
    await expect(mantisGet(freshBase(), "tok", "projects")).rejects.toBeInstanceOf(MantisError);
  });

  it("被轉址:不跟過去,說明轉去哪", async () => {
    stubFetch([{ status: 302, location: "/login_page.php" }]);
    await expect(mantisGet(freshBase(), "tok", "projects")).rejects.toThrow("網址被轉址到 /login_page.php");
  });

  it("404:說找不到 REST API", async () => {
    stubFetch([{ status: 404 }]);
    await expect(mantisGet(freshBase(), "tok", "projects")).rejects.toThrow(/找不到 Mantis 的 REST API/);
  });

  it("回的不是 JSON(被導到登入頁的 HTML)", async () => {
    stubFetch([{ status: 200, text: "<html>login</html>" }]);
    await expect(mantisGet(freshBase(), "tok", "projects")).rejects.toThrow(/不是 JSON/);
  });

  it("連不上、逾時分開說明", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(mantisGet(freshBase(), "tok", "projects")).rejects.toThrow("連不上 Mantis");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" }))));
    await expect(mantisGet(freshBase(), "tok", "projects")).rejects.toThrow("逾時");
  });

  it("把頁碼與專案編號帶在網址上", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ issues: [] }), { status: 200 });
      })
    );
    await mantisGet("https://m.example.com/mantis", "t", "issues", { project_id: "3", page_size: "50", page: "2" });
    expect(urls[0]).toBe("https://m.example.com/mantis/api/rest/issues?project_id=3&page_size=50&page=2");
  });
});

describe("explainEmptyResult(一筆議題都沒取到時的提示)", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("說出是用哪個帳號在讀;帳號看不到這個專案就直接講", async () => {
    stubFetch([{ status: 200, body: { name: "chen", real_name: "陳小明", access_level: { label: "reporter" }, projects: [{ id: 1 }, { id: 7 }] } }]);
    const note = await explainEmptyResult(freshBase(), "tok", 99);
    expect(note).toContain("「陳小明」");
    expect(note).toContain("權限:reporter");
    expect(note).toContain("看不到這個專案");
  });

  it("帳號看得到這個專案時,不說看不到,改請確認專案有議題與權限", async () => {
    stubFetch([{ status: 200, body: { name: "chen", projects: [{ id: 7 }] } }]);
    const note = await explainEmptyResult(freshBase(), "tok", 7);
    expect(note).toContain("「chen」");
    expect(note).not.toContain("看不到這個專案");
    expect(note).toContain("真的有議題");
  });

  it("問不到「我是誰」(例如舊版沒有這個 API)就用通用的說法,不會丟錯", async () => {
    stubFetch([{ status: 404 }]);
    const note = await explainEmptyResult(freshBase(), "tok", 7);
    expect(note).toContain("一筆議題都沒取到");
    expect(note).toContain("檢視權限");
  });
});
