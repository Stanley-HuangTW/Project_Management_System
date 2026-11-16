"use server";

import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { loadScheduleExplainInput } from "@/lib/predecessorLink";
import { explainSchedule, type ItemScheduleExplanation } from "@/lib/scheduleExplain";

/**
 * 項目卡片 / 人員分配視窗的「這個日期是怎麼來的」:開始日、完成日各是被誰決定的,
 * 以及相關項目「前置」那一段(含跨分組、跨看板的前置)每一個的關係、Lag、有沒有決定這個項目的日期。
 * 讀排程引擎同一份網路,只讀不寫。看板排不出日期(沒設好欄位)或找不到項目回 null。
 */
export async function explainItemSchedule(boardId: string, itemId: string): Promise<ItemScheduleExplanation | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const loaded = await loadScheduleExplainInput(boardId, itemId);
  if (!loaded) return null;
  const explanation = explainSchedule(loaded.input);

  return {
    start: explanation.start,
    finish: explanation.finish,
    predecessors: loaded.preds
      .map((pred) => {
        const driver = explanation.drivers.get(pred.itemId);
        return {
          itemId: pred.itemId,
          wbsCode: pred.wbsCode,
          name: pred.name,
          link: pred.link,
          lag: pred.lag,
          start: pred.start,
          end: pred.end,
          drives: driver?.drives ?? null,
          note: driver?.note ?? null,
          boardName: pred.boardId && pred.boardId !== loaded.homeBoardId ? (loaded.boardNames.get(pred.boardId) ?? "") : null,
        };
      })
      .sort((a, b) => a.wbsCode.localeCompare(b.wbsCode, undefined, { numeric: true })),
  };
}
