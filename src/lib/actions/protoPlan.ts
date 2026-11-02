"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { OrgUnit } from "@/lib/orgUnits";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBoardBudget } from "@/lib/boardBudgetRights";
import { resyncBomMaterial } from "@/lib/bomMaterial";
import { summariseProtoPlan, type ProtoSummary } from "@/lib/protoPlan";
import { mergeOrder } from "@/lib/mergeOrder";
import { orderProtoCells } from "@/lib/protoRowOrder";
import { syncProtoUnits } from "@/lib/protoUnitsServer";
import { protoSyncNotice, protoUnitLabel } from "@/lib/protoUnits";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { UserError } from "@/lib/userError";

/** 樣機計畫排出來的一台樣機,以及用到它的工作項(只列這個人看得到的)。 */
export type ProtoMachineView = {
  id: string;
  product: string;
  unit: string;
  phaseId: string;
  seq: number;
  /** 「M3 / EVT1 / SW #2」 */
  label: string;
  items: { id: string; name: string }[];
};

export type ProtoPlanView = {
  /** 階段照人力表的順序 —— 兩張表共用同一組階段。 */
  phases: { id: string; name: string }[];
  summary: ProtoSummary;
  /** 用途下拉的其中一組:公司組織單位。 */
  units: OrgUnit[];
  /** 樣機計畫排出來的每一台樣機(產品、階段、用途、第幾台)。 */
  machines: ProtoMachineView[];
  canEdit: boolean;
};

async function requireProtoAdmin(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (!(await canEditBoardBudget(boardId, session))) {
    throw new UserError("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機計畫");
  }
  return session;
}

export async function getProtoPlanView(boardId: string): Promise<ProtoPlanView | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const [phases, cells, rowOrders, units, visible] = await Promise.all([
    prisma.budgetPhase.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.protoPlan.findMany({
      where: { boardId },
      // 同一批建立的列(Excel 匯入)建立時間一樣,再用 id 排:不然順序看資料庫內部位置,改名一下產品區塊就被洗牌。
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { product: true, unit: true, phaseId: true, qty: true, note: true },
    }),
    prisma.protoRowOrder.findMany({ where: { boardId }, select: { product: true, unit: true, order: true } }),
    prisma.protoUnit.findMany({
      where: { boardId },
      select: {
        id: true,
        product: true,
        unit: true,
        phaseId: true,
        seq: true,
        items: { select: { item: { select: { id: true, name: true, deletedAt: true } } } },
      },
    }),
    visibleItemIdsForBoard(boardId, session),
  ]);

  // 樣機清單:產品 → 階段(照人力表的順序)→ 用途 → 第幾台。用到它的工作項只列這個人看得到的。
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const machines: ProtoMachineView[] = units
    .map((u) => ({
      id: u.id,
      product: u.product,
      unit: u.unit,
      phaseId: u.phaseId,
      seq: u.seq,
      label: protoUnitLabel(u, phaseName.get(u.phaseId) ?? ""),
      items: u.items.map((r) => r.item).filter((i) => !i.deletedAt && visible.has(i.id)).map((i) => ({ id: i.id, name: i.name })),
    }))
    .sort(
      (a, b) =>
        a.product.localeCompare(b.product) ||
        (phaseIndex.get(a.phaseId) ?? 0) - (phaseIndex.get(b.phaseId) ?? 0) ||
        a.unit.localeCompare(b.unit) ||
        a.seq - b.seq
    );

  return {
    phases,
    summary: summariseProtoPlan(
      phases.map((p) => p.id),
      // 用途列的順序:拖曳排過的照排好的順序,沒排過的接在後面。
      orderProtoCells(cells, rowOrders)
    ),
    machines,
    units: await loadOrgUnits(),
    canEdit: await canEditBoardBudget(boardId, session),
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
): Promise<{ error?: string; /** 台數減少、拿掉了樣機時,事後告訴使用者(不擋修改)。 */ notice?: string }> {
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
  // 每一台樣機跟著台數增減(減少時被拿掉的、有工作項在用的,參照一併解除並通知)。
  const sync = await syncProtoUnits(boardId, session.userId);
  revalidatePath(`/boards/${boardId}`);
  const notice = protoSyncNotice(sync);
  return notice ? { notice } : {};
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

/**
 * 改一列的用途單位名稱(例如 EE → HW-EE)。各階段的台數、排出來的每一台樣機(連同工作項的「使用樣機」)、
 * 列的順序一起改名;同一個產品已經有同名的那一列就擋下來,不自動併。
 */
export async function renameProtoUnit(
  boardId: string,
  product: string,
  unit: string,
  rawName: string
): Promise<{ error?: string }> {
  const session = await requireProtoAdmin(boardId);
  const name = rawName.trim();
  if (!name) return { error: "用途單位不可為空" };
  if (name.length > 100) return { error: "用途單位名稱太長了(上限 100 字)" };
  if (name === unit) return {};

  const [current, clash] = await Promise.all([
    prisma.protoPlan.findFirst({ where: { boardId, product, unit }, select: { id: true } }),
    prisma.protoPlan.findFirst({ where: { boardId, product, unit: name }, select: { id: true } }),
  ]);
  if (!current) return { error: "找不到這一列" };
  if (clash) return { error: `「${product}」已經有「${name}」這一列了` };

  await prisma.$transaction([
    prisma.protoPlan.updateMany({ where: { boardId, product, unit }, data: { unit: name } }),
    // 排出來的每一台樣機跟著改名,工作項的「使用樣機」參照的是它的 id,不受影響。
    prisma.protoUnit.updateMany({ where: { boardId, product, unit }, data: { unit: name } }),
    prisma.protoRowOrder.updateMany({ where: { boardId, product, unit }, data: { unit: name } }),
  ]);
  await logAudit("COST", session.userId, `樣機計畫「${product}」的用途單位「${unit}」改名為「${name}」`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 拖曳排序某個產品底下的用途列:orderedUnits 是畫面上拖完的順序。 */
export async function reorderProtoRows(boardId: string, product: string, orderedUnits: string[]): Promise<{ error?: string }> {
  await requireProtoAdmin(boardId);
  const rows = await prisma.protoPlan.findMany({
    where: { boardId, product },
    orderBy: { createdAt: "asc" },
    select: { unit: true },
    distinct: ["unit"],
  });
  if (rows.length === 0) return { error: "找不到這個產品" };
  const finalUnits = mergeOrder(
    rows.map((r) => r.unit),
    orderedUnits
  );
  await prisma.$transaction([
    prisma.protoRowOrder.deleteMany({ where: { boardId, product } }),
    prisma.protoRowOrder.createMany({ data: finalUnits.map((unit, order) => ({ boardId, product, unit, order })) }),
  ]);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 拖曳排序階段欄:orderedIds 是畫面上拖完的順序。階段是各預算表共用的一組(樣機計畫、階段預算、NRE、BOM),
 * 所以這裡排,別張表的階段順序也跟著變。
 */
export async function reorderProtoPhases(boardId: string, orderedIds: string[]): Promise<{ error?: string }> {
  const session = await requireProtoAdmin(boardId);
  const phases = await prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" }, select: { id: true } });
  const finalIds = mergeOrder(
    phases.map((p) => p.id),
    orderedIds
  );
  await prisma.$transaction(finalIds.map((id, order) => prisma.budgetPhase.update({ where: { id }, data: { order } })));
  await logAudit("COST", session.userId, "調整階段順序(樣機計畫的階段欄)", boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteProtoRow(
  boardId: string,
  product: string,
  unit: string
): Promise<{ error?: string; notice?: string }> {
  const session = await requireProtoAdmin(boardId);
  const affected = await prisma.protoPlan.findMany({
    where: { boardId, product, unit },
    select: { phaseId: true },
  });
  const removed = await prisma.protoPlan.deleteMany({ where: { boardId, product, unit } });
  await prisma.protoRowOrder.deleteMany({ where: { boardId, product, unit } });
  await logAudit(
    "COST",
    session.userId,
    `刪除樣機計畫「${product} / ${unit}」(${removed.count} 個階段的台數)`,
    boardId
  );
  for (const phaseId of new Set(affected.map((a) => a.phaseId))) {
    await resyncBomMaterial(boardId, phaseId);
  }
  const sync = await syncProtoUnits(boardId, session.userId);
  revalidatePath(`/boards/${boardId}`);
  const notice = protoSyncNotice(sync);
  return notice ? { notice } : {};
}
