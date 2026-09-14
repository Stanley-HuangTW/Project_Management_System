"use server";

import { revalidatePath } from "next/cache";
import type { RiskKind, RiskStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { clampLevel } from "@/lib/riskRegister";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";

export type RiskInput = {
  kind: RiskKind;
  status: RiskStatus;
  title: string;
  description: string;
  probability: number;
  impact: number;
  /** 發生的話要多少錢。null = 還沒有人估過。 */
  costImpact: number | null;
  /** 機率的百分比,填了就蓋過 1-5 的級距。 */
  probabilityPct: number | null;
  mitigation: string;
  ownerId: string | null;
  dueDate: string | null;
  itemId: string | null;
};

export type RiskRow = RiskInput & {
  id: string;
  ownerName: string | null;
  itemName: string | null;
  createdAt: string;
};

export async function listRisks(boardId: string): Promise<RiskRow[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const risks = await prisma.riskEntry.findMany({
    where: { boardId },
    include: { owner: { select: { name: true } } },
  });
  // The linked items are read separately: itemId is a plain id (see the
  // schema) so a trashed item still shows its name here rather than blanking.
  const items = await prisma.item.findMany({
    where: { id: { in: risks.map((r) => r.itemId).filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const visibleIds = await visibleItemIdsForBoard(boardId, session);
  // The link stays; only the name of a private item is withheld.
  const itemNameById = new Map(
    items.filter((i) => visibleIds.has(i.id)).map((i) => [i.id, i.name])
  );

  return risks.map((risk) => ({
    id: risk.id,
    kind: risk.kind,
    status: risk.status,
    title: risk.title,
    description: risk.description ?? "",
    probability: risk.probability,
    impact: risk.impact,
    costImpact: risk.costImpact,
    probabilityPct: risk.probabilityPct,
    mitigation: risk.mitigation ?? "",
    ownerId: risk.ownerId,
    ownerName: risk.owner?.name ?? null,
    dueDate: risk.dueDate,
    itemId: risk.itemId,
    itemName: risk.itemId ? (itemNameById.get(risk.itemId) ?? null) : null,
    createdAt: risk.createdAt.toISOString(),
  }));
}

function normalize(input: RiskInput) {
  return {
    kind: input.kind,
    status: input.status,
    title: input.title.trim(),
    description: input.description.trim() || null,
    probability: clampLevel(input.probability),
    impact: clampLevel(input.impact),
    costImpact:
      input.costImpact !== null && Number.isFinite(input.costImpact) && input.costImpact >= 0
        ? Math.round(input.costImpact)
        : null,
    probabilityPct:
      input.probabilityPct !== null && Number.isFinite(input.probabilityPct)
        ? Math.min(100, Math.max(0, Math.round(input.probabilityPct)))
        : null,
    mitigation: input.mitigation.trim() || null,
    ownerId: input.ownerId || null,
    dueDate: input.dueDate || null,
    itemId: input.itemId || null,
  };
}

export async function createRisk(boardId: string, input: RiskInput): Promise<{ error?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const data = normalize(input);
  if (!data.title) return { error: "請輸入標題" };

  await prisma.riskEntry.create({ data: { ...data, boardId, createdById: session.userId } });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function updateRisk(riskId: string, input: RiskInput): Promise<{ error?: string }> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);
  const data = normalize(input);
  if (!data.title) return { error: "請輸入標題" };

  await prisma.riskEntry.update({ where: { id: riskId }, data });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

/** Quick triage from the register itself, without opening the whole form. */
export async function setRiskStatus(riskId: string, status: RiskStatus): Promise<{ error?: string }> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);

  await prisma.riskEntry.update({ where: { id: riskId }, data: { status } });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}

export async function deleteRisk(riskId: string): Promise<{ error?: string }> {
  const session = await requireSession();
  const existing = await prisma.riskEntry.findUnique({ where: { id: riskId }, select: { boardId: true } });
  if (!existing) return { error: "找不到這筆紀錄" };
  await requireBoardAccess(existing.boardId, session);

  await prisma.riskEntry.delete({ where: { id: riskId } });
  revalidatePath(`/boards/${existing.boardId}`);
  return {};
}
