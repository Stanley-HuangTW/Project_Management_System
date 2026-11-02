import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionPayload } from "@/lib/jwt";
import { sendMailChecked } from "@/lib/mail";
import {
  programSubset,
  renderWeeklyReportMarkdown,
  reportWeekLabel,
  weeklyReportSubject,
  type WeeklyReportDiff,
} from "@/lib/weeklyReport";
import type { WeeklyReportSnapshot } from "@/lib/weeklyReportServer";

/**
 * 把產好的週報送出去:落一份檔案,再寄一封信。
 *
 * 兩邊都回報實際結果而不是「已送出」就算數 —— 排程跑完只回一句成功、信
 * 卻沒寄出去,比沒有寄還糟,因為沒有人會去查。
 *
 * 檔案不放在 public/uploads 底下:那個目錄是對外服務的,週報裡有預算與
 * 人力,不該靠一個難猜的網址當作保護。
 */

/** 一個專案一封信的結果。 */
export type MailOutcome = { programName: string | null; subject: string; ok: boolean; reason?: string };

export type DeliveryResult = {
  file: { ok: boolean; path?: string; reason?: string };
  /** 寄給要求產生週報的人:每個專案各一封,ok = 每一封都寄出去了。 */
  mail: { ok: boolean; to?: string; reason?: string; messages: MailOutcome[] };
};

export function reportDir(): string {
  return process.env.WEEKLY_REPORT_DIR || "/app/weekly-reports";
}

/** 檔名裡的人名要能當檔名用 —— 斜線跟冒號在 Windows 上會直接失敗。 */
function safeName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "user";
}

export async function deliverWeeklyReport(
  session: SessionPayload,
  snapshot: WeeklyReportSnapshot,
  diff: WeeklyReportDiff,
  markdown: string
): Promise<DeliveryResult> {
  const label = reportWeekLabel(snapshot.weekEnd).replace(" ", "-");
  const base = `${snapshot.weekStart}_${label}_${safeName(session.name)}`;

  const file = await writeReportFiles(base, snapshot, markdown);
  const mail = await mailReport(session, snapshot, diff);
  return { file, mail };
}

async function writeReportFiles(
  base: string,
  snapshot: WeeklyReportSnapshot,
  markdown: string
): Promise<DeliveryResult["file"]> {
  const dir = reportDir();
  try {
    await mkdir(dir, { recursive: true });
    const mdPath = path.join(dir, `${base}.md`);
    await writeFile(mdPath, markdown, "utf8");
    // JSON 一起存:之後要拿去做別的統計時,不必反過來解析 Markdown。
    await writeFile(path.join(dir, `${base}.json`), JSON.stringify(snapshot, null, 2), "utf8");
    return { ok: true, path: mdPath };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "寫檔失敗" };
  }
}

/**
 * 一個專案寄一封,標題「{專案名稱}週報 W41 (起 ~ 迄)」,內容只有那個專案的部分——
 * 看板跨好幾個專案時,混在一封信裡的週報讀的人得自己分。
 */
async function mailReport(
  session: SessionPayload,
  snapshot: WeeklyReportSnapshot,
  diff: WeeklyReportDiff
): Promise<DeliveryResult["mail"]> {
  if (!session.email) return { ok: false, reason: "這個帳號沒有 email", messages: [] };
  if (snapshot.programs.length === 0) {
    return { ok: false, to: session.email, reason: "沒有可以寄的專案週報(看不到任何看板)", messages: [] };
  }

  const messages: MailOutcome[] = [];
  for (const program of snapshot.programs) {
    const subset = programSubset(snapshot, diff, program.programName);
    const subject = weeklyReportSubject(program.programName, snapshot.weekStart, snapshot.weekEnd);
    const markdown = renderWeeklyReportMarkdown(subset.data, subset.diff, {
      title: `${program.programName ?? "未歸屬專案群組"}週報`,
    });
    // 一封寄失敗不該讓後面的專案也收不到。
    const result = await sendMailChecked(session.email, subject, markdown);
    messages.push({ programName: program.programName, subject, ok: result.ok, reason: result.reason });
  }
  const failed = messages.filter((m) => !m.ok);
  return { ok: failed.length === 0, to: session.email, reason: failed[0]?.reason, messages };
}

export type ProgramDeliveryResult = {
  file: { ok: boolean; path?: string; reason?: string };
  /** 每個收件人各自的結果——一個信箱寄失敗不該讓呼叫端以為整批都沒寄出去。 */
  mail: { to: string; ok: boolean; reason?: string }[];
};

/**
 * 專案週報分發:落一份檔案(用專案名字當檔名,不是人名),再逐一寄給每個
 * 收件人。跟 deliverWeeklyReport 不寫進 WeeklyReport 表是同一件事的另一面
 * ——這裡也不掛在任何一個使用者身上,分開一支函式。
 */
export async function deliverProgramReport(
  programName: string,
  snapshot: WeeklyReportSnapshot,
  markdown: string,
  recipientEmails: string[]
): Promise<ProgramDeliveryResult> {
  const label = reportWeekLabel(snapshot.weekEnd).replace(" ", "-");
  const base = `${snapshot.weekStart}_${label}_${safeName(programName)}`;
  const file = await writeReportFiles(base, snapshot, markdown);

  const subject = `【${programName}】週報 ${reportWeekLabel(snapshot.weekEnd)}(${snapshot.weekStart} ~ ${snapshot.weekEnd})`;
  const mail: ProgramDeliveryResult["mail"] = [];
  for (const to of recipientEmails) {
    const result = await sendMailChecked(to, subject, markdown);
    mail.push({ to, ok: result.ok, reason: result.reason });
  }
  return { file, mail };
}
