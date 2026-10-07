/**
 * Google 日曆行程 → 工時候選。純邏輯:不打 Google、不碰資料庫,server action 與畫面共用。
 *
 * 時間一律換成台灣時間(UTC+8)——工時的日期與開始時間就是台灣的日子(見 timesheet.ts 的
 * taipeiTodayIso),Google 回來的是帶時區偏移的 RFC3339。
 */
import { MINUTES_PER_DAY } from "./timeOfDay";

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

/** 對齊後會超過午夜的(例如 23:50 開始、開 1 小時)要把時數縮到午夜,不然存不進去。 */
export function clampToMidnight(startMinute: number, hours: number): number {
  return Math.min(hours, (MINUTES_PER_DAY - startMinute) / 60);
}
