"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { UserError } from "@/lib/userError";
import { logAudit } from "@/lib/activityLog";
import { FEEDBACK_DAILY_LIMIT, normalizeFeedback, type FeedbackCsvRow, type FeedbackInput } from "@/lib/feedback";
import { normalizeContext } from "@/lib/feedbackContext";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTE_MAX = 1000;

/** 台北時間的 YYYY-MM-DD HH:mm(資料庫存的是 UTC)。 */
const taipei = (d: Date): string => new Date(d.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");

async function requireAdmin() {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足:僅管理者可以看與處理使用者回報");
  return session;
}

/**
 * 使用者按畫面右下角「?」(或選取畫面上的元素)寫下的問題。誰都能送;誰送的、在哪個畫面由伺服器記(姓名與 Email 取自登入的帳號,
 * 不信畫面傳來的),畫面帶來的網址、畫面名稱與手冊錨點只當作說明用,先檢查過(見 normalizeFeedback)。
 *
 * 管理者代操作別人的帳號時不能送:回報會變成被代操作的人寫的。
 */
export async function submitFeedback(input: Partial<FeedbackInput>): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.impersonatorId) return { error: "你正在代操作別人的帳號,不能送出回報(會變成對方寫的)。" };

  const checked = normalizeFeedback(input);
  if ("error" in checked) return { error: checked.error };

  const sentToday = await prisma.userFeedback.count({
    where: { userId: session.userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if (sentToday >= FEEDBACK_DAILY_LIMIT) return { error: `今天已經送了 ${sentToday} 則了(一天最多 ${FEEDBACK_DAILY_LIMIT} 則),請明天再送,或直接跟管理者說。` };

  await prisma.userFeedback.create({
    data: {
      ...checked.value,
      context: checked.value.context as Prisma.InputJsonValue | undefined,
      userId: session.userId,
      userName: session.name,
      userEmail: session.email,
    },
  });
  revalidatePath("/feedback");
  return {};
}

export type FeedbackRow = FeedbackCsvRow & { id: string };

/** 管理者頁:所有回報,新的在前(最多 500 則)。 */
export async function listFeedback(): Promise<FeedbackRow[]> {
  await requireAdmin();
  const rows = await prisma.userFeedback.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  return rows.map((r) => ({
    id: r.id,
    createdAt: taipei(r.createdAt),
    userName: r.userName,
    userEmail: r.userEmail,
    pageLabel: r.pageLabel,
    path: r.path,
    manualAnchor: r.manualAnchor,
    message: r.message,
    status: r.status,
    adminNote: r.adminNote,
    resolvedAt: r.resolvedAt ? taipei(r.resolvedAt) : null,
    resolvedByName: r.resolvedByName,
    // 讀出來也再檢查一次:資料庫裡的 JSON 不保證是現在這個形狀。
    context: normalizeContext(r.context),
  }));
}

/** 標成已處理(可以留一段說明)或重新開啟。重新開啟會清掉處理人與時間,說明留著。 */
export async function setFeedbackStatus(id: string, status: "OPEN" | "RESOLVED", adminNote?: string): Promise<{ error?: string }> {
  const session = await requireAdmin();
  const note = (adminNote ?? "").trim();
  if (note.length > NOTE_MAX) return { error: `說明太長了(上限 ${NOTE_MAX} 字)` };

  const existing = await prisma.userFeedback.findUnique({ where: { id }, select: { id: true, userName: true } });
  if (!existing) return { error: "找不到這則回報(可能已經被刪除)" };

  await prisma.userFeedback.update({
    where: { id },
    data:
      status === "RESOLVED"
        ? { status, adminNote: note || null, resolvedAt: new Date(), resolvedByName: session.name }
        : { status, adminNote: note || null, resolvedAt: null, resolvedByName: null },
  });
  await logAudit("SETTINGS", session.userId, `${status === "RESOLVED" ? "標為已處理" : "重新開啟"}「${existing.userName}」的使用者回報`);
  revalidatePath("/feedback");
  return {};
}
