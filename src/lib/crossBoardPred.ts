import { prisma } from "@/lib/prisma";
import { compareWbsCodes, computeWbsCodes } from "@/lib/wbs";
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
      id: true,
      name: true,
      groups: {
        orderBy: { order: "asc" },
        select: {
          id: true,
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
      // group.items 是照 order 排的,而 order 是「在同一個父項底下的序號」——
      // 攤平之後全域比較會把樹打散,選單就變成 1.9.1、1.5.3.1、1.3.1 這種
      // 讀不出結構的順序。照 WBS 排才跟看板上看到的一致。
      const ordered = group.items
        .filter((item) => codes.has(item.id))
        .sort((a, b) => compareWbsCodes(codes.get(a.id)!, codes.get(b.id)!));
      for (const item of ordered) {
        const code = codes.get(item.id);
        if (!code) continue;
        options.push({
          id: item.id,
          code: `${sibling.name} · ${group.name} · ${code}`,
          name: item.name,
          boardId: sibling.id,
          boardName: sibling.name,
          groupId: group.id,
          groupName: group.name,
          wbsCode: code,
          parentId: item.parentId,
        });
      }
    }
  }
  return options;
}
