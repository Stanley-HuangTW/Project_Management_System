import { describe, expect, it } from "vitest";
import { calendarScopeRange, clampToMidnight, isEmbeddedBrowser, isValidExternalId, explainGoogleForbidden, minutesToHours, toCandidates, toTaipei, validateCalendarRange, type GoogleEvent, explainGoogleAuthFailure } from "./googleCalendar";

const ev = (over: Partial<GoogleEvent> & { id: string }): GoogleEvent => ({
  summary: "部門週會",
  status: "confirmed",
  start: { dateTime: "2026-10-06T14:00:00+08:00" },
  end: { dateTime: "2026-10-06T15:00:00+08:00" },
  ...over,
});

describe("toTaipei", () => {
  it("UTC 的時間換成台灣的日期與分鐘", () => {
    expect(toTaipei(Date.parse("2026-10-06T06:30:00Z"))).toEqual({ date: "2026-10-06", minute: 14 * 60 + 30 });
  });

  it("UTC 晚上換成台灣已經是隔天", () => {
    expect(toTaipei(Date.parse("2026-10-06T17:00:00Z"))).toEqual({ date: "2026-10-07", minute: 60 });
  });
});

describe("minutesToHours", () => {
  it("對齊 15 分鐘", () => {
    expect(minutesToHours(60)).toBe(1);
    expect(minutesToHours(50)).toBe(0.75);
    expect(minutesToHours(100)).toBe(1.75);
  });

  it("太短也至少一格", () => {
    expect(minutesToHours(5)).toBe(0.25);
  });
});

describe("toCandidates", () => {
  it("一般行程:台灣時間的日期、開始時間、時數,id 加上 gcal: 前綴", () => {
    const [c] = toCandidates([ev({ id: "abc", htmlLink: "https://calendar.google.com/x" })]);
    expect(c).toEqual({
      externalId: "gcal:abc",
      title: "部門週會",
      date: "2026-10-06",
      startMinute: 840,
      hours: 1,
      link: "https://calendar.google.com/x",
      skip: null,
    });
  });

  it("別的時區的行程也換成台灣時間", () => {
    const [c] = toCandidates([
      ev({ id: "x", start: { dateTime: "2026-10-06T06:00:00-07:00" }, end: { dateTime: "2026-10-06T07:30:00-07:00" } }),
    ]);
    expect(c.date).toBe("2026-10-06");
    expect(c.startMinute).toBe(21 * 60); // 台灣 21:00
    expect(c.hours).toBe(1.5);
  });

  it("依日期、開始時間排序", () => {
    const list = toCandidates([
      ev({ id: "b", summary: "B", start: { dateTime: "2026-10-07T09:00:00+08:00" }, end: { dateTime: "2026-10-07T10:00:00+08:00" } }),
      ev({ id: "a", summary: "A", start: { dateTime: "2026-10-06T15:00:00+08:00" }, end: { dateTime: "2026-10-06T16:00:00+08:00" } }),
      ev({ id: "c", summary: "C", start: { dateTime: "2026-10-06T09:00:00+08:00" }, end: { dateTime: "2026-10-06T10:00:00+08:00" } }),
    ]);
    expect(list.map((c) => c.title)).toEqual(["C", "A", "B"]);
  });

  it("取消的、自己婉拒的、不是一般行程的都丟掉", () => {
    const list = toCandidates([
      ev({ id: "1", status: "cancelled" }),
      ev({ id: "2", attendees: [{ self: true, responseStatus: "declined" }] }),
      ev({ id: "3", eventType: "workingLocation" }),
      ev({ id: "4", eventType: "birthday" }),
      ev({ id: "5", attendees: [{ self: false, responseStatus: "declined" }] }), // 別人婉拒不影響
      ev({ id: "6", eventType: "default" }),
    ]);
    expect(list.map((c) => c.externalId)).toEqual(["gcal:5", "gcal:6"]);
  });

  it("全天行程留著但不能匯入", () => {
    const [c] = toCandidates([{ id: "d", summary: "出差", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } }]);
    expect(c).toMatchObject({ date: "2026-10-08", skip: "ALL_DAY", hours: 0 });
  });

  it("跨日的行程不能匯入", () => {
    const [c] = toCandidates([
      ev({ id: "n", start: { dateTime: "2026-10-06T22:00:00+08:00" }, end: { dateTime: "2026-10-07T02:00:00+08:00" } }),
    ]);
    expect(c.skip).toBe("MULTI_DAY");
  });

  it("剛好到午夜結束的不算跨日", () => {
    const [c] = toCandidates([
      ev({ id: "m", start: { dateTime: "2026-10-06T23:00:00+08:00" }, end: { dateTime: "2026-10-07T00:00:00+08:00" } }),
    ]);
    expect(c).toMatchObject({ skip: null, startMinute: 23 * 60, hours: 1 });
  });

  it("沒標題的給預設名字,標題裡的換行壓成空白", () => {
    const list = toCandidates([ev({ id: "t1", summary: "  " }), ev({ id: "t2", summary: "週會\n(含報告)" })]);
    expect(list.map((c) => c.title).sort()).toEqual(["(無標題)", "週會 (含報告)"].sort());
  });

  it("沒有 id 的、結束早於開始的不處理", () => {
    expect(toCandidates([{ summary: "x", start: { dateTime: "2026-10-06T14:00:00+08:00" } }])).toEqual([]);
    const bad = toCandidates([ev({ id: "z", end: { dateTime: "2026-10-06T13:00:00+08:00" } })]);
    expect(bad).toEqual([]);
  });

  it("對齊後會超過午夜的,時數縮到午夜", () => {
    const [c] = toCandidates([
      ev({ id: "e", start: { dateTime: "2026-10-06T23:50:00+08:00" }, end: { dateTime: "2026-10-06T23:59:00+08:00" } }),
    ]);
    expect(c.skip).toBeNull();
    expect(c.startMinute + Math.round(c.hours * 60)).toBeLessThanOrEqual(1440);
  });
});

describe("isValidExternalId(匯入時檢查前端送回來的識別)", () => {
  it("我們自己發出去的都通過,包含 Outlook / Teams 同步來的很長的 id 與重複行程的單次", () => {
    const longId = "040000008200E00074C5B7101A82E00800000000".repeat(8) + "_20261013T010000Z";
    expect(longId.length).toBeGreaterThan(200);
    const [c] = toCandidates([ev({ id: longId })]);
    expect(isValidExternalId(c.externalId)).toBe(true);
    expect(isValidExternalId(`gcal:${"a".repeat(1024)}_20261013T010000Z`)).toBe(true);
  });

  it("不是「gcal:」開頭、或超過 Google 的長度上限的不收", () => {
    expect(isValidExternalId("abc")).toBe(false);
    expect(isValidExternalId("outlook:abc")).toBe(false);
    expect(isValidExternalId(`gcal:${"a".repeat(1101)}`)).toBe(false);
  });
});

describe("clampToMidnight", () => {
  it("不超過午夜就維持原時數", () => {
    expect(clampToMidnight(600, 1)).toBe(1);
  });

  it("超過午夜就縮到午夜", () => {
    expect(clampToMidnight(1410, 1)).toBe(0.5);
  });
});

describe("explainGoogleForbidden(Google 回 403 的原因)", () => {
  it("Google Cloud 專案還沒啟用 Calendar API:給啟用網址,不用重新連結", () => {
    const r = explainGoogleForbidden({
      error: {
        code: 403,
        message: "Google Calendar API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123 then retry.",
        errors: [{ reason: "accessNotConfigured" }],
        details: [{ reason: "SERVICE_DISABLED", metadata: { activationUrl: "https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123" } }],
      },
    });
    expect(r.reauthorize).toBe(false);
    expect(r.message).toContain("還沒有啟用「Google Calendar API」");
    expect(r.message).toContain("https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=123");
  });

  it("只有訊息、沒有 details 也認得,並從訊息抓出網址", () => {
    const r = explainGoogleForbidden({
      error: { message: "Google Calendar API has not been used in project 9 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=9 then retry." },
    });
    expect(r.message).toContain("project=9");
  });

  it("授權沒有帶到讀日曆的範圍:要重新連結", () => {
    const r = explainGoogleForbidden({
      error: { message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }], details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] },
    });
    expect(r.reauthorize).toBe(true);
    expect(r.message).toContain("沒有包含讀取日曆行程的權限");
  });

  it("額度用完", () => {
    expect(explainGoogleForbidden({ error: { errors: [{ reason: "rateLimitExceeded" }] } }).message).toContain("額度用完");
  });

  it("別的 403:把 Google 的原話帶出來,方便查", () => {
    const r = explainGoogleForbidden({ error: { message: "The caller does not have permission", errors: [{ reason: "forbidden" }] } });
    expect(r.message).toBe("Google 拒絕讀取日曆(403):The caller does not have permission");
    expect(r.reauthorize).toBe(false);
  });

  it("回應不是預期的格式也不會壞", () => {
    expect(explainGoogleForbidden(null).message).toContain("Google 沒有說明原因");
    expect(explainGoogleForbidden("oops").message).toContain("403");
  });
});

describe("explainGoogleAuthFailure(授權失敗的原因說明)", () => {
  it("伺服器連不上 Google:請管理者檢查對外連線", () => {
    expect(explainGoogleAuthFailure("network", null)).toContain("連不上 Google");
    expect(explainGoogleAuthFailure("network", null)).toContain("防火牆");
  });

  it("用戶端設定錯、網址沒登記、授權碼失效,各有各的說明", () => {
    expect(explainGoogleAuthFailure("token", "invalid_client: Unauthorized")).toContain("GOOGLE_CLIENT_SECRET");
    const uri = explainGoogleAuthFailure("token", "redirect_uri_mismatch", "https://pm.example.com/api/auth/google/callback");
    expect(uri).toContain("已授權的重新導向 URI");
    expect(uri).toContain("https://pm.example.com/api/auth/google/callback");
    expect(explainGoogleAuthFailure("token", "invalid_grant: Bad Request")).toContain("重新連結");
  });

  it("按了取消或帳號不在測試名單:說明測試使用者", () => {
    expect(explainGoogleAuthFailure("denied", "access_denied")).toContain("測試使用者");
    expect(explainGoogleAuthFailure("denied", "server_error")).toContain("server_error");
  });

  it("cookie 沒帶回來(網址跟 APP_BASE_URL 不同)與驗證碼對不上是兩種說法", () => {
    expect(explainGoogleAuthFailure("state", "nocookie")).toContain("APP_BASE_URL");
    expect(explainGoogleAuthFailure("state", "mismatch")).toContain("分頁");
  });

  it("沒設定、登入過期、沒拿到憑證", () => {
    expect(explainGoogleAuthFailure("config", null)).toContain("GOOGLE_CLIENT_ID");
    expect(explainGoogleAuthFailure("session", null)).toContain("登入");
    expect(explainGoogleAuthFailure("notoken", null)).toContain("存取憑證");
  });

  it("不認得的原因、或舊的連結(沒有原因):退回籠統說法", () => {
    expect(explainGoogleAuthFailure(null, null)).toBe("Google 授權失敗,請重新嘗試。");
    expect(explainGoogleAuthFailure("something-new", "x")).toBe("Google 授權失敗,請重新嘗試。");
  });
});

describe("calendarScopeRange(每週 / 每月)", () => {
  it("每週:行事曆正在看的那一週,週一到週日", () => {
    expect(calendarScopeRange("week", "2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });

  it("每月:那一週所在的整個月", () => {
    expect(calendarScopeRange("month", "2026-10-12")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("跨月的那一週:以週四所在的月份為準", () => {
    // 2026-09-28(週一)~ 10-04:週四是 10/1 → 十月。
    expect(calendarScopeRange("month", "2026-09-28")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    // 2026-08-31(週一)~ 09-06:週四是 9/3 → 九月。
    expect(calendarScopeRange("month", "2026-08-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });
});

describe("validateCalendarRange", () => {
  it("正常的區間沒問題,同一天也可以", () => {
    expect(validateCalendarRange("2026-10-01", "2026-10-31")).toBeNull();
    expect(validateCalendarRange("2026-10-01", "2026-10-01")).toBeNull();
  });

  it("日期沒填、格式不對、開始晚於結束", () => {
    expect(validateCalendarRange("", "2026-10-31")).toContain("起訖");
    expect(validateCalendarRange("2026-02-30", "2026-10-31")).toContain("起訖");
    expect(validateCalendarRange("2026-10-31", "2026-10-01")).toContain("不能晚於");
  });

  it("最多 92 天:剛好 92 天可以,多一天不行", () => {
    expect(validateCalendarRange("2026-10-01", "2026-12-31")).toBeNull(); // 92 天
    expect(validateCalendarRange("2026-10-01", "2027-01-01")).toContain("最多");
  });
});

describe("isEmbeddedBrowser(Google 不給登入的內嵌瀏覽器)", () => {
  const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";
  it("一般的 Chrome、Edge、Safari 不是", () => {
    expect(isEmbeddedBrowser(CHROME)).toBe(false);
    expect(isEmbeddedBrowser(CHROME + " Edg/152.0.0.0")).toBe(false);
    expect(isEmbeddedBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toBe(false);
  });

  it("Claude 桌面版的預覽視窗、Electron 是", () => {
    expect(isEmbeddedBrowser("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/2.31226.1 Chrome/152.0.7977.130 Safari/537.36 MSIX")).toBe(true);
    expect(isEmbeddedBrowser(CHROME + " Electron/30.0.0")).toBe(true);
  });

  it("Android WebView、LINE、Facebook、Instagram 的內建瀏覽器是", () => {
    expect(isEmbeddedBrowser("Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36")).toBe(true);
    expect(isEmbeddedBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0")).toBe(true);
    expect(isEmbeddedBrowser("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 [FBAN/FBIOS;FBAV/430.0]")).toBe(true);
  });
});
