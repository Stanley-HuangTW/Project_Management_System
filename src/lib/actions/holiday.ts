"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";

export async function addHoliday(date: string, name: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new Error("日期格式錯誤");
  }
  const trimmedName = name.trim() || "假日";

  await prisma.holiday.upsert({
    where: { date },
    create: { date, name: trimmedName },
    update: { name: trimmedName },
  });
  // 假日表決定「工作天」怎麼算,動它會移動每一張甘特圖的結束日。
  await logAudit("SETTINGS", session.userId, `新增國定假日:${date} ${trimmedName}`);

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
}

export async function removeHoliday(id: string) {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  const removed = await prisma.holiday.findUnique({ where: { id }, select: { date: true, name: true } });
  await prisma.holiday.delete({ where: { id } });
  await logAudit("SETTINGS", session.userId, `刪除國定假日:${removed?.date ?? id} ${removed?.name ?? ""}`);

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
}
