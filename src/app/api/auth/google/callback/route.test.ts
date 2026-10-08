import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getSession = vi.fn();
vi.mock("@/lib/session", () => ({ getSession: () => getSession() }));

import { GET } from "./route";

const BASE = "https://pm.example.com";

function call(query: string, cookies: Record<string, string> = {}) {
  const cookie = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  return GET(new NextRequest(`${BASE}/api/auth/google/callback?${query}`, { headers: cookie ? { cookie } : {} }));
}

/** 回呼的轉址:回到哪、帶了什麼參數。 */
function redirectOf(res: Response) {
  const url = new URL(res.headers.get("location")!);
  return { path: url.pathname, params: Object.fromEntries(url.searchParams) };
}

const CAL_COOKIES = { google_oauth_state: "cal:abc", google_oauth_return_to: "/timesheet" };

describe("Google 授權回呼(日曆)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("APP_BASE_URL", BASE);
    vi.spyOn(console, "error").mockImplementation(() => {});
    getSession.mockResolvedValue({ userId: "u1", role: "MEMBER" });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("成功:帶 success,把存取憑證放進瀏覽器的 cookie,沒有失敗原因", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "tok", expires_in: 3599 }), { status: 200 })));
    const res = await call("code=c&state=cal:abc", CAL_COOKIES);
    const { path, params } = redirectOf(res);
    expect(path).toBe("/timesheet");
    expect(params).toEqual({ googleCalendarAuth: "success" });
    expect(res.headers.get("set-cookie")).toContain("google_calendar_token=tok");
  });

  it("沒登入:原因是 session", async () => {
    getSession.mockResolvedValue(null);
    const { params } = redirectOf(await call("code=c&state=cal:abc", CAL_COOKIES));
    expect(params).toMatchObject({ googleCalendarAuth: "error", googleAuthReason: "session" });
  });

  it("在 Google 按了取消:原因是 denied,細節帶 Google 回的代碼", async () => {
    const { params } = redirectOf(await call("error=access_denied&state=cal:abc", CAL_COOKIES));
    expect(params).toMatchObject({ googleAuthReason: "denied", googleAuthDetail: "access_denied" });
  });

  it("瀏覽器沒帶 state cookie:nocookie;驗證碼對不上:mismatch", async () => {
    const none = redirectOf(await call("code=c&state=cal:abc", { google_oauth_return_to: "/timesheet" }));
    expect(none.params).toMatchObject({ googleCalendarAuth: "error", googleAuthReason: "state", googleAuthDetail: "nocookie" });
    // cookie 全掉了(連回到哪一頁都不知道):靠 Google 帶回來的 state 認出是日曆,回到工時頁,訊息才看得到。
    const lost = redirectOf(await call("code=c&state=cal:abc"));
    expect(lost.path).toBe("/timesheet");
    expect(lost.params).toMatchObject({ googleCalendarAuth: "error", googleAuthReason: "state", googleAuthDetail: "nocookie" });
    const mismatch = redirectOf(await call("code=c&state=cal:other", CAL_COOKIES));
    expect(mismatch.params).toMatchObject({ googleAuthReason: "state", googleAuthDetail: "mismatch" });
  });

  it("伺服器沒設 Google 登入:原因是 config", async () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    const { params } = redirectOf(await call("code=c&state=cal:abc", CAL_COOKIES));
    expect(params).toMatchObject({ googleAuthReason: "config" });
  });

  it("伺服器連不上 Google(fetch 丟例外):原因是 network,不是空白的 500", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const res = await call("code=c&state=cal:abc", CAL_COOKIES);
    expect(res.status).toBe(307);
    expect(redirectOf(res).params).toMatchObject({ googleAuthReason: "network" });
  });

  it("Google 回錯誤:原因是 token,細節是它的錯誤代碼", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client", error_description: "Unauthorized" }), { status: 401 })));
    const { params } = redirectOf(await call("code=c&state=cal:abc", CAL_COOKIES));
    expect(params).toMatchObject({ googleAuthReason: "token", googleAuthDetail: "invalid_client: Unauthorized" });
    expect(params.googleAuthUri).toBeUndefined();
  });

  it("redirect_uri_mismatch:額外帶上伺服器用的回呼網址,管理者才知道要登記哪一個", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "redirect_uri_mismatch" }), { status: 400 })));
    const { params } = redirectOf(await call("code=c&state=cal:abc", CAL_COOKIES));
    expect(params.googleAuthUri).toBe(`${BASE}/api/auth/google/callback`);
  });

  it("Google 回的不是 JSON 也不會當掉:細節退回 HTTP 狀態", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 })));
    const { params } = redirectOf(await call("code=c&state=cal:abc", CAL_COOKIES));
    expect(params).toMatchObject({ googleAuthReason: "token", googleAuthDetail: "HTTP 502" });
  });

  it("成功但沒有 access_token:原因是 notoken", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));
    const { params } = redirectOf(await call("code=c&state=cal:abc", CAL_COOKIES));
    expect(params).toMatchObject({ googleAuthReason: "notoken" });
  });

  it("失敗時伺服器也留一筆紀錄(管理者看 docker logs 查得到)", async () => {
    await call("error=access_denied&state=cal:abc", CAL_COOKIES);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("[google-oauth] calendar 授權失敗:denied"));
  });
});

describe("Google 授權回呼(Google Sheet 匯入)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("不是管理者:照原本擋下來,用的是 Sheet 那條的參數名", async () => {
    getSession.mockResolvedValue({ userId: "u1", role: "MEMBER" });
    const { params } = redirectOf(await call("code=c&state=sheet-state", { google_oauth_state: "sheet-state", google_oauth_return_to: "/" }));
    expect(params).toMatchObject({ googleSheetsAuth: "error", googleAuthReason: "session" });
    expect(params.googleCalendarAuth).toBeUndefined();
  });
});
