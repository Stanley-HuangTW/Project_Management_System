"use server";

import type { NreCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBudget } from "@/lib/actions/budget";
import { MAX_NRE_LINES_PER_PHASE, resolveNreAmount, validateNreLine, type NreCategoryKey, type NreLineInput } from "@/lib/nre";

/**
 * NRE 報價單(掛在預算階段上)。
 *
 * 看得到這個看板的人都看得到;編輯的權限跟預算一樣(管理者、看板擁有者、該看板任一分組的 Team Leader)。
 * 這裡的金額是估算與報價的依據,不會寫進核准預算。
 * 驗證不過、沒權限一律用回傳值帶回去(伺服器動作丟出的訊息在正式環境會被遮掉)。
 */

export type NreLineRow = {
  id: string;
  category: NreCategoryKey;
  description: string;
  basis: string;
  vendor: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  note: string;
};

export type NreSheet = {
  phaseName: string;
  lines: NreLineRow[];
  canEdit: boolean;
};

function toRow(l: {
  id: string;
  category: NreCategory;
  description: string;
  basis: string | null;
  vendor: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  note: string | null;
}): NreLineRow {
  return {
    id: l.id,
    category: l.category,
    description: l.description,
    basis: l.basis ?? "",
    vendor: l.vendor ?? "",
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
    note: l.note ?? "",
  };
}

export async function getNreSheet(phaseId: string): Promise<NreSheet | null> {
  const session = await requireSession();
  const phase = await prisma.budgetPhase.findUnique({ where: { id: phaseId }, select: { name: true, boardId: true } });
  if (!phase) return null;
  await requireBoardAccess(phase.boardId, session);
  const lines = await prisma.nreLine.findMany({
    where: { phaseId },
    orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
  });
  return {
    phaseName: phase.name,
    lines: lines.map(toRow),
    canEdit: await canEditBudget({ kind: "phase", id: phaseId }, session),
  };
}

async function requireEdit(phaseId: string) {
  const session = await requireSession();
  const phase = await prisma.budgetPhase.findUnique({ where: { id: phaseId }, select: { name: true, boardId: true } });
  if (!phase) return { error: "找不到這個階段" as const };
  await requireBoardAccess(phase.boardId, session);
  if (!(await canEditBudget({ kind: "phase", id: phaseId }, session))) {
    return { error: "權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯預算與報價單" as const };
  }
  return { session, phase };
}

/** 新增(沒有 id)或修改(有 id)一列。數量與單價都有時,金額以相乘為準,存的是算好的金額。 */
export async function saveNreLine(
  phaseId: string,
  input: NreLineInput & { id?: string }
): Promise<{ error?: string; id?: string }> {
  const guard = await requireEdit(phaseId);
  if ("error" in guard) return { error: guard.error };
  const { session, phase } = guard;

  const invalid = validateNreLine(input);
  if (invalid) return { error: invalid };
  const amount = resolveNreAmount(input);
  const data = {
    category: input.category,
    description: input.description.trim(),
    basis: input.basis.trim() || null,
    vendor: input.vendor.trim() || null,
    quantity: input.quantity,
    unitPrice: input.unitPrice === null ? null : Math.round(input.unitPrice),
    amount,
    note: input.note.trim() || null,
  };

  if (input.id) {
    const existing = await prisma.nreLine.findUnique({ where: { id: input.id }, select: { phaseId: true, amount: true } });
    if (!existing || existing.phaseId !== phaseId) return { error: "找不到這一列" };
    await prisma.nreLine.update({ where: { id: input.id }, data });
    await logAudit("COST", session.userId, `${phase.name} 的 NRE 報價單「${data.description}」:${existing.amount} → ${amount} 元`);
    return { id: input.id };
  }

  const [count, last] = await Promise.all([
    prisma.nreLine.count({ where: { phaseId } }),
    prisma.nreLine.findFirst({ where: { phaseId, category: input.category }, orderBy: { order: "desc" }, select: { order: true } }),
  ]);
  if (count >= MAX_NRE_LINES_PER_PHASE) return { error: `一個階段的報價單最多 ${MAX_NRE_LINES_PER_PHASE} 列` };
  const created = await prisma.nreLine.create({
    data: { ...data, phaseId, order: (last?.order ?? -1) + 1, createdById: session.userId },
  });
  await logAudit("COST", session.userId, `${phase.name} 的 NRE 報價單新增「${data.description}」${amount} 元`);
  return { id: created.id };
}

export async function deleteNreLine(phaseId: string, lineId: string): Promise<{ error?: string }> {
  const guard = await requireEdit(phaseId);
  if ("error" in guard) return { error: guard.error };
  const { session, phase } = guard;
  const existing = await prisma.nreLine.findUnique({ where: { id: lineId }, select: { phaseId: true, description: true, amount: true } });
  if (!existing || existing.phaseId !== phaseId) return { error: "找不到這一列" };
  await prisma.nreLine.delete({ where: { id: lineId } });
  await logAudit("COST", session.userId, `${phase.name} 的 NRE 報價單刪除「${existing.description}」${existing.amount} 元`);
  return {};
}
