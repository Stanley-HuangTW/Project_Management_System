import { prisma } from "@/lib/prisma";
import type { IssueDayMode } from "@/lib/issueCase";

/** 系統設定:ISSUE TRACKER 的處理天數怎麼算(沒設定過 = 工作天)。不在 "use server" 檔案裡。 */
export async function issueDayModeSetting(): Promise<IssueDayMode> {
  const s = await prisma.systemSettings.findUnique({ where: { id: "global" }, select: { issueDayMode: true } });
  return s?.issueDayMode ?? "WORKDAY";
}
