"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBoardBudget } from "@/lib/boardBudgetRights";
import { resyncBomMaterial } from "@/lib/bomMaterial";
import { UserError } from "@/lib/userError";
import { asExtra, compactExtra, loadBomColumns } from "@/lib/bomColumnsServer";
import { removeBomFiles } from "@/lib/bomFilesServer";
import { isCustomColumn, normalizeCellValue } from "@/lib/bomColumns";
import { validateProductName } from "@/lib/bom";
import { leadTimeOf } from "@/lib/bomPaste";
import type { BomMove } from "@/lib/bomLevel";
import { planBomMove, selectionRoots, shiftBomLevels, type MovePosition } from "@/lib/bomBulk";
import { loadFlatBom, priceNotices, type FlatBomRow } from "@/lib/bomFlatServer";

/**
 * 樣機 BOM 勾選之後的批次操作:刪除、編輯某個欄位、升階 / 降階、移動與複製(同一份或別份 BOM)。
 * 規則跟看板表格的批次操作一致:勾選一列,它底下的子項目一起被處理;父項與子項都被勾,只算父項;
 * 「取代名稱」與「編輯欄位」只改打勾的列本身。權限跟編輯 BOM 一樣(管理者、專案建立者、分組的 Team Leader)。
 */

const MAX_IDS = 500;
const MAX_LEN = { vendor: 100, note: 500, name: 200 };

async function guard(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (!(await canEditBoardBudget(boardId, session))) {
    throw new UserError("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機 BOM");
  }
  return session;
}

/** 勾選的列:要都屬於這份 BOM。 */
async function loadSelected(boardId: string, product: string, phaseId: string, ids: string[]) {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "沒有選到任何列" } as const;
  if (ids.length > MAX_IDS) return { error: `一次最多處理 ${MAX_IDS} 列` } as const;
  const loaded = await loadFlatBom(boardId, product, phaseId);
  const known = new Set(loaded.rows.map((r) => r.id));
  const selected = [...new Set(ids)];
  if (selected.some((id) => !known.has(id))) return { error: "有的列找不到(可能已經被刪除),請重新整理後再試" } as const;
  return { ...loaded, selected };
}

const parentMapAfter = (rows: FlatBomRow[], moves: BomMove[], removed: Set<string> = new Set()) => {
  const map = new Map<string, string | null>(rows.filter((r) => !removed.has(r.id)).map((r) => [r.id, r.parentId]));
  for (const m of moves) map.set(m.id, m.parentId);
  return map;
};

const updateOps = (moves: BomMove[]) =>
  moves.map((m) => prisma.bomLine.update({ where: { id: m.id }, data: { parentId: m.parentId, order: m.order } }));

async function finish(boardId: string, phaseIds: string[]) {
  for (const id of new Set(phaseIds)) await resyncBomMaterial(boardId, id);
  revalidatePath(`/boards/${boardId}`);
}

// ---- 刪除 ----

/** 刪掉勾選的列(連同底下的子項目與它們的檔案附件,含磁碟上的檔案),無法復原。 */
export async function bulkDeleteBomLines(
  boardId: string,
  product: string,
  phaseId: string,
  ids: string[]
): Promise<{ error?: string; roots?: number; deleted?: number }> {
  const session = await guard(boardId);
  const loaded = await loadSelected(boardId, product, phaseId, ids);
  if ("error" in loaded) return { error: loaded.error };
  const { rootIds, subtreeIds } = selectionRoots(loaded.flat, new Set(loaded.selected));

  const files = await prisma.bomAttachment.findMany({ where: { bomLineId: { in: [...subtreeIds] } }, select: { url: true } });
  // 子項目靠外鍵連帶刪除。
  await prisma.bomLine.deleteMany({ where: { id: { in: rootIds }, boardId, product, phaseId } });
  await removeBomFiles(files.map((f) => f.url));

  await logAudit("COST", session.userId, `批次刪除 BOM「${product}」${rootIds.length} 列(連同子項目共 ${subtreeIds.size} 列)`, boardId);
  await finish(boardId, [phaseId]);
  return { roots: rootIds.length, deleted: subtreeIds.size };
}

// ---- 編輯某個欄位 ----

export type BulkEditField =
  | { kind: "vendor" | "note"; value: string }
  | { kind: "deliveryDate"; value: string | null }
  | { kind: "qty" | "unitPrice"; value: number }
  | { kind: "currency"; currency: string; fxRate: number | null }
  | { kind: "rename"; find: string; replace: string }
  | { kind: "custom"; columnId: string; value: unknown };

/**
 * 把勾選的列(只改打勾的列本身,不連子項目)的某一個欄位一次改成同一個值。
 * 單價與幣別只套用在零件上(有子項目的列,單價是底下加總算出來的),被略過的列會說明。
 */
export async function bulkEditBomLines(
  boardId: string,
  product: string,
  phaseId: string,
  ids: string[],
  field: BulkEditField
): Promise<{ error?: string; changed?: number; skipped?: string[] }> {
  const session = await guard(boardId);
  const loaded = await loadSelected(boardId, product, phaseId, ids);
  if ("error" in loaded) return { error: loaded.error };
  const { rows, selected } = loaded;

  const hasChildren = new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])));
  const leaves = selected.filter((id) => !hasChildren.has(id));
  const skipped: string[] = [];
  const skipAssemblies = (what: string) => {
    if (leaves.length < selected.length) skipped.push(`${selected.length - leaves.length} 列有子項目,它的${what}是底下加總算出來的,略過。`);
  };
  const where = { id: { in: selected }, boardId, product, phaseId };
  let changed = 0;
  let label = "";

  switch (field.kind) {
    case "vendor":
    case "note": {
      const value = String(field.value ?? "").trim();
      if (value.length > MAX_LEN[field.kind]) return { error: `太長了(上限 ${MAX_LEN[field.kind]} 字)` };
      await prisma.bomLine.updateMany({ where, data: { [field.kind]: value } });
      changed = selected.length;
      label = field.kind === "vendor" ? "廠商" : "備註";
      break;
    }
    case "deliveryDate": {
      const value = field.value?.trim() || null;
      const weeks = value ? leadTimeOf(value) : null;
      if (weeks === undefined) return { error: "交期要填週數(例如 8)" };
      await prisma.bomLine.updateMany({ where, data: { deliveryDate: weeks } });
      changed = selected.length;
      label = "交期";
      break;
    }
    case "qty": {
      if (!Number.isFinite(field.value) || field.value <= 0) return { error: "數量必須大於 0" };
      await prisma.bomLine.updateMany({ where, data: { qty: field.value } });
      changed = selected.length;
      label = "數量";
      break;
    }
    case "unitPrice": {
      if (!Number.isFinite(field.value) || field.value < 0) return { error: "單價必須是 0 或正數" };
      skipAssemblies("單價");
      if (leaves.length === 0) return { error: skipped.join("\n") || "沒有可以改單價的列", skipped };
      await prisma.bomLine.updateMany({ where: { ...where, id: { in: leaves } }, data: { unitPrice: field.value } });
      changed = leaves.length;
      label = "單價";
      break;
    }
    case "currency": {
      const currency = String(field.currency ?? "").trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(currency)) return { error: "幣別請填三個英文字母,例如 USD" };
      let fx = 1;
      if (currency !== "TWD") {
        const rate = field.fxRate ?? (await prisma.exchangeRate.findUnique({ where: { code: currency }, select: { rate: true } }).then((r) => (r ? Number(r.rate) : null)));
        if (rate === null || !Number.isFinite(rate) || rate <= 0) return { error: `「${currency}」沒有填匯率,系統設定裡也沒有這個幣別的匯率,請填匯率` };
        fx = rate;
      }
      skipAssemblies("單價與幣別");
      if (leaves.length === 0) return { error: skipped.join("\n") || "沒有可以改幣別的列", skipped };
      await prisma.bomLine.updateMany({ where: { ...where, id: { in: leaves } }, data: { currency, fxRate: fx } });
      changed = leaves.length;
      label = "幣別";
      break;
    }
    case "rename": {
      const find = String(field.find ?? "");
      if (find === "") return { error: "請輸入要尋找的字樣" };
      const replace = String(field.replace ?? "");
      const current = await prisma.bomLine.findMany({ where, select: { id: true, name: true } });
      const updates: { id: string; name: string }[] = [];
      let unchanged = 0;
      let blank = 0;
      let tooLong = 0;
      for (const r of current) {
        if (!r.name.includes(find)) {
          unchanged++;
          continue;
        }
        const next = r.name.split(find).join(replace).trim();
        if (next === "") blank++;
        else if (next.length > MAX_LEN.name) tooLong++;
        else updates.push({ id: r.id, name: next });
      }
      if (unchanged > 0) skipped.push(`${unchanged} 列沒有這段字樣。`);
      if (blank > 0) skipped.push(`${blank} 列取代之後名稱會變空白,略過。`);
      if (tooLong > 0) skipped.push(`${tooLong} 列取代之後名稱太長(上限 ${MAX_LEN.name} 字),略過。`);
      if (updates.length === 0) return { error: skipped.join("\n") || "沒有名稱需要改", skipped };
      await prisma.$transaction(updates.map((u) => prisma.bomLine.update({ where: { id: u.id }, data: { name: u.name } })));
      changed = updates.length;
      label = "名稱(取代)";
      break;
    }
    case "custom": {
      const column = (await loadBomColumns(boardId)).filter(isCustomColumn).find((c) => c.id === field.columnId);
      if (!column) return { error: "找不到這個欄位(可能已經被刪除),請重新整理後再試" };
      if (column.type === "FILE") return { error: "檔案附件欄位不能批次設定,請到那一列上傳" };
      const checked = normalizeCellValue(column, field.value);
      if ("error" in checked) return { error: checked.error };
      const current = await prisma.bomLine.findMany({ where, select: { id: true, extra: true } });
      await prisma.$transaction(
        current.map((r) =>
          prisma.bomLine.update({
            where: { id: r.id },
            data: { extra: compactExtra({ ...asExtra(r.extra), [column.id]: checked.value }) as Prisma.InputJsonValue },
          })
        )
      );
      changed = current.length;
      label = column.name;
      break;
    }
    default:
      return { error: "不支援這個欄位" };
  }

  await logAudit("COST", session.userId, `批次修改 BOM「${product}」${changed} 列的「${label}」`, boardId);
  await finish(boardId, [phaseId]);
  return { changed, skipped };
}

// ---- 升階 / 降階 ----

/** 勾選的列(各帶底下的子項目)一起升一階(delta = -1)或降一階(delta = 1);全有或全無。 */
export async function bulkShiftBomLevels(
  boardId: string,
  product: string,
  phaseId: string,
  ids: string[],
  delta: number
): Promise<{ error?: string; notice?: string; moved?: number }> {
  const session = await guard(boardId);
  if (delta !== 1 && delta !== -1) return { error: "只能升一階或降一階" };
  const loaded = await loadSelected(boardId, product, phaseId, ids);
  if ("error" in loaded) return { error: loaded.error };
  const { rows, flat, selected } = loaded;

  const result = shiftBomLevels(flat, new Map(rows.map((r) => [r.id, r.name])), new Set(selected), delta);
  if ("error" in result) return { error: result.error };
  if (result.moves.length === 0) return { moved: 0 };

  await prisma.$transaction(updateOps(result.moves));
  const notes = priceNotices(rows, parentMapAfter(rows, result.moves));
  await logAudit("COST", session.userId, `批次${delta > 0 ? "降階" : "升階"} BOM「${product}」${selectionRoots(flat, new Set(selected)).rootIds.length} 列`, boardId);
  await finish(boardId, [phaseId]);
  return { moved: result.moves.length, notice: notes.length > 0 ? notes.join("\n") : undefined };
}

// ---- 移動與複製 ----

export type BulkPlaceTarget = { product: string; phaseId: string; parentId: string | null; position: MovePosition };

async function resolveTarget(boardId: string, target: BulkPlaceTarget) {
  const product = String(target?.product ?? "").trim();
  const invalid = validateProductName(product);
  if (invalid) return { error: invalid } as const;
  const phase = await prisma.budgetPhase.findFirst({ where: { id: target.phaseId, boardId }, select: { name: true } });
  if (!phase) return { error: "找不到目標的階段" } as const;
  return { product, phaseName: phase.name } as const;
}

/**
 * 把勾選的列(各帶底下的子項目)移到另一個上層底下的指定位置;目標可以是同一份 BOM,也可以是別的產品 / 階段的 BOM。
 * 搬到別份時,列(連同子項目、檔案附件)直接換到那一份,原本那一份的同層順序遞補。
 */
export async function bulkMoveBomLines(
  boardId: string,
  from: { product: string; phaseId: string },
  ids: string[],
  target: BulkPlaceTarget
): Promise<{ error?: string; moved?: number; notice?: string }> {
  const session = await guard(boardId);
  const dest = await resolveTarget(boardId, target);
  if ("error" in dest) return { error: dest.error };
  const loaded = await loadSelected(boardId, from.product, from.phaseId, ids);
  if ("error" in loaded) return { error: loaded.error };
  const { rows, flat, selected } = loaded;
  const { rootIds, subtreeIds } = selectionRoots(flat, new Set(selected));
  const same = dest.product === from.product && target.phaseId === from.phaseId;

  const notes: string[] = [];
  if (same) {
    const plan = planBomMove(flat, rootIds, { parentId: target.parentId, position: target.position });
    if ("error" in plan) return { error: plan.error };
    await prisma.$transaction(updateOps(plan.moves));
    notes.push(...priceNotices(rows, parentMapAfter(rows, plan.moves)));
  } else {
    const tgt = await loadFlatBom(boardId, dest.product, target.phaseId);
    const plan = planBomMove(tgt.flat, rootIds, { parentId: target.parentId, position: target.position });
    if ("error" in plan) return { error: plan.error };
    const remaining = flat.filter((l) => !subtreeIds.has(l.id));
    const renumber = planBomMove(remaining, [], { parentId: null, position: "last" });
    if ("error" in renumber) return { error: renumber.error };
    await prisma.$transaction([
      prisma.bomLine.updateMany({ where: { id: { in: [...subtreeIds] } }, data: { product: dest.product, phaseId: target.phaseId } }),
      ...updateOps(plan.moves),
      ...updateOps(renumber.moves),
    ]);
    notes.push(...priceNotices(rows, parentMapAfter(rows, renumber.moves, subtreeIds)));
    notes.push(...priceNotices(tgt.rows, parentMapAfter(tgt.rows, plan.moves)));
  }

  await logAudit(
    "COST",
    session.userId,
    same
      ? `批次移動 BOM「${from.product}」${rootIds.length} 列(連同子項目共 ${subtreeIds.size} 列)到同一份 BOM 的另一個位置`
      : `批次移動 BOM ${rootIds.length} 列(連同子項目共 ${subtreeIds.size} 列)從「${from.product}」到「${dest.product} / ${dest.phaseName}」`,
    boardId
  );
  await finish(boardId, [from.phaseId, target.phaseId]);
  return { moved: rootIds.length, notice: notes.length > 0 ? notes.slice(0, 5).join("\n") : undefined };
}

/** 把勾選的列(各帶底下的子項目)複製到目標的指定位置。檔案附件不複製(檔案留在原本那一列)。 */
export async function bulkCopyBomLines(
  boardId: string,
  from: { product: string; phaseId: string },
  ids: string[],
  target: BulkPlaceTarget
): Promise<{ error?: string; copied?: number; notice?: string }> {
  const session = await guard(boardId);
  const dest = await resolveTarget(boardId, target);
  if ("error" in dest) return { error: dest.error };
  const loaded = await loadSelected(boardId, from.product, from.phaseId, ids);
  if ("error" in loaded) return { error: loaded.error };
  const { flat, selected } = loaded;
  const { rootIds, subtreeIds } = selectionRoots(flat, new Set(selected));
  if (subtreeIds.size > MAX_IDS) return { error: `一次最多複製 ${MAX_IDS} 列(連同子項目),這次有 ${subtreeIds.size} 列` };

  const tgt = await loadFlatBom(boardId, dest.product, target.phaseId);
  const tempOf = (id: string) => `new:${id}`;
  const plan = planBomMove(tgt.flat, rootIds.map(tempOf), { parentId: target.parentId, position: target.position });
  if ("error" in plan) return { error: plan.error };
  const placement = new Map(plan.moves.filter((m) => m.id.startsWith("new:")).map((m) => [m.id, m]));
  const renumber = plan.moves.filter((m) => !m.id.startsWith("new:"));

  const source = await prisma.bomLine.findMany({ where: { id: { in: [...subtreeIds] } }, orderBy: { order: "asc" } });
  const childrenOf = new Map<string, typeof source>();
  for (const r of source) if (r.parentId && subtreeIds.has(r.parentId)) childrenOf.set(r.parentId, [...(childrenOf.get(r.parentId) ?? []), r]);
  const byId = new Map(source.map((r) => [r.id, r]));

  const newParents = new Map<string, string | null>();
  let created = 0;
  await prisma.$transaction(async (tx) => {
    for (const m of renumber) await tx.bomLine.update({ where: { id: m.id }, data: { parentId: m.parentId, order: m.order } });
    const copy = async (row: (typeof source)[number], parentId: string | null, order: number) => {
      const made = await tx.bomLine.create({
        data: {
          boardId,
          product: dest.product,
          phaseId: target.phaseId,
          parentId,
          name: row.name,
          vendor: row.vendor,
          partNumber: row.partNumber,
          qty: row.qty,
          unitPrice: row.unitPrice,
          currency: row.currency,
          fxRate: row.fxRate,
          note: row.note,
          deliveryDate: row.deliveryDate,
          extra: (row.extra ?? {}) as Prisma.InputJsonValue,
          order,
          createdById: session.userId,
        },
        select: { id: true },
      });
      created++;
      newParents.set(made.id, parentId);
      for (const child of childrenOf.get(row.id) ?? []) await copy(child, made.id, child.order);
    };
    for (const id of rootIds) {
      const place = placement.get(tempOf(id))!;
      await copy(byId.get(id)!, place.parentId, place.order);
    }
  });

  const parentAfter = parentMapAfter(tgt.rows, renumber);
  for (const [id, parent] of newParents) parentAfter.set(id, parent);
  const notes = priceNotices(tgt.rows, parentAfter);
  await logAudit(
    "COST",
    session.userId,
    `批次複製 BOM「${from.product}」${rootIds.length} 列(連同子項目共 ${created} 列)到「${dest.product} / ${dest.phaseName}」`,
    boardId
  );
  await finish(boardId, [target.phaseId]);
  return { copied: created, notice: notes.length > 0 ? notes.join("\n") : undefined };
}
