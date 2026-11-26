"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { mergeUiPrefs, type UiPrefs } from "@/lib/uiPrefs";

/**
 * 存這個人自己的畫面設定(顯示背景、各看板上次停的分頁與捲動位置……),見 uiPrefs.ts。
 * 只併進有給的欄位。管理者「代操作」別人的帳號時不存 —— 那是在看對方的畫面,不該改到對方自己的設定。
 */
export async function saveUiPrefs(patch: UiPrefs): Promise<void> {
  const session = await requireSession();
  if (session.impersonatorId) return;
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { uiPrefs: true } });
  const merged = mergeUiPrefs(me?.uiPrefs, patch);
  await prisma.user.update({ where: { id: session.userId }, data: { uiPrefs: merged as Prisma.InputJsonValue } });
}
