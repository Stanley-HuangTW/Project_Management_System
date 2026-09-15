"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess, canAccessBoard } from "@/lib/boardAccess";
import { analyzeDelays, type DelayAnalysis } from "@/lib/delayAnalysis";
import { gatherDelayInputs } from "@/lib/delayInputs";

/**
 * 延遲追因 for one board: which task moved further than the chain moved it.
 *
 * When the board belongs to a 專案群組 the whole group is read, not just this
 * board — a predecessor sitting on a sibling board still has to be there, or
 * the slip it handed down is counted as this task's own and the wrong task is
 * named. Only this board's tasks are reported.
 */
export async function getDelayAnalysis(boardId: string): Promise<DelayAnalysis> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { programId: true },
  });

  const networkIds = board?.programId
    ? (await prisma.board.findMany({
        where: { programId: board.programId, deletedAt: null },
        select: { id: true },
      })).map(
        (b) => b.id
      )
    : [boardId];
  // A sibling board the session cannot open still takes part in the maths —
  // its dates move this board's tasks either way — but nothing on it can be
  // named, which is what the visibility filter below enforces.
  const { inputs, visibleIds } = await gatherDelayInputs(networkIds, session);

  const ownIds = new Set(
    (await prisma.item.findMany({ where: { boardId, deletedAt: null }, select: { id: true } })).map(
      (i) => i.id
    )
  );
  const scope = new Set([...ownIds].filter((id) => visibleIds.has(id)));
  return analyzeDelays(inputs, scope);
}

/**
 * 延遲追因 for a whole 專案群組 — the one that answers "誰把整個專案往後推"
 * when the chain runs across boards.
 */
export async function getProgramDelayAnalysis(programId: string): Promise<DelayAnalysis> {
  const session = await requireSession();
  const boards = await prisma.board.findMany({
    where: { programId, deletedAt: null },
    select: { id: true },
  });
  const allowed: string[] = [];
  for (const board of boards) {
    if (await canAccessBoard(session, board.id)) allowed.push(board.id);
  }
  if (allowed.length === 0) return { projectDelay: 0, culprits: [], noBaseline: true };

  const { inputs, visibleIds } = await gatherDelayInputs(allowed, session);
  return analyzeDelays(inputs, visibleIds);
}
