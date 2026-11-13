import { prisma } from "@/lib/prisma";
import { getItemDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { computeWbsCodes } from "@/lib/wbs";
import { boardWithDataArgs } from "@/types/board";
import type { BoardWithData, ExternalPredecessor } from "@/types/board";

/**
 * 這個看板的工作項所指到的、位在同群組其他看板上的前置。
 *
 * 甘特圖的箭頭要有兩端:後續的長條在這張圖上,前置的不在,所以畫不出來 ——
 * 原本的做法是找不到前置就跳過,那條相依在看板甘特圖上完全不留痕跡。這裡
 * 把那些前置連同它們的日期撈回來,讓甘特圖能為它們各畫一列唯讀的長條,
 * 藍色虛線才有地方接。
 *
 * 只撈真的被指到的那幾個,不是整個兄弟看板 —— 一個 396 項的看板全部畫成
 * 幽靈列,原本的內容就看不見了。
 */
export async function externalPredecessors(boardId: string): Promise<ExternalPredecessor[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { programId: true, predColumnId: true },
  });
  if (!board?.programId || !board.predColumnId) return [];

  const cells = await prisma.cellValue.findMany({
    where: { columnId: board.predColumnId, item: { boardId, deletedAt: null } },
    select: { value: true },
  });

  // Pred 的格子長這樣:"id"、"id:FS"、"id:SS+2",逗號分隔多筆。
  const referenced = new Set<string>();
  for (const cell of cells) {
    if (typeof cell.value !== "string") continue;
    for (const raw of cell.value.split(",")) {
      const id = raw.trim().split(":")[0].replace(/[+-]\d+$/, "");
      if (id) referenced.add(id);
    }
  }
  if (referenced.size === 0) return [];

  const siblings = await prisma.board.findMany({
    where: { programId: board.programId, id: { not: boardId }, deletedAt: null },
    ...boardWithDataArgs,
  });

  const holidays = toHolidaySet(await listHolidays());
  const found: ExternalPredecessor[] = [];
  for (const sibling of siblings) {
    found.push(...externalRowsOf(sibling, (item) => referenced.has(item.id), holidays));
  }
  return found;
}

/** 別的看板上這幾個項目,整理成甘特圖唯讀列要的樣子(看板、分組、WBS、日期)。 */
export function externalRowsOf(
  sibling: BoardWithData,
  pick: (item: BoardWithData["items"][number]) => boolean,
  holidays: Set<string>
): ExternalPredecessor[] {
  const found: ExternalPredecessor[] = [];
  const mine = sibling.items.filter(pick);
  if (mine.length === 0) return found;

  const groupName = new Map(sibling.groups.map((g) => [g.id, g.name]));
  // WBS 是項目在它自己分組樹裡的位置,所以一個分組算一次。
  const wbs = new Map<string, string>();
  for (const group of sibling.groups) {
    for (const [id, code] of computeWbsCodes(sibling.items.filter((i) => i.groupId === group.id))) {
      wbs.set(id, code);
    }
  }

  for (const item of mine) {
    const range =
      sibling.ganttStartColumnId && sibling.ganttDurationColumnId
        ? getItemDateRange(
            item,
            sibling.ganttStartColumnId,
            sibling.ganttDurationColumnId,
            sibling.ganttDurationMode,
            holidays
          )
        : null;
    found.push({
      id: item.id,
      name: item.name,
      boardId: sibling.id,
      boardName: sibling.name,
      groupName: groupName.get(item.groupId) ?? "",
      wbsCode: wbs.get(item.id) ?? "",
      // 沒有日期就畫不出長條,但那一列仍然要在 —— 「有這條相依,只是對面
      // 還沒排日期」跟「沒有這條相依」是兩回事。
      start: range ? range.start.toISOString().slice(0, 10) : null,
      end: range ? range.end.toISOString().slice(0, 10) : null,
    });
  }

  return found;
}
