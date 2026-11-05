"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { hideBudgetOn } from "@/lib/budgetAccessServer";
import { logAudit } from "@/lib/activityLog";
import { summariseBom, type BomLineInput, type BomNode } from "@/lib/bom";
import { asExtra, loadBomColumns } from "@/lib/bomColumnsServer";
import { diffBoms, type BomDiff } from "@/lib/bomDiff";
import { buildBomDiffWorkbook } from "@/lib/export/bomDiffWorkbook";

/**
 * 兩份樣機 BOM 的差異(例如 EVT 到 DVT)。唯讀:看得到 BOM 的人就能比,
 * 看不到預算金額的人跟 BOM 本身一樣不行(比出來的是單價與小計)。
 */

export type BomRef = { product: string; phaseId: string };

export type BomDiffResult = { diff: BomDiff; baseLabel: string; targetLabel: string } | { error: string };

type Loaded = {
  boardName: string;
  baseLabel: string;
  targetLabel: string;
  diff: BomDiff;
};

async function loadNodes(boardId: string, ref: BomRef): Promise<BomNode[]> {
  const rows = await prisma.bomLine.findMany({
    where: { boardId, product: ref.product, phaseId: ref.phaseId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      parentId: true,
      name: true,
      vendor: true,
      partNumber: true,
      qty: true,
      unitPrice: true,
      currency: true,
      fxRate: true,
      note: true,
      deliveryDate: true,
      extra: true,
      order: true,
    },
  });
  const input: BomLineInput[] = rows.map((r) => ({
    id: r.id,
    parentId: r.parentId,
    name: r.name,
    vendor: r.vendor,
    partNumber: r.partNumber,
    qty: Number(r.qty),
    unitPrice: Number(r.unitPrice),
    currency: r.currency,
    fxRate: Number(r.fxRate),
    note: r.note,
    deliveryDate: r.deliveryDate,
    extra: asExtra(r.extra),
    order: r.order,
  }));
  return summariseBom(input).nodes;
}

async function compute(boardId: string, base: BomRef, target: BomRef): Promise<Loaded | { error: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (await hideBudgetOn(boardId, session)) return { error: "你的角色看不到預算金額" };

  if (!base?.product || !base?.phaseId || !target?.product || !target?.phaseId) return { error: "請選好要比的兩份 BOM" };
  if (base.product === target.product && base.phaseId === target.phaseId) return { error: "兩邊是同一份 BOM,沒有什麼好比的" };

  const [board, phases] = await Promise.all([
    prisma.board.findUnique({ where: { id: boardId }, select: { name: true } }),
    prisma.budgetPhase.findMany({ where: { boardId }, select: { id: true, name: true } }),
  ]);
  if (!board) return { error: "找不到這個看板" };
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const baseLabel = `${base.product} / ${phaseName.get(base.phaseId) ?? ""}`;
  const targetLabel = `${target.product} / ${phaseName.get(target.phaseId) ?? ""}`;
  if (!phaseName.has(base.phaseId) || !phaseName.has(target.phaseId)) return { error: "找不到這個階段" };

  const [baseNodes, targetNodes, columns] = await Promise.all([
    loadNodes(boardId, base),
    loadNodes(boardId, target),
    loadBomColumns(boardId),
  ]);
  if (baseNodes.length === 0) return { error: `「${baseLabel}」還沒有 BOM,沒有東西可以比` };
  if (targetNodes.length === 0) return { error: `「${targetLabel}」還沒有 BOM,沒有東西可以比` };

  // 人員欄位的值是使用者 id,報表上要寫姓名。
  const userNames = columns.some((c) => c.type === "PERSON")
    ? new Map((await prisma.user.findMany({ select: { id: true, name: true } })).map((u) => [u.id, u.name]))
    : new Map<string, string>();

  return {
    boardName: board.name,
    baseLabel,
    targetLabel,
    diff: diffBoms(baseNodes, targetNodes, columns, (id) => userNames.get(id) ?? id),
  };
}

/** 基準(舊)與對象(新)兩份 BOM 的差異。 */
export async function compareBoms(boardId: string, base: BomRef, target: BomRef): Promise<BomDiffResult> {
  const out = await compute(boardId, base, target);
  if ("error" in out) return out;
  return { diff: out.diff, baseLabel: out.baseLabel, targetLabel: out.targetLabel };
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

export async function exportBomDiff(
  boardId: string,
  base: BomRef,
  target: BomRef
): Promise<{ filename: string; base64: string } | { error: string }> {
  const out = await compute(boardId, base, target);
  if ("error" in out) return out;
  const buffer = await buildBomDiffWorkbook({
    boardName: out.boardName,
    baseLabel: out.baseLabel,
    targetLabel: out.targetLabel,
    diff: out.diff,
  });
  const session = await requireSession();
  await logAudit("COST", session.userId, `匯出 BOM 差異「${out.baseLabel}」→「${out.targetLabel}」`, boardId);
  return {
    filename: `${safeFilename(out.boardName)}-BOM差異-${safeFilename(out.baseLabel.replace(" / ", "_"))}-${safeFilename(out.targetLabel.replace(" / ", "_"))}.xlsx`,
    base64: buffer.toString("base64"),
  };
}
