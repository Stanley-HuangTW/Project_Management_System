import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionPayload } from "@/lib/jwt";
import { sendMailChecked } from "@/lib/mail";
import { isoWeekLabel } from "@/lib/weeklyReport";
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

export type DeliveryResult = {
  file: { ok: boolean; path?: string; reason?: string };
  mail: { ok: boolean; to?: string; reason?: string };
};

function reportDir(): string {
  return process.env.WEEKLY_REPORT_DIR || "/app/weekly-reports";
}

/** 檔名裡的人名要能當檔名用 —— 斜線跟冒號在 Windows 上會直接失敗。 */
function safeName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40) || "user";
}

export async function deliverWeeklyReport(
  session: SessionPayload,
  snapshot: WeeklyReportSnapshot,
  markdown: string
): Promise<DeliveryResult> {
  const label = isoWeekLabel(snapshot.weekStart).replace(" ", "-");
  const base = `${snapshot.weekStart}_${label}_${safeName(session.name)}`;

  const file = await writeReportFiles(base, snapshot, markdown);
  const mail = await mailReport(session, snapshot, markdown);
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

async function mailReport(
  session: SessionPayload,
  snapshot: WeeklyReportSnapshot,
  markdown: string
): Promise<DeliveryResult["mail"]> {
  if (!session.email) return { ok: false, reason: "這個帳號沒有 email" };
  const subject = `週報 ${isoWeekLabel(snapshot.weekStart)}(${snapshot.weekStart} ~ ${snapshot.weekEnd})`;
  const result = await sendMailChecked(session.email, subject, markdown);
  return { ok: result.ok, to: session.email, reason: result.reason };
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
  const label = isoWeekLabel(snapshot.weekStart).replace(" ", "-");
  const base = `${snapshot.weekStart}_${label}_${safeName(programName)}`;
  const file = await writeReportFiles(base, snapshot, markdown);

  const subject = `【${programName}】週報 ${isoWeekLabel(snapshot.weekStart)}(${snapshot.weekStart} ~ ${snapshot.weekEnd})`;
  const mail: ProgramDeliveryResult["mail"] = [];
  for (const to of recipientEmails) {
    const result = await sendMailChecked(to, subject, markdown);
    mail.push({ to, ok: result.ok, reason: result.reason });
  }
  return { file, mail };
}
