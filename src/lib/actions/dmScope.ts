"use server";

import { revalidatePath } from "next/cache";
import type { GroupDiscipline } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { hideBudgetOn } from "@/lib/dmScopeServer";
import type { DmScopeFlags } from "@/lib/dmScope";

const DM_DISCIPLINES: GroupDiscipline[] = ["SW", "HW", "ME", "QA", "PM"];

const FLAG_LABELS: Record<keyof DmScopeFlags, string> = {
  limitItems: "工作項",
  limitLabour: "人力表與人力規劃彙總",
  limitBudget: "預算金額",
};

/**
 * 設定某個職能的 DM 可以看到的範圍(只有管理者)。三項都關掉就是不限制,跟沒設定一樣。
 * 錯誤用回傳值帶回去(正式環境丟出來的訊息會被洗成一句通用的話)。
 */
export async function setDmScope(discipline: GroupDiscipline, flags: DmScopeFlags): Promise<{ error?: string }> {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "只有管理者能設定 DM 的可見範圍" };
  if (!DM_DISCIPLINES.includes(discipline)) return { error: "不認得這個職能" };

  const next: DmScopeFlags = {
    limitItems: flags.limitItems === true,
    limitLabour: flags.limitLabour === true,
    limitBudget: flags.limitBudget === true,
  };
  const before = await prisma.dmScope.findUnique({ where: { discipline } });
  await prisma.dmScope.upsert({ where: { discipline }, create: { discipline, ...next }, update: next });

  const describe = (f: Partial<DmScopeFlags> | null) => {
    const on = (Object.keys(FLAG_LABELS) as (keyof DmScopeFlags)[]).filter((k) => f?.[k]).map((k) => FLAG_LABELS[k]);
    return on.length > 0 ? `只看本職能的${on.join("、")}` : "不限制";
  };
  await logAudit("SETTINGS", session.userId, `${discipline} DM 的可見範圍:${describe(before)} → ${describe(next)}`);
  revalidatePath("/settings");
  revalidatePath("/boards", "layout");
  revalidatePath("/dashboard");
  return {};
}

/** 預算分頁用:這個人在這塊看板上看不到預算金額的話,畫面就不放階段預算、NRE 報價單、樣機 BOM 這幾個分頁。 */
export async function getMyBudgetAccess(boardId: string): Promise<{ hideBudget: boolean }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  return { hideBudget: await hideBudgetOn(boardId, session) };
}
