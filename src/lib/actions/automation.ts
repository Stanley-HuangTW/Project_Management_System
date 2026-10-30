"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireStructureAccess } from "@/lib/permissions";
import { requireBoardAccess } from "@/lib/boardAccess";
import type { CellValueJson } from "@/types/column";
import { UserError } from "@/lib/userError";

export async function listRules(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  return prisma.automationRule.findMany({
    where: { boardId },
    include: { triggerColumn: true, notifyUser: true, setColumn: true, moveToGroup: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function createRule(
  boardId: string,
  name: string,
  triggerColumnId: string,
  triggerValue: string,
  actions: {
    notifyUserId?: string | null;
    setColumnId?: string | null;
    setValue?: CellValueJson;
    moveToGroupId?: string | null;
  }
) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  const trimmed = name.trim();
  if (!trimmed) throw new UserError("規則名稱不可為空");

  await prisma.automationRule.create({
    data: {
      boardId,
      name: trimmed,
      triggerColumnId,
      triggerValue,
      notifyUserId: actions.notifyUserId || null,
      setColumnId: actions.setColumnId || null,
      setValue: actions.setColumnId ? (actions.setValue ?? Prisma.JsonNull) : Prisma.JsonNull,
      moveToGroupId: actions.moveToGroupId || null,
    },
  });

  revalidatePath(`/boards/${boardId}`);
}

export async function deleteRule(ruleId: string, boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.automationRule.delete({ where: { id: ruleId } });
  revalidatePath(`/boards/${boardId}`);
}

export async function toggleRule(ruleId: string, boardId: string, enabled: boolean) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  requireStructureAccess(session.role);
  await prisma.automationRule.update({ where: { id: ruleId }, data: { enabled } });
  revalidatePath(`/boards/${boardId}`);
}
