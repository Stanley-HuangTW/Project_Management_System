import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activityLog";
import { statusActivityDetail } from "@/lib/statusEvent";
import { pickStatusColumnId } from "@/lib/itemEvents";
import { summaryStatusTarget } from "@/lib/summaryStatus";
import { notifyItemAssignees } from "@/lib/notify";
import { executeAutomationRules } from "@/lib/automation";
import { getStatusOptions } from "@/types/column";

/**
 * 子項目的狀態切成進行中(或完成)之後呼叫:往上一層一層看,上層(摘要)項目還沒開始的,
 * 自動切成進行中,而且在它的活動紀錄寫明是因為哪個子項目、切成什麼。
 * 不看權限 —— 這是子項目變了的連動結果,不是有人去改上層的欄位。
 */
export async function syncSummaryStatusFromChild(boardId: string, itemId: string, actorId: string, editedColumnId: string): Promise<void> {
  const [columns, board] = await Promise.all([
    prisma.column.findMany({ where: { boardId, type: "STATUS" }, orderBy: { order: "asc" }, select: { id: true, name: true, type: true, options: true } }),
    prisma.board.findUnique({ where: { id: boardId }, select: { reportDoneOptionIds: true, reportPausedOptionIds: true } }),
  ]);
  const statusColumnId = pickStatusColumnId(columns);
  if (!statusColumnId || statusColumnId !== editedColumnId) return;
  const column = columns.find((c) => c.id === statusColumnId)!;
  const labelOf = (value: unknown) => getStatusOptions(column.options).find((o) => o.id === value)?.label ?? "未設定";

  const origin = await prisma.item.findUnique({ where: { id: itemId }, select: { name: true, parentId: true, cellValues: { where: { columnId: statusColumnId } } } });
  if (!origin) return;
  const originValue = origin.cellValues[0]?.value;
  const originLabel = labelOf(originValue);

  let childValue: unknown = originValue;
  let parentId = origin.parentId;
  let childName = origin.name;
  let depth = 0;
  const seen = new Set<string>([itemId]);
  while (parentId && !seen.has(parentId) && depth++ < 30) {
    seen.add(parentId);
    const parent = await prisma.item.findUnique({
      where: { id: parentId },
      select: { id: true, name: true, parentId: true, deletedAt: true, cellValues: { where: { columnId: statusColumnId } } },
    });
    if (!parent || parent.deletedAt) return;
    const parentValue = parent.cellValues[0]?.value;
    const target = summaryStatusTarget({
      columnOptions: column.options,
      doneOptionIds: board?.reportDoneOptionIds ?? [],
      pausedOptionIds: board?.reportPausedOptionIds ?? [],
      childValue,
      parentValue,
    });
    if (!target) return;

    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: parent.id, columnId: statusColumnId } },
      create: { itemId: parent.id, columnId: statusColumnId, value: target.optionId },
      update: { value: target.optionId },
    });
    // 往上第一層是「子項目」,更高的是「下層項目」(中間那一層也是自動切的);起因永遠寫最先動的那個項目。
    const because = depth === 1 ? `因子項目「${childName}」切換為 ${originLabel}` : `因下層項目「${origin.name}」切換為 ${originLabel}`;
    const oldLabel = labelOf(parentValue);
    await logActivity(
      parent.id,
      actorId,
      `「${column.name}」自動更新:${oldLabel} → ${target.label}(${because})`,
      await statusActivityDetail(boardId, column, target.optionId)
    );
    await notifyItemAssignees(prisma, parent.id, actorId, "UPDATED", `「${column.name}」:${oldLabel} → ${target.label}(${because})`);
    await executeAutomationRules(boardId, parent.id, statusColumnId, target.optionId, actorId);

    childValue = target.optionId;
    childName = parent.name;
    parentId = parent.parentId;
  }
}
