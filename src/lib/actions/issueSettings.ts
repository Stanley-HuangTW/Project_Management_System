"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireIssueManager } from "@/lib/issueServer";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";

/** ISSUE TRACKER 專屬設定:ISSUE TRACKER 的管理者(含系統管理員)可以改。 */
async function requireManager() {
  return (await requireIssueManager()).session;
}

/** ISSUE TRACKER 的處理天數用工作天(排除週六日與公司假日)還是日曆天顯示。 */
export async function setIssueDayMode(mode: "WORKDAY" | "CALENDAR"): Promise<void> {
  const session = await requireManager();
  if (mode !== "WORKDAY" && mode !== "CALENDAR") throw new UserError("計算方式不正確");
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", issueDayMode: mode },
    update: { issueDayMode: mode },
  });
  await logAudit("SETTINGS", session.userId, `ISSUE TRACKER 處理天數改為${mode === "WORKDAY" ? "工作天" : "日曆天"}`);
  revalidatePath("/settings");
  revalidatePath("/issues", "layout");
}

/** 案件指派給人時,除了站內通知要不要另外寄 email。 */
export async function setIssueEmailNotify(enabled: boolean): Promise<void> {
  const session = await requireManager();
  await prisma.systemSettings.upsert({
    where: { id: "global" },
    create: { id: "global", issueEmailNotify: !!enabled },
    update: { issueEmailNotify: !!enabled },
  });
  await logAudit("SETTINGS", session.userId, `ISSUE TRACKER 指派時${enabled ? "也寄 email" : "只發站內通知"}`);
  revalidatePath("/settings");
}
