"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { hideBudgetOn } from "@/lib/budgetAccessServer";
import { logAudit } from "@/lib/activityLog";
import { canEditBoardBudget } from "@/lib/boardBudgetRights";
import { resyncBomMaterial } from "@/lib/bomMaterial";
import { syncProtoUnits } from "@/lib/protoUnitsServer";
import { MAX_PASTED_BOM_ROWS, type PastedBomRow } from "@/lib/bomPaste";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { asExtra, compactExtra, customDefaults, loadBomColumns } from "@/lib/bomColumnsServer";
import { removeBomFiles } from "@/lib/bomFilesServer";
import {
  importCellValue,
  isCustomColumn,
  normalizeCellValue,
  resolveBomColumns,
  validateBomColumns,
  type BomCellValue,
  type BomColumnDef,
  type BomColumnsSource,
} from "@/lib/bomColumns";
import {
  summariseBom,
  flattenBom,
  sourcesOfProducts,
  unionProducts,
  validateProductName,
  validateProductRename,
  type BomLineInput,
  type BomNode,
  type ProductSource,
} from "@/lib/bom";
import { setBomLevel } from "@/lib/bomLevel";
import { UserError } from "@/lib/userError";

/**
 * 樣機 BOM:某個產品、某個階段一份表,列廠商/型號/名稱/子集,算出一台裝置
 * 的價錢。跟樣機計畫共用同一組預算階段——EVT 兩台給 SW 做 mock up,料號要
 * 對的也是那個 EVT 的 BOM。
 *
 * 這張表算出來的單台價格會自動回寫該階段的材料預算(核准預算 → 材料那
 * 一列):單台價 × 樣機計畫裡那個產品在那個階段要幾台,每個產品各自算完
 * 再加總。跟人力規劃表寫回人力預算是同一個道理。
 */

async function requireBomAdmin(boardId: string) {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (!(await canEditBoardBudget(boardId, session))) {
    throw new UserError("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機 BOM");
  }
  return session;
}

export type BomContext = {
  phases: { id: string; name: string }[];
  /** 產品名稱:單獨新增的、樣機計畫用到的、BOM 用到的三者的聯集,給下拉選單當候選。 */
  products: string[];
  /** 每個產品名字出現在哪幾處(手動新增、樣機計畫、BOM),選單上標來源用。 */
  productSources: Record<string, ProductSource[]>;
  /** 哪些產品在哪個階段已經有 BOM(幾列),「新增 BOM」可以選一份當起點複製。 */
  sources: { product: string; phaseId: string; count: number }[];
  /** 這個看板 BOM 裡填過的廠商,廠商欄的建議清單。 */
  vendors: string[];
  /** 這個看板 BOM 實際用的欄位(看板自己的 → 系統預設 → 內建),有順序。 */
  columns: BomColumnDef[];
  /** 欄位是看板自己設的、還是沿用系統預設 / 內建。 */
  columnsSource: BomColumnsSource;
  /** 有「人員」欄位時,給下拉選單用的人。 */
  users: { id: string; name: string }[];
  /** 整塊看板層級的編輯權——跟選了哪個產品/階段無關,匯入 Excel(動到整
   *  塊看板的 BOM)這種操作用得到,不用等使用者選了某個產品才知道能不能匯入。 */
  canEdit: boolean;
};

export async function getBomContext(boardId: string): Promise<BomContext | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true, bomColumns: true } });
  if (!board) return null;
  const { columns, source } = resolveBomColumns(board.bomColumns, (await getSystemSettings()).bomDefaultColumns);
  const users = columns.some((c) => c.type === "PERSON")
    ? await prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  const [phases, protoProducts, bomProducts, ownProducts, bomGroups, vendorRows] = await Promise.all([
    prisma.budgetPhase.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.protoPlan.findMany({ where: { boardId }, select: { product: true }, distinct: ["product"] }),
    prisma.bomLine.findMany({ where: { boardId }, select: { product: true }, distinct: ["product"] }),
    prisma.budgetProduct.findMany({ where: { boardId }, select: { name: true } }),
    prisma.bomLine.groupBy({ by: ["product", "phaseId"], where: { boardId }, _count: { _all: true } }),
    prisma.bomLine.findMany({ where: { boardId, vendor: { not: "" } }, select: { vendor: true }, distinct: ["vendor"], orderBy: { vendor: "asc" }, take: 300 }),
  ]);

  const products = unionProducts(
    ownProducts.map((p) => p.name),
    protoProducts.map((p) => p.product),
    bomProducts.map((p) => p.product)
  );
  const canEdit = await canEditBoardBudget(boardId, session);
  return {
    phases,
    products,
    productSources: sourcesOfProducts(
      ownProducts.map((p) => p.name),
      protoProducts.map((p) => p.product),
      bomProducts.map((p) => p.product)
    ),
    sources: bomGroups.map((g) => ({ product: g.product, phaseId: g.phaseId, count: g._count._all })),
    vendors: vendorRows.map((v) => v.vendor),
    columns,
    columnsSource: source,
    users,
    canEdit,
  };
}

/** 做產品的新增與刪除這類動作時,把「沒有權限」轉成回傳的錯誤訊息(丟出的例外在正式環境會被遮掉)。 */
async function productAdmin(boardId: string) {
  try {
    return { session: await requireBomAdmin(boardId) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "權限不足" };
  }
}

/**
 * 新增一個產品。產品可以單獨存在——先建好產品,再慢慢填它的 BOM 與樣機計畫;不必先有一列才算有這個產品。
 * 名稱已經在用(不論是單獨建立的、樣機計畫或 BOM 用到的)就回錯誤,不重複建。
 */
export async function addProduct(boardId: string, name: string): Promise<{ error?: string }> {
  const guard = await productAdmin(boardId);
  if ("error" in guard) return { error: guard.error };
  const product = name.trim();
  const invalid = validateProductName(product);
  if (invalid) return { error: invalid };

  const [own, proto, bom] = await Promise.all([
    prisma.budgetProduct.findUnique({ where: { boardId_name: { boardId, name: product } }, select: { id: true } }),
    prisma.protoPlan.findFirst({ where: { boardId, product }, select: { id: true } }),
    prisma.bomLine.findFirst({ where: { boardId, product }, select: { id: true } }),
  ]);
  if (own || proto || bom) return { error: `已經有「${product}」這個產品了` };

  await prisma.budgetProduct.create({ data: { boardId, name: product, createdById: guard.session.userId } });
  await logAudit("COST", guard.session.userId, `新增產品「${product}」`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 修改產品名稱:這個看板上用到這個名字的地方一起換——單獨建立的產品、各階段的 BOM、樣機計畫的各列。
 * 新名稱不能跟現有的任何產品重名(不做合併:兩個產品併成一個會把它們各階段的 BOM 混在一起,要的話請自己刪一個再重填)。
 * 只是換名字,BOM 與台數都不動,所以材料預算不必重算。
 */
export async function renameProduct(boardId: string, from: string, to: string): Promise<{ error?: string }> {
  const guard = await productAdmin(boardId);
  if ("error" in guard) return { error: guard.error };
  const next = to.trim();

  const [own, proto, bom] = await Promise.all([
    prisma.budgetProduct.findMany({ where: { boardId }, select: { name: true } }),
    prisma.protoPlan.findMany({ where: { boardId }, select: { product: true }, distinct: ["product"] }),
    prisma.bomLine.findMany({ where: { boardId }, select: { product: true }, distinct: ["product"] }),
  ]);
  const products = unionProducts(own.map((p) => p.name), proto.map((p) => p.product), bom.map((p) => p.product));
  const invalid = validateProductRename(products, from, next);
  if (invalid) return { error: invalid };

  await prisma.$transaction([
    prisma.budgetProduct.updateMany({ where: { boardId, name: from }, data: { name: next } }),
    prisma.protoPlan.updateMany({ where: { boardId, product: from }, data: { product: next } }),
    // 樣機計畫排出來的每一台樣機跟著改名,工作項的「使用樣機」參照不動。
    prisma.protoUnit.updateMany({ where: { boardId, product: from }, data: { product: next } }),
    prisma.protoRowOrder.updateMany({ where: { boardId, product: from }, data: { product: next } }),
    prisma.bomLine.updateMany({ where: { boardId, product: from }, data: { product: next } }),
  ]);
  await logAudit("COST", guard.session.userId, `產品「${from}」改名為「${next}」`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export type ProductUsage = {
  bomLines: number;
  protoRows: number;
  phases: number;
  /** 樣機計畫排出來的樣機台數,以及其中有幾個工作項在用(刪除時那些參照會一併解除)。 */
  protoUnits: number;
  usedByItems: number;
};

/** 刪除一個產品之前先看它底下有多少東西——給確認視窗說「會一併刪掉什麼」。 */
export async function getProductUsage(boardId: string, product: string): Promise<ProductUsage | { error: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const [bomLines, protoRows, bomPhases, protoPhases, protoUnits, usedBy] = await Promise.all([
    prisma.bomLine.count({ where: { boardId, product } }),
    prisma.protoPlan.findMany({ where: { boardId, product }, select: { unit: true }, distinct: ["unit"] }),
    prisma.bomLine.findMany({ where: { boardId, product }, select: { phaseId: true }, distinct: ["phaseId"] }),
    prisma.protoPlan.findMany({ where: { boardId, product }, select: { phaseId: true }, distinct: ["phaseId"] }),
    prisma.protoUnit.count({ where: { boardId, product } }),
    prisma.itemProtoUnit.findMany({
      where: { protoUnit: { boardId, product }, item: { deletedAt: null } },
      select: { itemId: true },
      distinct: ["itemId"],
    }),
  ]);
  return {
    bomLines,
    protoRows: protoRows.length,
    phases: new Set([...bomPhases, ...protoPhases].map((p) => p.phaseId)).size,
    protoUnits,
    usedByItems: usedBy.length,
  };
}

/**
 * 刪除一個產品:它在各階段的 BOM(含子項目)、樣機計畫的各列、以及產品本身一起刪掉,無法復原。
 * 受影響階段的材料預算(由 BOM 算出來的那一格)會重算。
 */
export async function deleteProduct(boardId: string, product: string): Promise<{ error?: string; bomLines?: number; protoRows?: number }> {
  const guard = await productAdmin(boardId);
  if ("error" in guard) return { error: guard.error };

  const [bomPhases, protoPhases] = await Promise.all([
    prisma.bomLine.findMany({ where: { boardId, product }, select: { phaseId: true }, distinct: ["phaseId"] }),
    prisma.protoPlan.findMany({ where: { boardId, product }, select: { phaseId: true }, distinct: ["phaseId"] }),
  ]);
  const files = await prisma.bomAttachment.findMany({ where: { boardId, bomLine: { product } }, select: { url: true } });
  const [bom, proto] = await prisma.$transaction([
    // 子項目靠外鍵連帶刪除,所以只刪最上層那幾列再算筆數不準——直接刪整個產品的所有列。
    prisma.bomLine.deleteMany({ where: { boardId, product } }),
    prisma.protoPlan.deleteMany({ where: { boardId, product } }),
    prisma.budgetProduct.deleteMany({ where: { boardId, name: product } }),
    prisma.protoRowOrder.deleteMany({ where: { boardId, product } }),
  ]);
  await removeBomFiles(files.map((f) => f.url));
  await logAudit(
    "COST",
    guard.session.userId,
    `刪除產品「${product}」(${bom.count} 筆 BOM、${proto.count} 個樣機計畫台數)`,
    boardId
  );
  for (const phaseId of new Set([...bomPhases, ...protoPhases].map((p) => p.phaseId))) {
    await resyncBomMaterial(boardId, phaseId);
  }
  // 它的樣機計畫沒了,排出來的每一台樣機也拿掉;工作項的「使用樣機」參照一併解除(刪除前的確認已經說明過)。
  await syncProtoUnits(boardId, guard.session.userId);
  revalidatePath(`/boards/${boardId}`);
  return { bomLines: bom.count, protoRows: proto.count };
}

export type BomLineRow = BomNode;

export type BomView = {
  boardName: string;
  phases: { id: string; name: string }[];
  products: string[];
  product: string;
  phaseId: string;
  /** 攤平成一列一列,depth 決定縮排——表格要的是這個順序。 */
  lines: BomLineRow[];
  unitCostTwd: number;
  /** 樣機計畫裡這個產品在這個階段排了幾台(各用途單位加起來)——單台價 × 它就是這個產品算進材料預算的錢。 */
  planQty: number;
  lineCount: number;
  foreignCurrencies: string[];
  orphanIds: string[];
  canEdit: boolean;
};

export async function getBomView(
  boardId: string,
  product: string,
  phaseId: string
): Promise<BomView | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  // DM 的可見範圍(系統設定):被限制「預算金額」的人看不到 BOM 的單價與小計。
  if (await hideBudgetOn(boardId, session)) return null;

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { name: true } });
  if (!board) return null;

  const ctx = await getBomContext(boardId);
  if (!ctx) return null;

  const rows = await prisma.bomLine.findMany({
    where: { boardId, product, phaseId },
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

  const fileRows = await prisma.bomAttachment.findMany({
    where: { boardId, bomLine: { product, phaseId } },
    orderBy: { createdAt: "asc" },
    select: { id: true, bomLineId: true, columnId: true, fileName: true, size: true },
  });
  const filesOf = new Map<string, NonNullable<BomLineInput["files"]>>();
  for (const f of fileRows) {
    const byColumn = filesOf.get(f.bomLineId) ?? {};
    (byColumn[f.columnId] ??= []).push({ id: f.id, fileName: f.fileName, size: f.size });
    filesOf.set(f.bomLineId, byColumn);
  }

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
    files: filesOf.get(r.id),
    order: r.order,
  }));
  const summary = summariseBom(input);
  const plan = await prisma.protoPlan.aggregate({ where: { boardId, product, phaseId }, _sum: { qty: true } });

  return {
    boardName: board.name,
    phases: ctx.phases,
    products: ctx.products,
    product,
    phaseId,
    lines: flattenBom(summary.nodes),
    unitCostTwd: summary.unitCostTwd,
    planQty: plan._sum.qty ?? 0,
    lineCount: summary.lineCount,
    foreignCurrencies: summary.foreignCurrencies,
    orphanIds: summary.orphanIds,
    canEdit: await canEditBoardBudget(boardId, session),
  };
}

export type BomLineDraft = {
  /** 有值 = 編輯既有的;沒有 = 新增。 */
  id?: string;
  parentId: string | null;
  name: string;
  vendor: string;
  partNumber: string;
  qty: number;
  unitPrice: number;
  currency: string;
  fxRate: number;
  note: string;
  deliveryDate: string | null;
  /** 自訂欄位的值(欄位代號 → 值)。只送畫面上顯示的欄位;沒送的欄位維持原本的值。 */
  extra?: Record<string, unknown>;
};

function isValidDeliveryDate(raw: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(new Date(raw).getTime());
}

/** 從某個節點往上一路走到根,回傳沿途的 id(含自己)。找不到就在半路停下。 */
async function ancestorChain(id: string): Promise<string[]> {
  const chain = [id];
  let cursor: string | null = id;
  for (let i = 0; i < 100 && cursor; i++) {
    const row: { parentId: string | null } | null = await prisma.bomLine.findUnique({
      where: { id: cursor },
      select: { parentId: true },
    });
    if (!row?.parentId) break;
    chain.push(row.parentId);
    cursor = row.parentId;
  }
  return chain;
}

export async function upsertBomLine(
  boardId: string,
  product: string,
  phaseId: string,
  draft: BomLineDraft
): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);

  const name = draft.name.trim();
  if (!name) return { error: "名稱不可為空" };
  if (!Number.isFinite(draft.qty) || draft.qty <= 0) return { error: "數量必須大於 0" };
  if (!Number.isFinite(draft.unitPrice) || draft.unitPrice < 0) return { error: "單價必須是 0 或正數" };
  const currency = draft.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { error: "幣別請填三個英文字母,例如 USD" };
  if (!Number.isFinite(draft.fxRate) || draft.fxRate <= 0) return { error: "匯率必須大於 0" };
  const deliveryDate = draft.deliveryDate?.trim() || null;
  if (deliveryDate && !isValidDeliveryDate(deliveryDate)) return { error: "交期日期格式錯誤" };

  // 自訂欄位:只認這個看板現在有的欄位,值依類型檢查;沒送的欄位維持原本的值。
  const customColumns = (await loadBomColumns(boardId)).filter(isCustomColumn);
  const submitted: Record<string, BomCellValue> = {};
  for (const column of customColumns) {
    if (!draft.extra || !(column.id in draft.extra)) continue;
    const checked = normalizeCellValue(column, draft.extra[column.id]);
    if ("error" in checked) return { error: checked.error };
    submitted[column.id] = checked.value;
  }

  if (draft.parentId) {
    if (draft.id && draft.parentId === draft.id) return { error: "上層不能是自己" };
    const parent = await prisma.bomLine.findUnique({
      where: { id: draft.parentId },
      select: { boardId: true, product: true, phaseId: true },
    });
    if (!parent || parent.boardId !== boardId || parent.product !== product || parent.phaseId !== phaseId) {
      return { error: "找不到指定的上層,或者它不屬於這張表" };
    }
    if (draft.id) {
      // 上層不能是自己的子孫,不然這棵樹會繞成一圈,單台價格永遠算不完。
      const chain = await ancestorChain(draft.parentId);
      if (chain.includes(draft.id)) return { error: "上層不能是自己底下的子項目" };
    }
  }

  if (draft.id) {
    const existing = await prisma.bomLine.findUnique({
      where: { id: draft.id },
      select: { boardId: true, product: true, phaseId: true, extra: true },
    });
    if (!existing || existing.boardId !== boardId || existing.product !== product || existing.phaseId !== phaseId) {
      return { error: "找不到這一列" };
    }
    // 已經刪掉的欄位的值順便清掉。
    const known = new Set(customColumns.map((c) => c.id));
    const kept = Object.fromEntries(Object.entries(asExtra(existing.extra)).filter(([id]) => known.has(id)));
    await prisma.bomLine.update({
      where: { id: draft.id },
      data: {
        parentId: draft.parentId,
        name,
        vendor: draft.vendor.trim(),
        partNumber: draft.partNumber.trim(),
        qty: draft.qty,
        unitPrice: draft.unitPrice,
        currency,
        fxRate: currency === "TWD" ? 1 : draft.fxRate,
        note: draft.note.trim(),
        deliveryDate,
        extra: compactExtra({ ...kept, ...submitted }) as Prisma.InputJsonValue,
      },
    });
  } else {
    const maxOrder = await prisma.bomLine.aggregate({
      where: { boardId, product, phaseId, parentId: draft.parentId },
      _max: { order: true },
    });
    await prisma.bomLine.create({
      data: {
        boardId,
        product,
        phaseId,
        parentId: draft.parentId,
        name,
        vendor: draft.vendor.trim(),
        partNumber: draft.partNumber.trim(),
        qty: draft.qty,
        unitPrice: draft.unitPrice,
        currency,
        fxRate: currency === "TWD" ? 1 : draft.fxRate,
        note: draft.note.trim(),
        deliveryDate,
        // 新增的列:沒填的自訂欄位帶預設值。
        extra: compactExtra({ ...customDefaults(customColumns), ...submitted }) as Prisma.InputJsonValue,
        order: (maxOrder._max.order ?? 0) + 1,
        createdById: session.userId,
      },
    });
  }

  await resyncBomMaterial(boardId, phaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 刪掉(或改回沿用而不見)的「檔案附件」欄位:它在每一列上的檔案一併刪掉(資料庫的列與磁碟上的檔案)。 */
async function dropFilesOfRemovedColumns(boardId: string, removed: BomColumnDef[]): Promise<void> {
  const ids = removed.filter((c) => c.type === "FILE").map((c) => c.id);
  if (ids.length === 0) return;
  const rows = await prisma.bomAttachment.findMany({ where: { boardId, columnId: { in: ids } }, select: { id: true, url: true } });
  await prisma.bomAttachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  await removeBomFiles(rows.map((r) => r.url));
}

/**
 * 存這個看板 BOM 的欄位設定(整份取代)。可以編輯這個看板 BOM 的人(管理者、專案建立者、分組的 Team Leader)都能設。
 * 設定會成為看板自己的,之後系統預設改了也不動它(要回到沿用,用 resetBomColumns)。
 * 刪掉的自訂欄位,它在每一列裡的值一併清掉。
 */
export async function saveBomColumns(boardId: string, columns: unknown): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);
  const checked = validateBomColumns(columns);
  if ("error" in checked) return { error: checked.error };

  const keep = new Set(checked.value.map((c) => c.id));
  const removed = (await loadBomColumns(boardId)).filter(isCustomColumn).filter((c) => !keep.has(c.id));
  await prisma.$transaction(async (tx) => {
    await tx.board.update({ where: { id: boardId }, data: { bomColumns: checked.value as unknown as Prisma.InputJsonValue } });
    for (const c of removed) await tx.$executeRaw`UPDATE "BomLine" SET "extra" = "extra" - ${c.id}::text WHERE "boardId" = ${boardId}`;
  });
  await dropFilesOfRemovedColumns(boardId, removed);
  const custom = checked.value.filter(isCustomColumn).map((c) => c.name);
  await logAudit(
    "COST",
    session.userId,
    `修改 BOM 欄位設定(自訂欄位:${custom.length > 0 ? custom.join("、") : "無"}${removed.length > 0 ? `;刪除 ${removed.map((c) => c.name).join("、")}` : ""})`,
    boardId
  );
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/** 這個看板的 BOM 欄位改回沿用系統預設(看板自己加的、預設裡沒有的自訂欄位,值一併清掉)。 */
export async function resetBomColumns(boardId: string): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);
  const before = await loadBomColumns(boardId);
  const system = resolveBomColumns(null, (await getSystemSettings()).bomDefaultColumns).columns;
  const keep = new Set(system.map((c) => c.id));
  const removed = before.filter(isCustomColumn).filter((c) => !keep.has(c.id));
  await prisma.$transaction(async (tx) => {
    await tx.board.update({ where: { id: boardId }, data: { bomColumns: Prisma.DbNull } });
    for (const c of removed) await tx.$executeRaw`UPDATE "BomLine" SET "extra" = "extra" - ${c.id}::text WHERE "boardId" = ${boardId}`;
  });
  await dropFilesOfRemovedColumns(boardId, removed);
  await logAudit("COST", session.userId, "BOM 欄位設定改回沿用系統預設", boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteBomLine(boardId: string, id: string): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);
  const line = await prisma.bomLine.findUnique({ where: { id }, select: { boardId: true, phaseId: true, product: true, name: true } });
  if (!line || line.boardId !== boardId) return { error: "找不到這一列" };

  // 底下的子項目靠外鍵連帶刪除;它們的檔案附件列也跟著走,磁碟上的檔案要自己清。
  const siblings = await prisma.bomLine.findMany({ where: { boardId, phaseId: line.phaseId, product: line.product }, select: { id: true, parentId: true } });
  const doomed = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of siblings) {
      if (s.parentId && doomed.has(s.parentId) && !doomed.has(s.id)) {
        doomed.add(s.id);
        grew = true;
      }
    }
  }
  const files = await prisma.bomAttachment.findMany({ where: { bomLineId: { in: [...doomed] } }, select: { url: true } });
  await prisma.bomLine.delete({ where: { id } });
  await removeBomFiles(files.map((f) => f.url));
  await logAudit("COST", session.userId, `刪除 BOM 項目「${line.name}」`, boardId);
  await resyncBomMaterial(boardId, line.phaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 改一列的階層(BOM LEVEL,1 起算,1 = 最上層)。規則見 lib/bomLevel.ts:這一列底下的子項目整串跟著位移;
 * 往外升階時,後面原本同層的列會變成它的子項目;一列最多比前一列深一層。
 * 一列有了子項目,它自己填的單價就不再算(改算底下的加總);失去全部子項目則反過來——這種情形回一段說明給畫面提醒,
 * 不然總價會無聲無息地變。
 */
export async function setBomLineLevel(
  boardId: string,
  product: string,
  phaseId: string,
  lineId: string,
  level: number
): Promise<{ error?: string; notice?: string }> {
  const session = await requireBomAdmin(boardId);

  const rows = await prisma.bomLine.findMany({
    where: { boardId, product, phaseId },
    orderBy: { order: "asc" },
    select: { id: true, parentId: true, name: true, order: true, unitPrice: true, currency: true },
  });
  const target = rows.find((r) => r.id === lineId);
  if (!target) return { error: "找不到這一列" };

  // 用畫面一樣的算法排出「看到的順序」(先序走訪),階層是從樹算出來的深度。
  const summary = summariseBom(
    rows.map((r) => ({
      id: r.id,
      parentId: r.parentId,
      name: r.name,
      vendor: "",
      partNumber: "",
      qty: 1,
      unitPrice: 0,
      currency: "TWD",
      fxRate: 1,
      note: "",
      deliveryDate: null,
      order: r.order,
    }))
  );
  const flat = flattenBom(summary.nodes).map((n) => ({ id: n.id, parentId: n.parentId, depth: n.depth, order: n.order }));
  const result = setBomLevel(flat, lineId, level);
  if ("error" in result) return { error: result.error };
  if (result.moves.length === 0) return {};

  const oldLevel = flat.find((l) => l.id === lineId)!.depth + 1;
  await prisma.$transaction(
    result.moves.map((m) => prisma.bomLine.update({ where: { id: m.id }, data: { parentId: m.parentId, order: m.order } }))
  );

  // 哪些列因此變成子集(單價不再算)、哪些列因此回到零件(改算自己的單價)。
  const parentAfter = new Map(rows.map((r) => [r.id, r.parentId]));
  for (const m of result.moves) parentAfter.set(m.id, m.parentId);
  const parentsBefore = new Set(rows.flatMap((r) => (r.parentId ? [r.parentId] : [])));
  const parentsAfter = new Set([...parentAfter.values()].flatMap((p) => (p ? [p] : [])));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const priceText = (id: string) => {
    const r = byId.get(id)!;
    return `${Number(r.unitPrice)} ${r.currency}`;
  };
  const notes: string[] = [];
  for (const id of parentsAfter) {
    if (!parentsBefore.has(id) && Number(byId.get(id)!.unitPrice) > 0) {
      notes.push(`「${byId.get(id)!.name}」現在有子項目了,它自己填的單價(${priceText(id)})不再計算,改算底下子項目的加總。`);
    }
  }
  for (const id of parentsBefore) {
    if (!parentsAfter.has(id) && byId.has(id)) {
      notes.push(`「${byId.get(id)!.name}」沒有子項目了,改算它自己填的單價(${priceText(id)})。`);
    }
  }

  await logAudit("COST", session.userId, `調整 BOM 項目「${target.name}」的階層(BOM LEVEL ${oldLevel} → ${level})`, boardId);
  await resyncBomMaterial(boardId, phaseId);
  revalidatePath(`/boards/${boardId}`);
  return notes.length > 0 ? { notice: notes.slice(0, 5).join("\n") } : {};
}

/**
 * 把一份 BOM(某個產品、某個階段)整棵複製到另一個產品 / 階段,由上而下:父項目一定要先建好,
 * 子項目的 parentId 才有東西可以指。逐筆 create() 而不是整批塞進 createMany——create() 會直接回傳新 id,
 * 不用另外查一次資料庫再用欄位比對猜是哪一列建出來的。呼叫端要先確認目標是空的。
 */
async function copyBomTree(
  boardId: string,
  from: { product: string; phaseId: string },
  to: { product: string; phaseId: string },
  userId: string
): Promise<number> {
  const source = await prisma.bomLine.findMany({
    where: { boardId, product: from.product, phaseId: from.phaseId },
    orderBy: { order: "asc" },
  });
  const idMap = new Map<string, string>();
  await prisma.$transaction(async (tx) => {
    let remaining = source;
    while (remaining.length > 0) {
      const ready = remaining.filter((r) => r.parentId === null || idMap.has(r.parentId));
      if (ready.length === 0) break; // 理論上到不了這裡——資料庫的 FK 已經擋住循環。
      for (const r of ready) {
        const created = await tx.bomLine.create({
          data: {
            boardId,
            product: to.product,
            phaseId: to.phaseId,
            parentId: r.parentId ? (idMap.get(r.parentId) ?? null) : null,
            name: r.name,
            vendor: r.vendor,
            partNumber: r.partNumber,
            qty: r.qty,
            unitPrice: r.unitPrice,
            currency: r.currency,
            fxRate: r.fxRate,
            note: r.note,
            deliveryDate: r.deliveryDate,
            extra: (r.extra ?? {}) as Prisma.InputJsonValue,
            order: r.order,
            createdById: userId,
          },
          select: { id: true },
        });
        idMap.set(r.id, created.id);
      }
      remaining = remaining.filter((r) => !idMap.has(r.id));
    }
  });
  return idMap.size;
}

/**
 * 要求目標階段這個產品的 BOM 是空的:複製要解決的是「大部分照抄、少數修改」,合併兩份不同來源的 BOM
 * 沒有清楚的規則該保留哪一邊。
 */
export async function copyBomLines(
  boardId: string,
  product: string,
  fromPhaseId: string,
  toPhaseId: string
): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);
  if (fromPhaseId === toPhaseId) return { error: "來源與目標是同一個階段" };

  const [sourceCount, targetCount] = await Promise.all([
    prisma.bomLine.count({ where: { boardId, product, phaseId: fromPhaseId } }),
    prisma.bomLine.count({ where: { boardId, product, phaseId: toPhaseId } }),
  ]);
  if (sourceCount === 0) return { error: "來源階段還沒有這個產品的 BOM" };
  if (targetCount > 0) return { error: "目標階段已經有這個產品的 BOM,請先清空,或個別編輯差異" };

  const copied = await copyBomTree(boardId, { product, phaseId: fromPhaseId }, { product, phaseId: toPhaseId }, session.userId);
  await logAudit("COST", session.userId, `複製「${product}」的 BOM(${copied} 列),從一個階段到另一個階段`, boardId);
  await resyncBomMaterial(boardId, toPhaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 新增一份 BOM(某個產品、某個階段)。產品不存在就一起建;可以選一份現有的 BOM(任何產品、任何階段)當起點整份複製,
 * 不選就是空白。目標已經有 BOM 就不動它,回說明——直接選那一份編輯就好,不要靜靜地蓋掉。
 */
export async function createBom(
  boardId: string,
  product: string,
  phaseId: string,
  source: { product: string; phaseId: string } | null
): Promise<{ error?: string }> {
  const guard = await productAdmin(boardId);
  if ("error" in guard) return { error: guard.error };
  const name = product.trim();
  const invalid = validateProductName(name);
  if (invalid) return { error: invalid };

  const phase = await prisma.budgetPhase.findFirst({ where: { id: phaseId, boardId }, select: { name: true } });
  if (!phase) return { error: "找不到這個階段" };
  const existing = await prisma.bomLine.count({ where: { boardId, product: name, phaseId } });
  if (existing > 0) return { error: `「${name}」在「${phase.name}」已經有 BOM 了,直接選它來編輯就好` };

  if (source) {
    if (source.product === name && source.phaseId === phaseId) return { error: "起點跟新的 BOM 是同一份" };
    const count = await prisma.bomLine.count({ where: { boardId, product: source.product, phaseId: source.phaseId } });
    if (count === 0) return { error: "選的那份 BOM 是空的,沒有東西可以複製" };
  }

  // 產品還不存在就建起來(單獨建立的產品、樣機計畫、BOM 用到的名字都算存在)。
  const [own, proto, bom] = await Promise.all([
    prisma.budgetProduct.findUnique({ where: { boardId_name: { boardId, name } }, select: { id: true } }),
    prisma.protoPlan.findFirst({ where: { boardId, product: name }, select: { id: true } }),
    prisma.bomLine.findFirst({ where: { boardId, product: name }, select: { id: true } }),
  ]);
  if (!own && !proto && !bom) await prisma.budgetProduct.create({ data: { boardId, name, createdById: guard.session.userId } });

  let copied = 0;
  if (source) {
    copied = await copyBomTree(boardId, source, { product: name, phaseId }, guard.session.userId);
    await resyncBomMaterial(boardId, phaseId);
  }
  await logAudit(
    "COST",
    guard.session.userId,
    source ? `新增 BOM「${name} / ${phase.name}」,複製自「${source.product}」的一份(${copied} 列)` : `新增 BOM「${name} / ${phase.name}」`,
    boardId
  );
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 貼上整張 BOM(從 Excel 複製):接在這個產品、這個階段現有的列後面。縮排(depth)排出上下層,
 * 子項目的上層就是前面最近一列比它淺一層的那一列。外幣沒填匯率的,用目前的匯率補,沒有匯率就整列略過並說明。
 * 有問題的列略過、其餘照貼,一次寫入、只重算一次材料預算。
 */
export async function pasteBomLines(
  boardId: string,
  product: string,
  phaseId: string,
  rows: PastedBomRow[]
): Promise<{ error?: string; created?: number; skipped?: string[]; warnings?: string[] }> {
  const guard = await productAdmin(boardId);
  if ("error" in guard) return { error: guard.error };
  if (rows.length === 0) return { error: "沒有可以貼上的列" };
  if (rows.length > MAX_PASTED_BOM_ROWS) return { error: `一次最多貼上 ${MAX_PASTED_BOM_ROWS} 列` };
  const phase = await prisma.budgetPhase.findFirst({ where: { id: phaseId, boardId }, select: { name: true } });
  if (!phase) return { error: "找不到這個階段" };
  const productName = product.trim();
  const invalid = validateProductName(productName);
  if (invalid) return { error: invalid };

  // 外幣沒填匯率:用目前的匯率。
  const codes = [...new Set(rows.filter((r) => r.fxRate === null && r.currency !== "TWD").map((r) => r.currency))];
  const rateRows = codes.length ? await prisma.exchangeRate.findMany({ where: { code: { in: codes } }, select: { code: true, rate: true } }) : [];
  const rateOf = new Map(rateRows.map((r) => [r.code, Number(r.rate)]));

  const skipped: string[] = [];
  const clean: PastedBomRow[] = [];
  for (const r of rows) {
    const label = `第 ${r.sourceRow} 列「${r.name}」`;
    const currency = r.currency.trim().toUpperCase();
    const fx = currency === "TWD" ? 1 : (r.fxRate ?? rateOf.get(currency) ?? null);
    if (!r.name.trim()) skipped.push(`第 ${r.sourceRow} 列沒有名稱,略過。`);
    else if (!Number.isFinite(r.qty) || r.qty <= 0) skipped.push(`${label}的數量必須大於 0,略過。`);
    else if (!Number.isFinite(r.unitPrice) || r.unitPrice < 0) skipped.push(`${label}的單價必須是 0 或正數,略過。`);
    else if (!/^[A-Z]{3}$/.test(currency)) skipped.push(`${label}的幣別請填三個英文字母,略過。`);
    else if (fx === null || !Number.isFinite(fx) || fx <= 0) skipped.push(`${label}是外幣(${currency}),沒填匯率、系統設定裡也沒有這個幣別的匯率,略過。`);
    else if (r.deliveryDate && !isValidDeliveryDate(r.deliveryDate)) skipped.push(`${label}的交期格式錯誤,略過。`);
    else clean.push({ ...r, name: r.name.trim(), currency, fxRate: fx, depth: Math.max(0, Math.floor(r.depth)) });
  }
  if (clean.length === 0) return { error: skipped.join("\n") || "沒有可以貼上的列", skipped };

  // 上層:前面最近一列、比它淺一層的那一列。被略過的列不在清單裡,它底下的子項目會掛到再上一層。
  let prevDepth = -1;
  for (const r of clean) {
    r.depth = Math.min(r.depth, prevDepth + 1);
    prevDepth = r.depth;
  }

  // 自訂欄位:表頭裡有的,依欄位類型讀貼上的文字(讀不懂的那一格留空、說一聲);表頭裡沒有的,帶預設值。
  const columns = await loadBomColumns(boardId);
  const customCols = columns.filter(isCustomColumn);
  const defaults = customDefaults(columns);
  const cellWarnings: string[] = [];
  const needUsers = customCols.some((c) => c.type === "PERSON" && clean.some((r) => r.extra && c.id in r.extra));
  const users = needUsers ? await prisma.user.findMany({ select: { id: true, name: true } }) : [];
  const extraOf = (r: PastedBomRow): Record<string, BomCellValue> => {
    const out: Record<string, BomCellValue> = { ...defaults };
    for (const c of customCols) {
      const text = r.extra?.[c.id];
      if (text === undefined) continue;
      delete out[c.id]; // 表頭裡有這一欄:貼的是什麼就是什麼(空白就是空白),不帶預設值
      const checked = importCellValue(c, text, users);
      if ("error" in checked) cellWarnings.push(`第 ${r.sourceRow} 列「${r.name}」:${checked.error},這一格留空。`);
      else if (checked.value !== null && checked.value !== false) out[c.id] = checked.value;
    }
    return out;
  };
  const maxRoot = await prisma.bomLine.aggregate({ where: { boardId, product: productName, phaseId, parentId: null }, _max: { order: true } });
  let rootOrder = maxRoot._max.order ?? 0;
  const childOrder = new Map<string, number>();
  const stack: string[] = []; // 各深度目前的那一列 id

  await prisma.$transaction(async (tx) => {
    for (const r of clean) {
      const parentId = r.depth === 0 ? null : (stack[r.depth - 1] ?? null);
      const order = parentId === null ? ++rootOrder : (childOrder.get(parentId) ?? 0) + 1;
      if (parentId !== null) childOrder.set(parentId, order);
      const created = await tx.bomLine.create({
        data: {
          boardId,
          product: productName,
          phaseId,
          parentId,
          name: r.name,
          vendor: r.vendor,
          partNumber: r.partNumber,
          qty: r.qty,
          unitPrice: r.unitPrice,
          currency: r.currency,
          fxRate: r.currency === "TWD" ? 1 : r.fxRate!,
          note: r.note,
          deliveryDate: r.deliveryDate,
          extra: extraOf(r) as Prisma.InputJsonValue,
          order,
          createdById: guard.session.userId,
        },
        select: { id: true },
      });
      stack[r.depth] = created.id;
      stack.length = r.depth + 1;
    }
  });

  await logAudit("COST", guard.session.userId, `貼上 BOM「${productName} / ${phase.name}」${clean.length} 列${skipped.length > 0 ? `(略過 ${skipped.length} 列)` : ""}`, boardId);
  await resyncBomMaterial(boardId, phaseId);
  revalidatePath(`/boards/${boardId}`);
  return { created: clean.length, skipped, warnings: cellWarnings };
}