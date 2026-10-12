"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { GOOGLE_CALENDAR_TOKEN_COOKIE } from "@/lib/googleAuth";
import {
  explainGoogleForbidden,
  isValidExternalId,
  toCandidates,
  validateCalendarRange,
  type CalendarCandidate,
  type GoogleEvent,
} from "@/lib/googleCalendar";
import { addDaysIso, isValidIsoDate } from "@/lib/timesheet";
import { validateStartMinute } from "@/lib/timeOfDay";
import { logActivityTime, updateActivityTime } from "./activityTime";

/** 清單上的一列:Google 的行程,加上它在工時裡的狀態。 */
export type CalendarImportRow = CalendarCandidate & {
  /** new = 還沒匯入;imported = 匯入過、時間沒變;changed = 匯入過、日曆上的時間後來改了。 */
  state: "new" | "imported" | "changed";
  /** 匯入過的那一筆工時。 */
  entryId: string | null;
};

export type CalendarRangeResult =
  | {
      status: "ok";
      rows: CalendarImportRow[];
      /** Google 還有更多行程沒抓進來(一次最多 500 筆),請使用者縮小區間。 */
      truncated: boolean;
    }
  /** 還沒授權,或授權過期了。 */
  | { status: "needsAuth" }
  /** 伺服器沒設 Google 登入(GOOGLE_CLIENT_ID),要請管理者設定。 */
  | { status: "notConfigured" }
  /** reauthorize = 重試沒用,要請使用者重新連結(例如授權時沒勾到讀日曆的權限)。 */
  | { status: "error"; message: string; reauthorize?: boolean };

/** Google Calendar API 的位址;測試(假的 Google)或走代理時可以用 GOOGLE_CALENDAR_API_BASE 換掉。 */
const API_BASE = () => (process.env.GOOGLE_CALENDAR_API_BASE || "https://www.googleapis.com").replace(/\/+$/, "");

/** 一次最多抓進來幾個行程;也是一次最多匯入的上限。 */
const MAX_EVENTS = 500;

/**
 * 抓 from 到 to(含頭尾,台灣時間)的 Google 日曆行程——一週、一個月或自訂的區間,區間長度的上限見 validateCalendarRange。
 *
 * 授權是瀏覽器裡的暫存 cookie(約一小時),系統不存 Google 帳號、密碼或任何憑證;
 * 沒有或過期就回 needsAuth,畫面請使用者重新授權。
 */
export async function fetchGoogleCalendarRange(from: string, to: string): Promise<CalendarRangeResult> {
  const session = await requireSession();
  const invalid = validateCalendarRange(from, to);
  if (invalid) return { status: "error", message: invalid };

  const store = await cookies();
  const token = store.get(GOOGLE_CALENDAR_TOKEN_COOKIE)?.value;
  if (!token) return process.env.GOOGLE_CLIENT_ID ? { status: "needsAuth" } : { status: "notConfigured" };

  const url = new URL(`${API_BASE()}/calendar/v3/calendars/primary/events`);
  url.searchParams.set("timeMin", new Date(`${from}T00:00:00+08:00`).toISOString());
  url.searchParams.set("timeMax", new Date(`${addDaysIso(to, 1)}T00:00:00+08:00`).toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", String(MAX_EVENTS));
  url.searchParams.set("fields", "nextPageToken,items(id,summary,status,eventType,htmlLink,start,end,attendees(self,responseStatus))");

  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    return { status: "error", message: "連不上 Google,請稍後再試" };
  }
  if (response.status === 401) {
    store.delete(GOOGLE_CALENDAR_TOKEN_COOKIE);
    return { status: "needsAuth" };
  }
  if (response.status === 403) {
    // 403 有好幾種原因(專案沒啟用 Calendar API、授權沒勾到日曆權限、額度),看 Google 回的內容分辨,不要一句話帶過。
    const why = explainGoogleForbidden(await response.json().catch(() => null));
    if (why.reauthorize) store.delete(GOOGLE_CALENDAR_TOKEN_COOKIE);
    return { status: "error", message: why.message, reauthorize: why.reauthorize };
  }
  if (!response.ok) return { status: "error", message: `讀取 Google 日曆失敗(HTTP ${response.status})` };

  const body = (await response.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
  const candidates = toCandidates(body.items ?? []);

  const existing = await prisma.activityTimeEntry.findMany({
    where: { userId: session.userId, externalId: { in: candidates.map((c) => c.externalId) } },
    select: { id: true, externalId: true, date: true, startMinute: true, hours: true },
  });
  const byExternalId = new Map(existing.map((e) => [e.externalId!, e]));

  return {
    status: "ok",
    truncated: !!body.nextPageToken,
    rows: candidates.map((c) => {
      const entry = byExternalId.get(c.externalId);
      if (!entry) return { ...c, state: "new", entryId: null };
      const same = entry.date === c.date && entry.startMinute === c.startMinute && Number(entry.hours) === c.hours;
      return { ...c, state: same ? "imported" : "changed", entryId: entry.id };
    }),
  };
}

export type CalendarImportItem = {
  externalId: string;
  title: string;
  date: string;
  startMinute: number;
  hours: number;
  /** 新增時用的類別與對應專案;更新已匯入的只改時間,這兩個不看。 */
  categoryId: string;
  boardId: string | null;
};

export type CalendarImportResult = { created: number; updated: number; failed: string[] };

/**
 * 把勾選的行程匯入成「會議與其他」工時。
 *
 * 新的走一般登記(對應專案的要核准、免審核的人直接生效、一天 24 小時上限);已經匯入過的
 * 只更新日期、開始時間與時數,類別、對應專案、備註保留使用者自己改的。
 */
export async function importGoogleCalendarEvents(items: CalendarImportItem[]): Promise<CalendarImportResult | { error: string }> {
  const session = await requireSession();
  if (items.length === 0) return { error: "請至少勾選一個行程" };
  if (items.length > MAX_EVENTS) return { error: `一次最多匯入 ${MAX_EVENTS} 個行程` };

  const result: CalendarImportResult = { created: 0, updated: 0, failed: [] };
  for (const item of items) {
    const label = `${item.date} ${item.title}`;
    if (!isValidExternalId(item.externalId)) {
      result.failed.push(`${label}:行程識別不正確`);
      continue;
    }
    if (!isValidIsoDate(item.date) || !Number.isFinite(item.hours) || item.hours <= 0) {
      result.failed.push(`${label}:日期或時數不正確`);
      continue;
    }
    const startError = validateStartMinute(item.startMinute, item.hours);
    if (startError) {
      result.failed.push(`${label}:${startError}`);
      continue;
    }

    const existing = await prisma.activityTimeEntry.findFirst({
      where: { userId: session.userId, externalId: item.externalId },
      select: { id: true, categoryId: true, boardId: true, riskEntryId: true, note: true },
    });
    try {
      const outcome = existing
        ? await updateActivityTime(existing.id, {
            date: item.date,
            hours: item.hours,
            startMinute: item.startMinute,
            categoryId: existing.categoryId,
            boardId: existing.boardId,
            riskEntryId: existing.riskEntryId,
            note: existing.note ?? "",
          })
        : await logActivityTime({
            date: item.date,
            hours: item.hours,
            startMinute: item.startMinute,
            categoryId: item.categoryId,
            boardId: item.boardId || null,
            riskEntryId: null,
            note: item.title.slice(0, 200),
            externalId: item.externalId,
          });
      if (outcome.error) result.failed.push(`${label}:${outcome.error}`);
      else if (existing) result.updated++;
      else result.created++;
    } catch (err) {
      result.failed.push(`${label}:${err instanceof Error ? err.message : "匯入失敗"}`);
    }
  }
  return result;
}
