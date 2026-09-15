import { prisma } from "@/lib/prisma";
import { computeWbsCodes } from "@/lib/wbs";
import type { PredOption } from "@/types/board";

/**
 * 同一個專案群組裡,其他看板的工作項 —— 給 Pred 選單用。
 *
 * 排程引擎一直都吃跨看板的前置(buildScheduleContext 會把整個群組的看板
 * 載成一張網路),但選單只列得出同一個看板裡其他分組的項目,所以那條路
 * 實際上沒人走得到。這支就是把另一半補上。
 *
 * 代號前面冠上看板名與分組名:WBS 是項目在它自己分組樹裡的位置,「1.2」
 * 在每個分組、每個看板都各指一個不同的東西,不冠名就分不出來。
 */
export async function crossBoardPredOptions(boardId: string): Promise<PredOption[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { programId: true },
  });
  if (!board?.programId) return [];

  const siblings = await prisma.board.findMany({
    where: { programId: board.programId, id: { not: boardId }, deletedAt: null },
    orderBy: { name: "asc" },
    select: {
      name: true,
      groups: {
        orderBy: { order: "asc" },
        select: {
          name: true,
          items: {
            where: { deletedAt: null },
            orderBy: { order: "asc" },
            select: { id: true, name: true, parentId: true, order: true },
          },
        },
      },
    },
  });

  const options: PredOption[] = [];
  for (const sibling of siblings) {
    for (const group of sibling.groups) {
      const codes = computeWbsCodes(group.items);
      for (const item of group.items) {
        const code = codes.get(item.id);
        if (!code) continue;
        options.push({
          id: item.id,
          code: `${sibling.name} · ${group.name} · ${code}`,
          name: item.name,
        });
      }
    }
  }
  return options;
}
