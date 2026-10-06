export const GOOGLE_TOKEN_COOKIE = "google_sheets_token";
export const GOOGLE_STATE_COOKIE = "google_oauth_state";
export const GOOGLE_RETURN_TO_COOKIE = "google_oauth_return_to";
export const GOOGLE_SHEETS_SCOPE =
  "https://www.googleapis.com/auth/spreadsheets.readonly";

/** 讀日曆行程用:只讀行程(標題、時間),不含日曆設定。 */
export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export const GOOGLE_CALENDAR_TOKEN_COOKIE = "google_calendar_token";
/** 授權流程共用同一個 state cookie 與回呼網址,靠 state 的前綴分辨是日曆還是 Google Sheet。 */
export const GOOGLE_CALENDAR_STATE_PREFIX = "cal:";
/** 日曆授權暫存在瀏覽器多久(Google 的 token 本來就一小時)。 */
export const GOOGLE_CALENDAR_TOKEN_MAX_AGE_SECONDS = 3600;

export function googleRedirectUri(): string {
  const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${baseUrl}/api/auth/google/callback`;
}

/** Only allow redirecting back to a same-app relative path, never an
 *  external URL — a bare "/x" is safe, "//x" or "https://x" are not. */
export function isSafeReturnPath(path: string | null | undefined): path is string {
  return !!path && path.startsWith("/") && !path.startsWith("//");
}
