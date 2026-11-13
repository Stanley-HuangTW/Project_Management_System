import { isoWeekLabel, lastCompletedReportRange, weekRangeOf, type ReportRangeConfig } from "@/lib/weeklyReport";
import { withWeekday } from "@/lib/weekdayLabel";

/**
 * 週報排程前的提醒信:週報某個時刻自動產生,產生前 N 小時先寄信請各單位同仁更新工作事項。
 *
 * 這個檔案不碰資料庫與信箱,只做時間與文字——整個測得到。時間一律是台北的牆上時間,
 * 放在 Date 的 UTC 欄位裡(跟排程心跳那支一樣:台灣沒有日光節約,固定 UTC+8,不用拉時區資料庫)。
 */

export type WeeklyTrigger = { dow: number; hour: number; minute: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MINUTES = 7 * 24 * 60;

export const DOW_LABELS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

/** 提醒最多可以提前多久:一整週。再早就會落在上一輪週報之前。 */
export const MAX_REMINDER_HOURS = 168;

/** 下一次週報排程的觸發時刻——嚴格晚於 now(剛好等於的那一刻算已經過了)。 */
export function nextTrigger(now: Date, trigger: WeeklyTrigger): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), trigger.hour, trigger.minute);
  for (let days = 0; days <= 7; days++) {
    const candidate = new Date(today + days * DAY_MS);
    if (candidate.getUTCDay() === trigger.dow && candidate.getTime() > now.getTime()) return candidate;
  }
  // 七天裡一定會碰到那個星期幾;走到這裡代表 dow 不是 0~6。
  throw new Error(`不合法的星期幾:${trigger.dow}`);
}

/**
 * 現在該不該寄提醒:下一次觸發的前 hours 小時起、到觸發之前。hours = 0 就是不提醒。
 * triggerAt 是「這封提醒信對應的那一輪週報」何時產生。
 */
export function reminderWindow(
  now: Date,
  trigger: WeeklyTrigger,
  hours: number
): { triggerAt: Date; reminderAt: Date; due: boolean } {
  const triggerAt = nextTrigger(now, trigger);
  const reminderAt = new Date(triggerAt.getTime() - hours * HOUR_MS);
  return { triggerAt, reminderAt, due: hours > 0 && now.getTime() >= reminderAt.getTime() };
}

/** 那一輪週報所在的 ISO 週——跟排程「這週跑過了沒」用同一種鍵,提醒才不會一輪寄兩次。 */
export function reminderWeekKey(triggerAt: Date): string {
  return isoWeekLabel(weekRangeOf(triggerAt.toISOString().slice(0, 10)).weekStart);
}

/** 觸發時刻往前推 hours 小時是星期幾幾點(設定頁用來告訴管理者「提醒信會在什麼時候寄」)。 */
export function reminderTime(trigger: WeeklyTrigger, hours: number): WeeklyTrigger {
  const minutes = trigger.dow * 24 * 60 + trigger.hour * 60 + trigger.minute - hours * 60;
  const wrapped = ((minutes % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES;
  return { dow: Math.floor(wrapped / (24 * 60)), hour: Math.floor((wrapped % (24 * 60)) / 60), minute: wrapped % 60 };
}

export function formatClock(time: WeeklyTrigger): string {
  return `${DOW_LABELS[time.dow]} ${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
}

/** 「2026-10-26(週一)16:00」 */
function formatInstant(at: Date): string {
  const date = at.toISOString().slice(0, 10);
  const clock = `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
  return `${date}(${DOW_LABELS[at.getUTCDay()]})${clock}`;
}

/**
 * 提醒信的標題與內文。要講清楚的兩件事:請更新工作事項,以及週報什麼時候產生、涵蓋哪一段。
 * 涵蓋的範圍照排程真的會報的那一段算(最後一天過完才算結束),不是「這個星期」。
 */
export function buildReminderMail(args: {
  triggerAt: Date;
  hours: number;
  range: ReportRangeConfig;
  baseUrl: string;
  /** 這位收件人所屬、而且會寄週報的專案(群組)名稱。有的話標題與內文都寫出來,沒有就是通用的寫法。 */
  programNames?: string[];
}): { subject: string; text: string } {
  const when = formatInstant(args.triggerAt);
  const covered = lastCompletedReportRange(args.triggerAt.toISOString().slice(0, 10), args.range);
  const names = (args.programNames ?? []).join("、");
  const subject = names
    ? `【週報提醒】${names} 週報將於 ${when} 產生,請先更新你的工作事項`
    : `【週報提醒】週報將於 ${when} 產生,請先更新你的工作事項`;
  const text = [
    "各位同仁好:",
    "",
    names
      ? `你所屬的專案:${names}。這些專案的週報將於 ${when} 自動產生,並寄給專案的收件人;內容涵蓋 ${withWeekday(covered.weekStart)} ~ ${withWeekday(covered.weekEnd)} 這段期間的工作狀況。`
      : `專案週報將於 ${when} 自動產生,並寄給各專案的收件人;內容涵蓋 ${withWeekday(covered.weekStart)} ~ ${withWeekday(covered.weekEnd)} 這段期間的工作狀況。`,
    "",
    "請在這個時間之前,到系統更新你負責的工作事項:",
    "・狀態與進度(做完的請切成「完成」)",
    "・開始、結束日期有變動的,改成實際的日期",
    "・卡住或有風險的,在項目裡留言說明",
    "",
    "週報以產生當下系統裡的資料為準,沒有更新的就會照舊資料呈現。",
    "",
    `系統網址:${args.baseUrl}`,
    "",
    `(這封信由系統自動寄出,在週報產生前 ${args.hours} 小時提醒一次。)`,
  ].join("\n");
  return { subject, text };
}

/**
 * 每位收件人(以 Email 為準)所屬的專案名稱:一個人在好幾個專案裡只收一封信,信裡把他的專案全部列出來。
 * programs 是會寄週報的專案與它的成員(使用者 id);沒有 Email 的人不會出現在結果裡。專案名稱照傳進來的順序、不重複。
 */
export function programsByRecipient(
  programs: { name: string; userIds: Iterable<string> }[],
  emailOf: ReadonlyMap<string, string>
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const program of programs) {
    for (const userId of program.userIds) {
      const email = emailOf.get(userId);
      if (!email) continue;
      const names = result.get(email) ?? [];
      if (!names.includes(program.name)) names.push(program.name);
      result.set(email, names);
    }
  }
  return result;
}
