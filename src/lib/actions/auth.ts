"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/safeNext";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { setSessionCookie, clearSessionCookie } from "@/lib/session";
import { sendMail } from "@/lib/mail";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export type LoginState = { error?: string };

export async function login(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "請輸入帳號與密碼" };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return { error: "帳號或密碼錯誤" };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return { error: `帳號已鎖定,請於約 ${minutesLeft} 分鐘後再試,或使用「忘記密碼」重設` };
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const attempts = user.failedLoginAttempts + 1;
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) },
      });
      return {
        error: `帳號或密碼錯誤,已連續失敗 ${MAX_LOGIN_ATTEMPTS} 次,帳號已鎖定 ${LOCKOUT_MINUTES} 分鐘`,
      };
    }
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: attempts } });
    return { error: `帳號或密碼錯誤(已失敗 ${attempts}/${MAX_LOGIN_ATTEMPTS} 次)` };
  }

  if (user.failedLoginAttempts > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  redirect(safeNextPath(formData.get("next")));
}

export async function logout() {
  await clearSessionCookie();
  redirect("/login");
}

export type ForgotPasswordState = { error?: string; message?: string };

export async function requestPasswordReset(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!email) {
    return { error: "請輸入 Email" };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = crypto.randomBytes(32).toString("hex");
    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const link = `${baseUrl}/reset-password?token=${token}`;
    await sendMail(
      user.email,
      "重設密碼",
      `請點擊以下連結重設您的密碼(1 小時內有效):\n${link}\n\n若您並未申請重設密碼,請忽略此信件。`
    );
  }

  return { message: "若該 Email 存在於系統中,重設密碼信件已寄出。" };
}

export type ResetPasswordState = { error?: string; success?: boolean };

export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) {
    return { error: "缺少重設連結,請重新申請忘記密碼" };
  }
  if (password.length < 8) {
    return { error: "密碼至少需要 8 個字元" };
  }
  if (password !== confirmPassword) {
    return { error: "兩次輸入的密碼不一致" };
  }

  const user = await prisma.user.findUnique({ where: { resetToken: token } });
  if (!user || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
    return { error: "重設連結無效或已過期,請重新申請" };
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      resetToken: null,
      resetTokenExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  return { success: true };
}
