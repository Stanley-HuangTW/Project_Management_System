import nodemailer from "nodemailer";

let transporter: ReturnType<typeof nodemailer.createTransport> | null | undefined;

function getTransporter() {
  if (transporter !== undefined) return transporter;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASSWORD) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
  });
  return transporter;
}

/**
 * 寄信,並且說得出結果。
 *
 * 通知那條路刻意吞掉失敗(寄不出去不該讓使用者的操作跟著失敗),但週報
 * 要能回報「到底寄出去了沒」—— 排程跑完只回一句成功、信卻沒寄出,那比
 * 沒有寄更糟。
 */
export async function sendMailChecked(
  to: string,
  subject: string,
  text: string
): Promise<{ ok: boolean; reason?: string }> {
  const t = getTransporter();
  if (!t) return { ok: false, reason: "SMTP 未設定" };

  try {
    await t.sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME || "Project Management System",
        address: process.env.SMTP_FROM || process.env.SMTP_USER || "",
      },
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    console.error("寄送 Email 通知失敗:", err);
    return { ok: false, reason: err instanceof Error ? err.message : "寄送失敗" };
  }
}

/** 寄不出去不會讓呼叫端跟著失敗 —— 通知都走這一支。 */
export async function sendMail(to: string, subject: string, text: string) {
  await sendMailChecked(to, subject, text);
}
