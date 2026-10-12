/**
 * Google 日曆行程 → 工時候選。純邏輯:不打 Google、不碰資料庫,server action 與畫面共用。
 *
 * 時間一律換成台灣時間(UTC+8)——工時的日期與開始時間就是台灣的日子(見 timesheet.ts 的
 * taipeiTodayIso),Google 回來的是帶時區偏移的 RFC3339。
 */
import { MINUTES_PER_DAY } from "./timeOfDay";
import { addDaysIso, daysBetweenInclusive, isValidIsoDate, monthRangeOf } from "./timesheet";

/** Google Calendar API events.list 回來的一筆,只列用得到的欄位。 */
export type GoogleEvent = {
  id?: string;
  summary?: string;
  status?: string;
  eventType?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
};

/** 不能匯入的原因:列在清單裡但不能勾,讓使用者知道為什麼少了。 */
export type SkipReason = "ALL_DAY" | "MULTI_DAY";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  ALL_DAY: "全天行程,沒有開始時間,不匯入",
  MULTI_DAY: "跨日行程,工時一筆只能在同一天,不匯入",
};

export type CalendarCandidate = {
  /** 工時上記的外部識別,重複匯入靠它認出同一個行程:「gcal:」+ Google 的行程 id。 */
  externalId: string;
  title: string;
  /** 台灣時間的日期 "YYYY-MM-DD" */
  date: string;
  /** 一天中的開始時間(分鐘) */
  startMinute: number;
  /** 以 15 分鐘為單位,至少 0.25 */
  hours: number;
  link: string | null;
  skip: SkipReason | null;
};

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;
export const EXTERNAL_ID_PREFIX = "gcal:";

/** 把一個時間點換成台灣時間的日期與一天中的第幾分鐘。 */
export function toTaipei(ms: number): { date: string; minute: number } {
  const d = new Date(ms + TAIPEI_OFFSET_MS);
  return { date: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

/** 行程長度(分鐘)換成工時:對齊 15 分鐘,至少一格。 */
export function minutesToHours(minutes: number): number {
  return Math.max(15, Math.round(minutes / 15) * 15) / 60;
}

/**
 * 轉成候選清單,依開始時間排。丟掉取消的、自己已經婉拒的、不是一般行程的(工作地點、生日、
 * 專注時間……);全天與跨日的留著但標成不能匯入。
 */
export function toCandidates(events: GoogleEvent[]): CalendarCandidate[] {
  const out: CalendarCandidate[] = [];
  for (const e of events) {
    if (!e.id) continue;
    if (e.status === "cancelled") continue;
    if (e.eventType && e.eventType !== "default") continue;
    if (e.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;

    const title = (e.summary ?? "").replace(/\s+/g, " ").trim() || "(無標題)";
    const base = { externalId: `${EXTERNAL_ID_PREFIX}${e.id}`, title, link: e.htmlLink ?? null };

    const startMs = e.start?.dateTime ? Date.parse(e.start.dateTime) : NaN;
    const endMs = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN;
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      // 全天行程只有 date,沒有 dateTime。
      const day = e.start?.date;
      if (day) out.push({ ...base, date: day, startMinute: 0, hours: 0, skip: "ALL_DAY" });
      continue;
    }

    const start = toTaipei(startMs);
    const minutes = (endMs - startMs) / 60_000;
    const crossesMidnight = start.minute + minutes > MINUTES_PER_DAY;
    out.push({
      ...base,
      date: start.date,
      startMinute: start.minute,
      hours: crossesMidnight ? 0 : clampToMidnight(start.minute, minutesToHours(minutes)),
      skip: crossesMidnight ? "MULTI_DAY" : null,
    });
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute || a.title.localeCompare(b.title, "zh-TW")
  );
}

/**
 * Google 回 403 時,看它的錯誤內容分辨原因:Google Cloud 專案沒啟用 Calendar API、這次授權沒帶到讀日曆的權限、
 * 額度用完,或別的。reauthorize = 要請使用者重新連結(重試沒用)。
 */
export function explainGoogleForbidden(body: unknown): { message: string; reauthorize: boolean } {
  const error = (body as { error?: { message?: string; errors?: { reason?: string }[]; details?: { reason?: string; metadata?: { activationUrl?: string } }[] } } | null)?.error;
  const googleMessage = error?.message?.trim() ?? "";
  const reasons = new Set([
    ...(error?.errors ?? []).map((e) => e.reason),
    ...(error?.details ?? []).map((d) => d.reason),
  ]);
  const has = (...names: string[]) => names.some((n) => reasons.has(n));

  if (has("accessNotConfigured", "SERVICE_DISABLED") || /has not been used in project|is disabled/i.test(googleMessage)) {
    const url =
      error?.details?.find((d) => d.metadata?.activationUrl)?.metadata?.activationUrl ??
      googleMessage.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+?(?=\s|$)/)?.[0] ??
      "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com";
    return {
      message: `這個 Google Cloud 專案還沒有啟用「Google Calendar API」。請管理者到這裡按「啟用」,等一兩分鐘後再重試:${url}`,
      reauthorize: false,
    };
  }
  if (has("insufficientPermissions", "ACCESS_TOKEN_SCOPE_INSUFFICIENT") || /insufficient authentication scopes/i.test(googleMessage)) {
    return {
      message: "這次的 Google 授權沒有包含讀取日曆行程的權限(Google 同意畫面上「查看日曆活動」沒有打勾)。請重新連結,並把所有權限都勾起來。",
      reauthorize: true,
    };
  }
  if (has("rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded")) {
    return { message: "Google 日曆 API 目前額度用完了,請稍後再試。", reauthorize: false };
  }
  return { message: `Google 拒絕讀取日曆(403):${googleMessage || "Google 沒有說明原因"}`, reauthorize: false };
}

/**
 * 授權(OAuth 回呼)失敗時,回呼網址帶回的原因代碼(reason)與細節(detail)——翻成使用者與管理者看得懂、
 * 知道要做什麼的說明。reason 沒有或不認得就退回籠統的說法(舊的連結、或之後新增的原因)。
 */
export function explainGoogleAuthFailure(reason: string | null, detail: string | null, redirectUri?: string | null): string {
  const d = (detail ?? "").trim();
  switch (reason) {
    case "session":
      return "系統的登入已經過期,請重新登入之後再連結 Google 日曆。";
    case "denied":
      return d === "access_denied"
        ? "Google 授權畫面上按了取消,或這個 Google 帳號不被允許授權。如果 Google Cloud 的「OAuth 同意畫面」還在「測試中」,只有加進「測試使用者」的帳號才能授權,請管理者把你的 Google 帳號加進去。"
        : `Google 沒有完成授權(${d || "沒有說明原因"})。`;
    case "state":
      return d === "nocookie"
        ? "瀏覽器沒有帶回授權用的暫存資料(cookie)。多半是你開系統的網址,跟伺服器設定的網址(APP_BASE_URL)不是同一個——請改用管理者設定的那個網址再連結一次;或是瀏覽器擋了 cookie。"
        : "授權的驗證碼對不上,可能是同時開了好幾個分頁在連結。請關掉其他分頁,重新連結一次。";
    case "config":
      return "伺服器還沒有設定 Google 登入(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET),請管理者設定。";
    case "network":
      return "伺服器連不上 Google(oauth2.googleapis.com)。公司內部的伺服器要允許對外連線到 Google,請管理者檢查防火牆或代理設定。";
    case "token":
      if (d.startsWith("invalid_client")) return "Google 認不得這組用戶端(invalid_client):伺服器上的 GOOGLE_CLIENT_ID 或 GOOGLE_CLIENT_SECRET 設錯了,請管理者檢查。";
      if (d.startsWith("redirect_uri_mismatch"))
        return `Google Cloud 的「已授權的重新導向 URI」沒有登記這個網址${redirectUri ? `:${redirectUri}` : ""}。請管理者到 Google Cloud 的 OAuth 用戶端設定加上去(一字不差,含 http / https)。`;
      if (d.startsWith("invalid_grant")) return "這次的授權碼已經失效(重複使用或逾時),請重新連結一次。";
      return `Google 拒絕了授權(${d || "沒有說明原因"})。`;
    case "notoken":
      return "Google 沒有回傳存取憑證,請重新連結一次。";
    default:
      return "Google 授權失敗,請重新嘗試。";
  }
}

/** 對齊後會超過午夜的(例如 23:50 開始、開 1 小時)要把時數縮到午夜,不然存不進去。 */
export function clampToMidnight(startMinute: number, hours: number): number {
  return Math.min(hours, (MINUTES_PER_DAY - startMinute) / 60);
}

/** 一次最多匯入多長的區間:行程太多的話勾選清單沒法讀,也怕抓不完。 */
export const MAX_CALENDAR_RANGE_DAYS = 92;

export type CalendarScope = "week" | "month" | "range";

/**
 * 「每週」「每月」兩種預設區間:週 = 工時行事曆正在看的那一週(週一到週日);
 * 月 = 那一週的週四所在的月份(整個月,頭尾不看週的邊界)。
 */
export function calendarScopeRange(scope: "week" | "month", weekStart: string): { from: string; to: string } {
  if (scope === "week") return { from: weekStart, to: addDaysIso(weekStart, 6) };
  const { monthStart, monthEnd } = monthRangeOf(addDaysIso(weekStart, 3));
  return { from: monthStart, to: monthEnd };
}

/** 區間的檢查——回傳說明,沒問題回 null。 */
export function validateCalendarRange(from: string, to: string): string | null {
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) return "請選擇起訖日期";
  if (from > to) return "開始日期不能晚於結束日期";
  if (daysBetweenInclusive(from, to) > MAX_CALENDAR_RANGE_DAYS) return `一次最多匯入 ${MAX_CALENDAR_RANGE_DAYS} 天(約三個月)的行程`;
  return null;
}

/**
 * 這個瀏覽器是不是「內嵌瀏覽器」:Electron / 桌面 App 的預覽視窗(例如 Claude 桌面版)、手機 App 的內建瀏覽器(WebView、
 * LINE、Facebook、Instagram)。Google 不允許在這種視窗裡登入——授權時會停在 accounts.google.com(.tw)/accounts/SetSID
 * 出現「400 發生錯誤」,或直接回「403 disallowed_useragent」,跟系統的設定無關,要改用 Chrome、Edge、Safari 這類一般瀏覽器。
 */
export function isEmbeddedBrowser(userAgent: string): boolean {
  return /\bElectron\//.test(userAgent) || /\bClaude\/\d/.test(userAgent) || /; wv\)/.test(userAgent) || /\b(FBAN|FBAV|Instagram|Line)\b/.test(userAgent);
}
