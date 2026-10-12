import { prisma } from "@/lib/prisma";
import { getStatusOptions, type CellValueJson } from "@/types/column";
import { classifyStatusOption, pickStatusColumnId } from "@/lib/itemEvents";
import type { ActivityDetail } from "@/lib/activityLog";

/**
 * 改的如果是看板的「狀態」欄,回傳要記在活動紀錄上的結構化資訊(切到哪個選項、算進行中還是完成);
 * 不是狀態欄(Type、Priority、Link 也是狀態型的欄位)就回 undefined,照一般的欄位修改記。
 */
export async function statusActivityDetail(
  boardId: string,
  column: { id: string; type: string; options: unknown },
  value: CellValueJson
): Promise<ActivityDetail | undefined> {
  if (column.type !== "STATUS") return undefined;
  const [columns, board] = await Promise.all([
    prisma.column.findMany({
      where: { boardId, type: "STATUS" },
      orderBy: { order: "asc" },
      select: { id: true, name: true, type: true },
    }),
    prisma.board.findUnique({ where: { id: boardId }, select: { reportDoneOptionIds: true } }),
  ]);
  if (pickStatusColumnId(columns) !== column.id) return undefined;

  const option = getStatusOptions(column.options).find((o) => o.id === value);
  return {
    kind: "STATUS",
    statusKind: option ? classifyStatusOption(option, board?.reportDoneOptionIds ?? []) : "other",
    statusLabel: option?.label ?? "未設定",
  };
}
