"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { isBaseCurrency, BASE_CURRENCY } from "@/lib/currency";
import { logAudit } from "@/lib/activityLog";

export type RateRow = { code: string; rate: number; updatedAt: string };

/**
 * 匯率表。
 *
 * Doubles as the list of currencies the system offers: whatever is in here
 * shows up in the dropdowns. 台幣 is the base and is never a row.
 *
 * Decimal cannot cross the server/client boundary, so every rate leaves here
 * as a plain number.
 */
export async function listExchangeRates(): Promise<RateRow[]> {
  await requireSession();
  const rates = await prisma.exchangeRate.findMany({ orderBy: { code: "asc" } });
  return rates.map((r) => ({
    code: r.code,
    rate: Number(r.rate),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

export async function setExchangeRate(code: string, rate: number): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const normalised = code.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalised)) return { error: "請輸入三個字母的幣別代碼,例如 USD" };
  if (isBaseCurrency(normalised)) return { error: `${BASE_CURRENCY} 是基準幣別,不需要匯率` };
  if (!Number.isFinite(rate) || rate <= 0) return { error: "匯率必須大於 0" };

  const before = await prisma.exchangeRate.findUnique({ where: { code: normalised } });
  await prisma.exchangeRate.upsert({
    where: { code: normalised },
    create: { code: normalised, rate, updatedById: session.userId },
    update: { rate, updatedById: session.userId },
  });

  // 改匯率不會動到任何已經記好的帳——每一筆存的是它自己當下的匯率。這裡改的
  // 是「之後輸入時預填什麼」,以及未入帳訂單的匯率風險怎麼算。
  await logAudit(
    "COST",
    session.userId,
    `匯率 ${normalised}:${before ? Number(before.rate) : "(新增)"} → ${rate}`
  );
  revalidatePath("/settings");
  return {};
}

export async function deleteExchangeRate(code: string): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const used = await prisma.commitment.count({ where: { currency: code } });
  const spent = await prisma.expense.count({ where: { currency: code } });
  if (used + spent > 0) {
    return { error: `已經有 ${used + spent} 筆紀錄用這個幣別,刪掉匯率會讓它們的匯率風險算不出來。` };
  }

  await prisma.exchangeRate.delete({ where: { code } });
  await logAudit("COST", session.userId, `刪除匯率 ${code}`);
  revalidatePath("/settings");
  return {};
}
