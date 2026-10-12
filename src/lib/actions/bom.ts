"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { logAudit } from "@/lib/activityLog";
import { canEditBudget } from "@/lib/actions/budget";
import {
  summariseBom,
  flattenBom,
  bomMaterialBudget,
  unionProducts,
  validateProductName,
  validateProductRename,
  type BomLineInput,
  type BomNode,
} from "@/lib/bom";

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
  const first = await prisma.item.findFirst({
    where: { boardId, parentId: null, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  const allowed = first
    ? await canEditBudget({ kind: "item", id: first.id }, session)
    : session.role === "ADMIN";
  if (!allowed) {
    throw new Error("權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯樣機 BOM");
  }
  return session;
}

export type BomContext = {
  phases: { id: string; name: string }[];
  /** 產品名稱:單獨新增的、樣機計畫用到的、BOM 用到的三者的聯集,給下拉選單當候選。 */
  products: string[];
  /** 整塊看板層級的編輯權——跟選了哪個產品/階段無關,匯入 Excel(動到整
   *  塊看板的 BOM)這種操作用得到,不用等使用者選了某個產品才知道能不能匯入。 */
  canEdit: boolean;
};

export async function getBomContext(boardId: string): Promise<BomContext | null> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true } });
  if (!board) return null;

  const [phases, protoProducts, bomProducts, ownProducts, first] = await Promise.all([
    prisma.budgetPhase.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.protoPlan.findMany({ where: { boardId }, select: { product: true }, distinct: ["product"] }),
    prisma.bomLine.findMany({ where: { boardId }, select: { product: true }, distinct: ["product"] }),
    prisma.budgetProduct.findMany({ where: { boardId }, select: { name: true } }),
    prisma.item.findFirst({
      where: { boardId, parentId: null, deletedAt: null },
      orderBy: { order: "asc" },
      select: { id: true },
    }),
  ]);

  const products = unionProducts(
    ownProducts.map((p) => p.name),
    protoProducts.map((p) => p.product),
    bomProducts.map((p) => p.product)
  );
  const canEdit = first
    ? await canEditBudget({ kind: "item", id: first.id }, session)
    : session.role === "ADMIN";
  return { phases, products, canEdit };
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
    prisma.bomLine.updateMany({ where: { boardId, product: from }, data: { product: next } }),
  ]);
  await logAudit("COST", guard.session.userId, `產品「${from}」改名為「${next}」`, boardId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export type ProductUsage = { bomLines: number; protoRows: number; phases: number };

/** 刪除一個產品之前先看它底下有多少東西——給確認視窗說「會一併刪掉什麼」。 */
export async function getProductUsage(boardId: string, product: string): Promise<ProductUsage | { error: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  const [bomLines, protoRows, bomPhases, protoPhases] = await Promise.all([
    prisma.bomLine.count({ where: { boardId, product } }),
    prisma.protoPlan.findMany({ where: { boardId, product }, select: { unit: true }, distinct: ["unit"] }),
    prisma.bomLine.findMany({ where: { boardId, product }, select: { phaseId: true }, distinct: ["phaseId"] }),
    prisma.protoPlan.findMany({ where: { boardId, product }, select: { phaseId: true }, distinct: ["phaseId"] }),
  ]);
  return {
    bomLines,
    protoRows: protoRows.length,
    phases: new Set([...bomPhases, ...protoPhases].map((p) => p.phaseId)).size,
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
  const [bom, proto] = await prisma.$transaction([
    // 子項目靠外鍵連帶刪除,所以只刪最上層那幾列再算筆數不準——直接刪整個產品的所有列。
    prisma.bomLine.deleteMany({ where: { boardId, product } }),
    prisma.protoPlan.deleteMany({ where: { boardId, product } }),
    prisma.budgetProduct.deleteMany({ where: { boardId, name: product } }),
  ]);
  await logAudit(
    "COST",
    guard.session.userId,
    `刪除產品「${product}」(${bom.count} 筆 BOM、${proto.count} 個樣機計畫台數)`,
    boardId
  );
  for (const phaseId of new Set([...bomPhases, ...protoPhases].map((p) => p.phaseId))) {
    await resyncBomMaterial(boardId, phaseId);
  }
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
    order: r.order,
  }));
  const summary = summariseBom(input);

  const first = await prisma.item.findFirst({
    where: { boardId, parentId: null, deletedAt: null },
    orderBy: { order: "asc" },
    select: { id: true },
  });

  return {
    boardName: board.name,
    phases: ctx.phases,
    products: ctx.products,
    product,
    phaseId,
    lines: flattenBom(summary.nodes),
    unitCostTwd: summary.unitCostTwd,
    lineCount: summary.lineCount,
    foreignCurrencies: summary.foreignCurrencies,
    orphanIds: summary.orphanIds,
    canEdit: first
      ? await canEditBudget({ kind: "item", id: first.id }, session)
      : session.role === "ADMIN",
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
      select: { boardId: true, product: true, phaseId: true },
    });
    if (!existing || existing.boardId !== boardId || existing.product !== product || existing.phaseId !== phaseId) {
      return { error: "找不到這一列" };
    }
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
        order: (maxOrder._max.order ?? 0) + 1,
        createdById: session.userId,
      },
    });
  }

  await resyncBomMaterial(boardId, phaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

export async function deleteBomLine(boardId: string, id: string): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);
  const line = await prisma.bomLine.findUnique({ where: { id }, select: { boardId: true, phaseId: true, name: true } });
  if (!line || line.boardId !== boardId) return { error: "找不到這一列" };

  // FK cascade 會把底下的子項目一起刪掉。
  await prisma.bomLine.delete({ where: { id } });
  await logAudit("COST", session.userId, `刪除 BOM 項目「${line.name}」`, boardId);
  await resyncBomMaterial(boardId, line.phaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 把某個產品在來源階段的整份 BOM 複製一份到目標階段。
 *
 * 每次 BOM 可能不太一樣——EVT 用工程樣品,DVT 換量產件——但也不是每個
 * 位置都會換,先複製一份當底稿,再改有差異的地方,比每次從零開始打快。
 *
 * 要求目標階段這個產品的 BOM 是空的:複製要解決的是「大部分照抄、少數
 * 修改」,合併兩份不同來源的 BOM 沒有清楚的規則該保留哪一邊。
 */
export async function copyBomLines(
  boardId: string,
  product: string,
  fromPhaseId: string,
  toPhaseId: string
): Promise<{ error?: string }> {
  const session = await requireBomAdmin(boardId);
  if (fromPhaseId === toPhaseId) return { error: "來源與目標是同一個階段" };

  const [source, targetCount] = await Promise.all([
    prisma.bomLine.findMany({
      where: { boardId, product, phaseId: fromPhaseId },
      orderBy: { order: "asc" },
    }),
    prisma.bomLine.count({ where: { boardId, product, phaseId: toPhaseId } }),
  ]);
  if (source.length === 0) return { error: "來源階段還沒有這個產品的 BOM" };
  if (targetCount > 0) return { error: "目標階段已經有這個產品的 BOM,請先清空,或個別編輯差異" };

  // 由上而下複製:父項目一定要先建好,子項目的 parentId 才有東西可以指。
  // 逐筆 create() 而不是整批塞進 createMany——create() 會直接回傳新 id,
  // 不用另外查一次資料庫再用欄位比對猜是哪一列建出來的。
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
            product,
            phaseId: toPhaseId,
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
            order: r.order,
            createdById: session.userId,
          },
          select: { id: true },
        });
        idMap.set(r.id, created.id);
      }
      remaining = remaining.filter((r) => !idMap.has(r.id));
    }
  });

  await logAudit(
    "COST",
    session.userId,
    `複製「${product}」的 BOM(${idMap.size} 列),從一個階段到另一個階段`,
    boardId
  );
  await resyncBomMaterial(boardId, toPhaseId);
  revalidatePath(`/boards/${boardId}`);
  return {};
}

/**
 * 重算一個階段的材料預算:每個產品的單台 BOM 價 × 樣機計畫裡那個產品在
 * 這個階段要幾台,各產品分別算完再加總。
 *
 * 只要這個階段還有任何一筆 BOM,材料預算就整個由這裡驅動(即使算出來是
 * 0,也是「BOM 說目前是 0」而不是「還沒人設定」)——沒有 BOM 的階段完全
 * 不動,材料預算照舊是手動填的那一欄。跟人力規劃表驅動人力預算是同一個
 * 設計。
 */
export async function resyncBomMaterial(boardId: string, phaseId: string): Promise<void> {
  const bomLines = await prisma.bomLine.findMany({
    where: { boardId, phaseId },
    select: {
      product: true,
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
      order: true,
      id: true,
    },
  });
  if (bomLines.length === 0) {
    // 這個階段現在完全沒有 BOM 了——可能是從沒有過,也可能是剛把最後一筆
    // 刪光。只清掉「由 BOM 表算出來」的那個殘值,不能不分青紅皂白刪
    // MATERIAL,不然會把使用者自己手動填的預算也一起沖掉。
    await prisma.budget.deleteMany({
      where: { phaseId, category: "MATERIAL", note: "由 BOM 表計算" },
    });
    return;
  }

  const byProduct = new Map<string, BomLineInput[]>();
  for (const line of bomLines) {
    const list = byProduct.get(line.product) ?? [];
    list.push({
      id: line.id,
      parentId: line.parentId,
      name: line.name,
      vendor: line.vendor,
      partNumber: line.partNumber,
      qty: Number(line.qty),
      unitPrice: Number(line.unitPrice),
      currency: line.currency,
      fxRate: Number(line.fxRate),
      note: line.note,
      deliveryDate: line.deliveryDate,
      order: line.order,
    });
    byProduct.set(line.product, list);
  }

  const qtyRows = await prisma.protoPlan.groupBy({
    by: ["product"],
    where: { boardId, phaseId, product: { in: [...byProduct.keys()] } },
    _sum: { qty: true },
  });
  const qtyByProduct = new Map(qtyRows.map((r) => [r.product, r._sum.qty ?? 0]));

  const perProduct = [...byProduct.entries()].map(([product, lines]) => ({
    product,
    unitCostTwd: summariseBom(lines).unitCostTwd,
    qty: qtyByProduct.get(product) ?? 0,
  }));
  const amount = bomMaterialBudget(perProduct);

  if (amount > 0) {
    await prisma.budget.upsert({
      where: { phaseId_category: { phaseId, category: "MATERIAL" } },
      create: { phaseId, category: "MATERIAL", amount, note: "由 BOM 表計算" },
      update: { amount, note: "由 BOM 表計算" },
    });
  } else {
    await prisma.budget.deleteMany({ where: { phaseId, category: "MATERIAL" } });
  }
}
