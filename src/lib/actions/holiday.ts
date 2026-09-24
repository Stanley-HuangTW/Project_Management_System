"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAdmin } from "@/lib/permissions";
import { logAudit } from "@/lib/activityLog";

function isValidDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(raw).getTime());
}

/** "2026-09-25" 的下一天。用 UTC 算,日期字串一路上都是 UTC 慣例。 */
function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const MAX_RANGE_DAYS = 31;

/**
 * 新增一個或連續一段國定假日(春節這種連假,不用一天一天點)。
 *
 * endDate 沒給就是單日,行為跟以前完全一樣——多天的話同一個名稱套用到
 * 範圍裡每一天,一次寫進去。
 *
 * 驗證錯誤用回傳值講,不用 throw——Next.js 在正式環境下會把 Server
 * Action 丟出來的錯誤訊息整個抹掉(只留一句通用訊息給前端),丟出去的
 * 「一次最多新增 31 天」這種話,使用者永遠看不到,只會看到一個莫名其妙
 * 的當機畫面。這個檔案原本的驗證錯誤就是用 throw,只是剛好從來沒有真的
 * 被使用者觸發過(原生日期選擇器擋掉了格式錯誤,單日新增也不會碰到範圍
 * 上限),這次改天數範圍才第一次真的踩到。
 */
export async function addHoliday(
  startDate: string,
  name: string,
  endDate?: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  requireBoardAdmin(session.role);

  if (!isValidDate(startDate)) return { error: "起始日期格式錯誤" };
  const end = endDate || startDate;
  if (!isValidDate(end)) return { error: "結束日期格式錯誤" };
  if (end < startDate) return { error: "結束日期不可早於起始日期" };

  const dates: string[] = [];
  for (let cursor = startDate; cursor <= end; cursor = nextDay(cursor)) {
    dates.push(cursor);
    if (dates.length > MAX_RANGE_DAYS) {
      return { error: `一次最多新增 ${MAX_RANGE_DAYS} 天,範圍太大請分批新增` };
    }
  }

  const trimmedName = name.trim() || "假日";
  await prisma.$transaction(
    dates.map((date) =>
      prisma.holiday.upsert({
        where: { date },
        create: { date, name: trimmedName },
        update: { name: trimmedName },
      })
    )
  );
  // 假日表決定「工作天」怎麼算,動它會移動每一張甘特圖的結束日。
  await logAudit(
    "SETTINGS",
    session.userId,
    dates.length === 1
      ? `新增國定假日:${dates[0]} ${trimmedName}`
      : `新增國定假日:${dates[0]} ~ ${dates[dates.length - 1]} ${trimmedName}(共 ${dates.length} 天)`
  );

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  revalidatePath("/boards/[boardId]", "page");
  return {};
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
