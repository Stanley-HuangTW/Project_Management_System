"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { OrgUnit } from "@/lib/orgUnits";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBudget } from "@/lib/actions/budget";
import { resyncBomMaterial } from "@/lib/actions/bom";
import { summariseProtoPlan, type ProtoSummary } from "@/lib/protoPlan";

export type ProtoPlanView = {
  /** 階段照人力表的順序 —— 兩張表共用同一組階段。 */
  phases: { id: string; name: string }[];
  summary: ProtoSummary;
  /** 用途下拉的其中一組:公司組織單位。 */
  units: OrgUnit[];
  canEdit: boolean;
};

async function requireProtoAdmin(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const first = await prisma.item.findFirst({
    where: { boardId, parentId: null, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const allowed = first
    ? await canEditBudget({ kind: "item", id: first.id }, session)
    : session.role === "ADMIN";
  if (!allowed) {
    throw new Error("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機計畫");
  }
  return session;
}

export async function getProtoPlanView(boardId: string): Promise<ProtoPlanView | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [phases, cells, first] = await Promise.all([
    prisma.budgetPhase.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.protoPlan.findMany({
      where: { boardId },
      orderBy: { createdAt: "asc" },
      select: { product: true, unit: true, phaseId: true, qty: true, note: true },
    }),
    prisma.item.findFirst({
      where: { boardId, parentId: null, deletedAt: null },
      orderBy: { order: "asc" },
      select: { id: true },
    }),
  ]);

  return {
    phases,
    summary: summariseProtoPlan(
      phases.map((p) => p.id),
      cells
    ),
    units: await loadOrgUnits(),
    canEdit: first
      ? await canEditBudget({ kind: "item", id: first.id }, session)
      : session.role === "ADMIN",
  };
}

/** 一格:某個產品、某個用途單位、某個階段要幾台。 */
export async function setProtoQty(
  boardId: string,
  product: string,
  unit: string,
  phaseId: string,
  qty: number,
  note: string
): Promise<{ error?: string }> {
  const session = await requireProtoAdmin(boardId);
  if (!Number.isInteger(qty) || qty < 0) return { error: "台數必須是 0 或正整數" };
  if (qty > 9999) return { error: "台數看起來填錯了" };

  // 0 是存起來,不是刪掉。刪掉的話,把一列最後一格清成 0 會讓整列從表上
  // 消失 —— 那不是「這個階段不用樣機」的意思。整列要拿掉有 deleteProtoRow。
  await prisma.protoPlan.upsert({
    where: { boardId_product_unit_phaseId: { boardId, product, unit, phaseId } },
    create: { boardId, product, unit, phaseId, qty, note: note.trim(), createdById: session.userId },
    update: { qty, note: note.trim() },
  });

  // 台數變了,這個階段的材料預算(單台 BOM 價 × 台數)就得跟著動——如果
  // 這個階段根本沒有 BOM,resyncBomMaterial 什麼都不做。
  await resyncBomMaterial(boardId, phaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 新增一列(某個產品的某個用途單位)。
 *
 * 只建一列空的,不預填任何階段的台數 —— 猜一個數字進去,之後沒人記得那
 * 是猜的還是談出來的。
 */
export async function addProtoRow(
  boardId: string,
  product: string,
  unit: string
): Promise<{ error?: string }> {
  await requireProtoAdmin(boardId);
  const trimmedProduct = product.trim();
  const trimmedUnit = unit.trim();
  if (!trimmedProduct) return { error: "產品名稱不可為空" };
  if (!trimmedUnit) return { error: "用途單位不可為空" };

  const phase = await prisma.budgetPhase.findFirst({
    where: { boardId },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  if (!phase) return { error: "請先在人力表建立階段,樣機計畫的欄位是照階段排的" };

  const existing = await prisma.protoPlan.findFirst({
    where: { boardId, product: trimmedProduct, unit: trimmedUnit },
  });
  if (existing) return { error: `「${trimmedProduct}」已經有「${trimmedUnit}」這一列了` };

  // 用 0 台佔一列,讓它在表上出現,等著被填。
  await prisma.protoPlan.create({
    data: { boardId, product: trimmedProduct, unit: trimmedUnit, phaseId: phase.id, qty: 0 },
  });
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteProtoRow(
  boardId: string,
  product: string,
  unit: string
): Promise<{ error?: string }> {
  const session = await requireProtoAdmin(boardId);
  const affected = await prisma.protoPlan.findMany({
    where: { boardId, product, unit },
    select: { phaseId: true },
  });
  const removed = await prisma.protoPlan.deleteMany({ where: { boardId, product, unit } });
  await logAudit(
    "COST",
    session.userId,
    `刪除樣機計畫「${product} / ${unit}」(${removed.count} 個階段的台數)`,
    boardId
  );
  for (const phaseId of new Set(affected.map((a) => a.phaseId))) {
    await resyncBomMaterial(boardId, phaseId);
  }
  revalidatePath(`/boards/${boardId}`);
  return {};
}
