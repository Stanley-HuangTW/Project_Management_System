"use server";

import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { crossBoardPredOptions, sameBoardOtherGroupPredOptions } from "@/lib/crossBoardPred";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import type { PredOption } from "@/types/board";

/**
 * 同一個專案群組裡,其他看板的工作項 —— 給 Pred 選單。
 *
 * 由選單自己在「勾了跨看板」那一刻去拿,而不是從頁面一路傳下來:Pred 欄位
 * 出現在表格的儲存格、項目卡片、人員分配視窗,還有儀表板上那幾個入口,而
 * 儀表板那邊根本沒有看板的完整資料可以傳。它只跟 boardId 有關,所以在需要
 * 的地方查一次最直接 —— 順帶也不必在每次開看板時就先扛著幾百個選項。
 */
export async function listCrossBoardPredOptions(boardId: string): Promise<PredOption[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  return crossBoardPredOptions(boardId);
}

/** 本看板其他分組的工作項 —— 給拿不到整個看板資料的入口(儀表板等)。 */
export async function listOtherGroupPredOptions(boardId: string, groupId: string): Promise<PredOption[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  return sameBoardOtherGroupPredOptions(boardId, groupId, await visibleItemIdsForBoard(boardId, session));
}
