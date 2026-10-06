"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { requireGroupStructureAccess } from "@/lib/actions/item";
import { logActivity } from "@/lib/activityLog";
import { planNameReplace } from "@/lib/bulkRename";
import { notifyStructuralChange } from "@/lib/notify";
import { dispatchWebhooks } from "@/lib/webhooks";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { loadTypeOptionIds, flipParentToSummary, restoreParentTypeIfChildless } from "@/lib/summaryType";
import { buildWbsIndexFromItems, normalizePredReferences } from "@/lib/predecessorLink";
import {
  collapseToRoots,
  lvlShiftFor,
  planCopy,
  planMoveToParent,
  remapPredValue,
  subtreeIdsOf,
  type MovePosition,
} from "@/lib/bulkStructure";

/**
 * 批次複製 / 移動:把勾選的項目(連同子項目)放到「目標父項目」底下,目標可以是同一個看板
 * 任何分組裡的任何項目,或某個分組的最上層。
 *
 * 錯誤一律用回傳值帶回去,不用丟例外——production 的 Next.js 會把丟出來的訊息洗成一句
 * 通用的話,使用者就看不到「為什麼不行」。
 */
export type BulkStructureResult = {
  error?: string;
  /** 處理了幾個根項目(使用者勾的、扣掉祖先也被勾的)。 */
  roots: number;
  /** 連同子項目一共幾個項目。 */
  items: number;
};

const fail = (error: string): BulkStructureResult => ({ error, roots: 0, items: 0 });

const toJson = (value: unknown) => (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

async function structureAccessError(session: SessionPayload, groupId: string): Promise<string | null> {
  try {
    await requireGroupStructureAccess(session, groupId);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "權限不足";
  }
}

/** 兩個動作共用的前置:驗證目標、載入整個看板的項目、把勾選收斂成根項目。 */
async function prepare(itemIds: string[], targetParentId: string | null, targetGroupId: string) {
  const session = await requireSession();
  if (itemIds.length === 0) return { ok: false, error: "請先勾選項目" } as const;

  const targetGroup = await prisma.group.findUnique({ where: { id: targetGroupId }, select: { boardId: true } });
  if (!targetGroup) return { ok: false, error: "目標分組不存在" } as const;
  if (targetParentId) {
    const parent = await prisma.item.findUnique({
      where: { id: targetParentId },
      select: { groupId: true, deletedAt: true },
    });
    if (!parent || parent.deletedAt) return { ok: false, error: "目標父項目不存在" } as const;
    if (parent.groupId !== targetGroupId) return { ok: false, error: "目標父項目不在所選的分組裡" } as const;
  }

  // 目標分組:要有「新增項目」的權限(管理者、主管,或該分組的負責角色),同時驗證看板存取權。
  const targetError = await structureAccessError(session, targetGroupId);
  if (targetError) return { ok: false, error: targetError } as const;
  const boardId = targetGroup.boardId;

  const [items, groups, visible] = await Promise.all([
    prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: {
        id: true,
        parentId: true,
        order: true,
        groupId: true,
        name: true,
        constraintType: true,
        constraintDate: true,
        budgetCost: true,
        typeBeforeSummary: true,
        visibility: true,
        viewers: { select: { userId: true } },
        cellValues: { select: { columnId: true, value: true } },
      },
    }),
    prisma.group.findMany({ where: { boardId }, select: { id: true }, orderBy: { order: "asc" } }),
    visibleItemIdsForBoard(boardId, session),
  ]);

  const onBoard = new Set(items.map((i) => i.id));
  // 不在這個看板、已在垃圾桶、或這個人本來就看不到的項目,一律當作找不到。
  if (itemIds.some((id) => !onBoard.has(id) || !visible.has(id))) {
    return { ok: false, error: "找不到其中的項目(可能已被刪除、搬到別的看板,或你沒有權限看到)" } as const;
  }

  const rootIds = collapseToRoots(items, itemIds, groups.map((g) => g.id));
  return { ok: true, session, boardId, items, rootIds, visible } as const;
}

async function loadBoardColumns(boardId: string) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { typeColumnId: true, predColumnId: true, columns: { select: { id: true, name: true, type: true } } },
  });
  return {
    typeColumnId: board?.typeColumnId ?? null,
    predColumnId: board?.predColumnId ?? null,
    lvlColumnId: board?.columns.find((c) => c.name === "Lvl" && c.type === "NUMBER")?.id ?? null,
  };
}

export async function bulkCopyItems(
  /** 不信任——看板一律從目標分組推導,見 prepare。 */
  _boardId: string,
  itemIds: string[],
  targetParentId: string | null,
  targetGroupId: string
): Promise<BulkStructureResult> {
  const prep = await prepare(itemIds, targetParentId, targetGroupId);
  if (!prep.ok) return fail(prep.error);
  const { session, boardId, items, rootIds, visible } = prep;

  if (targetParentId && subtreeIdsOf(items, rootIds).has(targetParentId)) {
    return fail("不能複製到被複製項目自己的子項目底下");
  }

  // 看不到的子項目(私有列)不能因為複製就變成自己的——整串略過。
  const copyable = items.filter((i) => visible.has(i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const siblings = items.filter((i) => i.parentId === targetParentId && i.groupId === targetGroupId);
  const firstOrder = siblings.reduce((max, i) => Math.max(max, i.order), -1) + 1;
  const plan = planCopy(copyable, rootIds, firstOrder);

  const { typeColumnId, predColumnId, lvlColumnId } = await loadBoardColumns(boardId);

  // Lvl:每個根項目各自換算(它們原本的層級可能不同),整串子樹加同一個差值。
  let targetParentLvl: number | null | undefined = null;
  if (targetParentId) {
    const lvl = lvlColumnId
      ? byId.get(targetParentId)?.cellValues.find((cv) => cv.columnId === lvlColumnId)?.value
      : undefined;
    targetParentLvl = typeof lvl === "number" ? lvl : undefined;
  }
  const lvlShiftByRoot = new Map<string, number | null>();
  for (const rootId of rootIds) {
    const rootLvl = lvlColumnId
      ? byId.get(rootId)?.cellValues.find((cv) => cv.columnId === lvlColumnId)?.value
      : undefined;
    lvlShiftByRoot.set(rootId, lvlColumnId ? lvlShiftFor(rootLvl, targetParentLvl) : null);
  }

  const wbsIndex = buildWbsIndexFromItems(items);
  const idMap = new Map<string, string>();
  const rootOf = new Map<string, string>();
  const createdRootIds: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const step of plan) {
        const source = byId.get(step.sourceId)!;
        const rootId = step.parentSourceId === null ? step.sourceId : rootOf.get(step.parentSourceId)!;
        rootOf.set(step.sourceId, rootId);
        const shift = lvlShiftByRoot.get(rootId) ?? null;

        const created = await tx.item.create({
          data: {
            boardId,
            groupId: targetGroupId,
            parentId: step.parentSourceId === null ? targetParentId : idMap.get(step.parentSourceId)!,
            name: source.name,
            order: step.order,
            createdById: session.userId,
            constraintType: source.constraintType,
            constraintDate: source.constraintDate,
            budgetCost: source.budgetCost,
            typeBeforeSummary: source.typeBeforeSummary,
            visibility: source.visibility,
            viewers: source.viewers.length > 0 ? { create: source.viewers.map((v) => ({ userId: v.userId })) } : undefined,
            cellValues: {
              create: source.cellValues.map((cv) => ({
                columnId: cv.columnId,
                value: toJson(
                  shift !== null && cv.columnId === lvlColumnId && typeof cv.value === "number"
                    ? cv.value + shift
                    : cv.value
                ),
              })),
            },
          },
          select: { id: true },
        });
        idMap.set(step.sourceId, created.id);
        if (step.parentSourceId === null) createdRootIds.push(created.id);
      }

      // Pred 要等所有複本都建好才知道新 id,所以放第二輪:指到這次一起複製的項目 → 改指複本。
      if (predColumnId) {
        for (const step of plan) {
          const source = byId.get(step.sourceId)!;
          const raw = source.cellValues.find((cv) => cv.columnId === predColumnId)?.value;
          if (typeof raw !== "string" || !raw.trim()) continue;
          const next = remapPredValue(wbsIndex, source.groupId, raw, idMap);
          if (next === raw) continue;
          await tx.cellValue.update({
            where: { itemId_columnId: { itemId: idMap.get(step.sourceId)!, columnId: predColumnId } },
            data: { value: next ?? Prisma.JsonNull },
          });
        }
      }
    },
    // 一次可能複製幾百個項目;預設的 5 秒不夠,逾時會整批回復,什麼都沒建。
    { timeout: 120_000, maxWait: 10_000 }
  );

  if (targetParentId && typeColumnId) {
    const typeIds = await loadTypeOptionIds(typeColumnId);
    if (typeIds?.summaryId) await flipParentToSummary(targetParentId, typeColumnId, typeIds.summaryId);
  }

  for (const [index, newId] of createdRootIds.entries()) {
    const source = byId.get(rootIds[index])!;
    await logActivity(newId, session.userId, `由「${source.name}」複製建立`);
    await notifyStructuralChange(prisma, newId, session.userId, "CREATED", "複製建立了這個項目");
    await dispatchWebhooks(boardId, "item.created", {
      itemId: newId,
      name: source.name,
      groupId: targetGroupId,
      parentId: targetParentId,
    });
  }

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  return { roots: createdRootIds.length, items: plan.length };
}

export async function bulkMoveItems(
  /** 不信任——看板一律從目標分組推導,見 prepare。 */
  _boardId: string,
  itemIds: string[],
  targetParentId: string | null,
  targetGroupId: string,
  /** 插在新父項底下哪裡(WBS 編號順序);不給就接在最後面。 */
  position?: MovePosition
): Promise<BulkStructureResult> {
  const prep = await prepare(itemIds, targetParentId, targetGroupId);
  if (!prep.ok) return fail(prep.error);
  const { session, boardId, items, rootIds } = prep;
  const byId = new Map(items.map((i) => [i.id, i]));

  // 搬出去的來源分組也是結構變更,同樣要有權限(只有目標分組的權限不夠)。
  for (const groupId of new Set(rootIds.map((id) => byId.get(id)!.groupId))) {
    if (groupId === targetGroupId) continue;
    const error = await structureAccessError(session, groupId);
    if (error) return fail(error);
  }

  const plan = planMoveToParent(items, rootIds, targetParentId, targetGroupId, position);
  if (!plan.ok) {
    return fail(
      plan.reason === "target-in-moved"
        ? "不能把項目搬到它自己或它的子項目底下"
        : plan.reason === "target-group-mismatch"
          ? "目標父項目不在所選的分組裡"
          : plan.reason === "position-not-found"
            ? "指定的位置找不到(它可能剛被搬走或刪除),請重新選擇位置"
            : "找不到其中的項目"
    );
  }

  const moved = subtreeIdsOf(items, rootIds);
  const crossGroup = [...moved].some((id) => byId.get(id)!.groupId !== targetGroupId);
  // 舊匯入留下的 Pred 是 WBS 編號——編號只在「那個項目自己的分組」裡有意義,搬到別的分組
  // 之後會指到別人。趁編號還對得上,先全部換成 id。
  if (crossGroup) await normalizePredReferences(boardId);

  const { typeColumnId, lvlColumnId } = await loadBoardColumns(boardId);

  // Lvl:跟 moveItemWithinGroup 同一個規則——父層真的換了才調整,新父項沒有數字 Lvl 就整段跳過。
  const lvlUpdates: { itemId: string; value: number }[] = [];
  if (lvlColumnId) {
    let targetParentLvl: number | null | undefined = null;
    if (targetParentId) {
      const lvl = byId.get(targetParentId)?.cellValues.find((cv) => cv.columnId === lvlColumnId)?.value;
      targetParentLvl = typeof lvl === "number" ? lvl : undefined;
    }
    for (const rootId of rootIds) {
      const root = byId.get(rootId)!;
      if (root.parentId === targetParentId && root.groupId === targetGroupId) continue;
      const shift = lvlShiftFor(root.cellValues.find((cv) => cv.columnId === lvlColumnId)?.value, targetParentLvl);
      if (!shift) continue;
      for (const id of subtreeIdsOf(items, [rootId])) {
        const value = byId.get(id)!.cellValues.find((cv) => cv.columnId === lvlColumnId)?.value;
        if (typeof value === "number") lvlUpdates.push({ itemId: id, value: value + shift });
      }
    }
  }

  await prisma.$transaction(
    async (tx) => {
      for (const w of plan.writes) {
        await tx.item.update({ where: { id: w.id }, data: { parentId: w.parentId, order: w.order, groupId: w.groupId } });
      }
      for (const u of lvlUpdates) {
        await tx.cellValue.update({
          where: { itemId_columnId: { itemId: u.itemId, columnId: lvlColumnId! } },
          data: { value: u.value },
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  // Type=Summary 連動:新父項變成 Summary;搬空了的舊父項還原成原本的 Type。
  if (typeColumnId) {
    const typeIds = await loadTypeOptionIds(typeColumnId);
    if (targetParentId && typeIds?.summaryId) {
      await flipParentToSummary(targetParentId, typeColumnId, typeIds.summaryId);
    }
    const oldParents = new Set(rootIds.map((id) => byId.get(id)!.parentId).filter((id): id is string => !!id));
    for (const oldParentId of oldParents) {
      if (oldParentId !== targetParentId) await restoreParentTypeIfChildless(oldParentId, typeColumnId);
    }
  }

  const targetName = targetParentId ? `「${byId.get(targetParentId)!.name}」底下` : "分組最上層";
  for (const rootId of rootIds) {
    await logActivity(rootId, session.userId, `批次搬移到${targetName}`);
    await notifyStructuralChange(prisma, rootId, session.userId, "UPDATED", "批次搬移了這個項目的位置");
  }

  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  return { roots: rootIds.length, items: moved.size };
}

export type BulkRenameResult = {
  error?: string;
  /** 實際改了名的項目數。 */
  changed: number;
  /** 名稱裡沒有出現那段字樣的項目數。 */
  unchanged: number;
  /** 取代後會變成空白而跳過的項目數。 */
  blank: number;
};

const failRename = (error: string): BulkRenameResult => ({ error, changed: 0, unchanged: 0, blank: 0 });

/**
 * 批次取代名稱字樣:只改勾選的項目本身(不連帶沒勾的子項目)。名稱在 server 端用資料庫裡
 * 現在的值重算,不信任畫面預覽那份;權限比照單筆改名(requireGroupStructureAccess),
 * 涉及的每個分組都要過,有一個不行就整批不動。
 */
export async function bulkReplaceItemNames(
  /** 不信任——看板一律從項目推導。 */
  _boardId: string,
  itemIds: string[],
  find: string,
  replace: string
): Promise<BulkRenameResult> {
  const session = await requireSession();
  if (itemIds.length === 0) return failRename("請先勾選項目");
  if (!find) return failRename("請輸入要尋找的字樣");

  const items = await prisma.item.findMany({
    where: { id: { in: itemIds }, deletedAt: null },
    select: { id: true, name: true, groupId: true, boardId: true },
  });
  if (items.length !== new Set(itemIds).size) {
    return failRename("找不到其中的項目(可能已被刪除)");
  }
  const boardIds = new Set(items.map((i) => i.boardId));
  if (boardIds.size !== 1) return failRename("勾選的項目不在同一個看板");
  const boardId = items[0].boardId;

  const visible = await visibleItemIdsForBoard(boardId, session);
  if (items.some((i) => !visible.has(i.id))) {
    return failRename("找不到其中的項目(可能已被刪除,或你沒有權限看到)");
  }
  for (const groupId of new Set(items.map((i) => i.groupId))) {
    const accessError = await structureAccessError(session, groupId);
    if (accessError) return failRename(accessError);
  }

  const plan = planNameReplace(items, find, replace);
  if (plan.changes.length > 0) {
    await prisma.$transaction([
      ...plan.changes.map((c) => prisma.item.update({ where: { id: c.id }, data: { name: c.to } })),
      prisma.activityLogEntry.createMany({
        data: plan.changes.map((c) => ({
          itemId: c.id,
          boardId,
          actorId: session.userId,
          message: `項目名稱從「${c.from}」改為「${c.to}」`,
          category: "ITEM" as const,
        })),
      }),
    ]);
    revalidatePath(`/boards/${boardId}`);
  }
  return { changed: plan.changes.length, unchanged: plan.unchangedIds.length, blank: plan.blankIds.length };
}
