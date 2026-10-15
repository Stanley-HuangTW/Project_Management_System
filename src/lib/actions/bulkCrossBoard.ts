"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { requireGroupStructureAccess } from "@/lib/actions/item";
import { accessibleBoardWhere, requireBoardAccess } from "@/lib/boardAccess";
import { canManageStructure } from "@/lib/permissions";
import { logActivity } from "@/lib/activityLog";
import { notifyStructuralChange } from "@/lib/notify";
import { dispatchWebhooks } from "@/lib/webhooks";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { loadTypeOptionIds, flipParentToSummary, restoreParentTypeIfChildless } from "@/lib/summaryType";
import { buildWbsIndexFromItems, normalizePredReferences, syncPredecessorSchedule } from "@/lib/predecessorLink";
import { collapseToRoots, lvlShiftFor, planCopy, subtreeIdsOf } from "@/lib/bulkStructure";
import {
  mapCellValue,
  planColumnMapping,
  remapPredAcrossBoards,
  stripPredReferences,
  type ColumnMapping,
} from "@/lib/crossBoard";

/**
 * 批次複製 / 移動到「別的看板」。同一個看板內的複製與移動在 bulkStructure.ts。
 *
 * 兩個看板的欄位 id 各自獨立:欄位值依「欄位名稱 + 類型」對應到目標看板(狀態選項依名稱),
 * 對不上的略過並在結果裡講清楚。前置依賴(Pred)只保留這次一起處理的項目之間的。
 * 移動是真的把項目連同子項目搬過去(id 不變,留言、附件、連結、待辦、工時、更新記錄、指派都跟著走);
 * 綁在原看板的紀錄搬不走:有已下單、支出、預算紀錄或對應預算階段的項目直接擋下,樣機使用紀錄清掉。
 *
 * 錯誤一律用回傳值帶回去,不用丟例外——production 的 Next.js 會把丟出來的訊息洗成一句通用的話。
 */
export type BulkTargetBoard = { id: string; name: string; groups: { id: string; name: string }[] };
export type BulkTargetItem = { id: string; name: string; parentId: string | null; order: number; groupId: string };

export type CrossBoardResult = {
  error?: string;
  /** 處理了幾個根項目(使用者勾的、扣掉祖先也被勾的)。 */
  roots: number;
  /** 連同子項目一共幾個項目。 */
  items: number;
  targetBoardName: string;
  /** 沒帶過去或被清掉的東西,逐條講給使用者聽。 */
  notes: string[];
};

const fail = (error: string): CrossBoardResult => ({ error, roots: 0, items: 0, targetBoardName: "", notes: [] });

const toJson = (value: unknown) => (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

async function structureAccessError(session: SessionPayload, groupId: string): Promise<string | null> {
  try {
    await requireGroupStructureAccess(session, groupId);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "權限不足";
  }
}

/** 這個人可以把項目放進去的看板與分組(目標分組要有「新增項目」的權限,跟同看板的複製一樣)。 */
export async function listBulkTargetBoards(): Promise<BulkTargetBoard[]> {
  const session = await requireSession();
  const boards = await prisma.board.findMany({
    where: accessibleBoardWhere(session),
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, groups: { orderBy: { order: "asc" }, select: { id: true, name: true } } },
  });
  if (canManageStructure(session.role)) return boards.filter((b) => b.groups.length > 0);

  const roleRows = await prisma.groupRoleAssignment.findMany({ where: { userId: session.userId }, select: { groupId: true } });
  const roleGroupIds = new Set(roleRows.map((r) => r.groupId));
  const result: BulkTargetBoard[] = [];
  for (const board of boards) {
    const groups: BulkTargetBoard["groups"] = [];
    for (const group of board.groups) {
      if (roleGroupIds.has(group.id) && (await structureAccessError(session, group.id)) === null) groups.push(group);
    }
    if (groups.length > 0) result.push({ id: board.id, name: board.name, groups });
  }
  return result;
}

/** 目標看板的項目樹(選「目標父項目」用)。只列這個人看得到的項目。 */
export async function loadBulkTargetTree(boardId: string): Promise<{ error?: string; items: BulkTargetItem[] }> {
  const session = await requireSession();
  try {
    await requireBoardAccess(boardId, session);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "沒有這個看板的存取權", items: [] };
  }
  const [items, visible] = await Promise.all([
    prisma.item.findMany({
      where: { boardId, deletedAt: null },
      select: { id: true, name: true, parentId: true, order: true, groupId: true },
    }),
    visibleItemIdsForBoard(boardId, session),
  ]);
  return { items: items.filter((i) => visible.has(i.id)) };
}

async function loadBoardColumns(boardId: string) {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      name: true,
      typeColumnId: true,
      predColumnId: true,
      columns: { orderBy: { order: "asc" }, select: { id: true, name: true, type: true, options: true } },
    },
  });
  if (!board) return null;
  return {
    name: board.name,
    columns: board.columns,
    typeColumnId: board.typeColumnId,
    predColumnId: board.predColumnId,
    lvlColumnId: board.columns.find((c) => c.name === "Lvl" && c.type === "NUMBER")?.id ?? null,
  };
}

/** 兩個動作共用的前置:驗證目標與權限、載入原看板的項目、把勾選收斂成根項目。 */
async function prepareAcross(
  itemIds: string[],
  targetParentId: string | null,
  targetGroupId: string,
  options: { normalizePreds: boolean }
) {
  const bad = (error: string) => ({ ok: false, error }) as const;
  const session = await requireSession();
  if (itemIds.length === 0) return bad("請先勾選項目");

  const targetGroup = await prisma.group.findUnique({ where: { id: targetGroupId }, select: { boardId: true } });
  if (!targetGroup) return bad("目標分組不存在");
  const targetBoardId = targetGroup.boardId;

  const found = await prisma.item.findMany({ where: { id: { in: itemIds }, deletedAt: null }, select: { id: true, boardId: true } });
  if (found.length !== new Set(itemIds).size) return bad("找不到其中的項目(可能已被刪除或搬走)");
  if (new Set(found.map((i) => i.boardId)).size !== 1) return bad("勾選的項目不在同一個看板");
  const sourceBoardId = found[0].boardId;
  if (sourceBoardId === targetBoardId) return bad("目標看板跟原看板是同一個,請用同看板內的複製或移動");

  let targetParentLvl: number | null | undefined = null;
  const dst = await loadBoardColumns(targetBoardId);
  if (!dst) return bad("目標看板不存在");
  if (targetParentId) {
    const parent = await prisma.item.findUnique({
      where: { id: targetParentId },
      select: { groupId: true, deletedAt: true, cellValues: { select: { columnId: true, value: true } } },
    });
    if (!parent || parent.deletedAt) return bad("目標父項目不存在");
    if (parent.groupId !== targetGroupId) return bad("目標父項目不在所選的分組裡");
    const lvl = dst.lvlColumnId ? parent.cellValues.find((cv) => cv.columnId === dst.lvlColumnId)?.value : undefined;
    targetParentLvl = typeof lvl === "number" ? lvl : undefined;
  }

  // 目標分組:要有「新增項目」的權限(管理者、主管,或該分組的負責角色),同時驗證目標看板的存取權。
  const targetError = await structureAccessError(session, targetGroupId);
  if (targetError) return bad(targetError);
  try {
    await requireBoardAccess(sourceBoardId, session);
  } catch (err) {
    return bad(err instanceof Error ? err.message : "沒有原看板的存取權");
  }

  // 舊匯入留下的 Pred 是 WBS 編號,只在「那個項目自己的分組」裡有意義——搬走之前先全部換成 id。
  if (options.normalizePreds) await normalizePredReferences(sourceBoardId);

  const [src, items, groups, visible, siblings] = await Promise.all([
    loadBoardColumns(sourceBoardId),
    prisma.item.findMany({
      where: { boardId: sourceBoardId, deletedAt: null },
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
    prisma.group.findMany({ where: { boardId: sourceBoardId }, select: { id: true }, orderBy: { order: "asc" } }),
    visibleItemIdsForBoard(sourceBoardId, session),
    prisma.item.findMany({
      where: { boardId: targetBoardId, groupId: targetGroupId, parentId: targetParentId, deletedAt: null },
      select: { order: true },
    }),
  ]);
  if (!src) return bad("原看板不存在");

  const onBoard = new Set(items.map((i) => i.id));
  // 不在原看板、已在垃圾桶、或這個人本來就看不到的項目,一律當作找不到。
  if (itemIds.some((id) => !onBoard.has(id) || !visible.has(id))) {
    return bad("找不到其中的項目(可能已被刪除、搬到別的看板,或你沒有權限看到)");
  }

  const rootIds = collapseToRoots(items, itemIds, groups.map((g) => g.id));
  const firstOrder = siblings.reduce((max, i) => Math.max(max, i.order), -1) + 1;
  return {
    ok: true,
    session,
    sourceBoardId,
    targetBoardId,
    src,
    dst,
    items,
    visible,
    rootIds,
    firstOrder,
    targetParentLvl,
  } as const;
}

type CellInput = { columnId: string; value: unknown };

/** 一個項目的欄位值換成目標看板的欄位。對不上的欄位 id 記在 skippedColumns,選項對不上的算一格。 */
function translateCells(
  cells: CellInput[],
  mapping: Map<string, ColumnMapping>,
  skip: ReadonlySet<string>,
  lvl: { targetColumnId: string | null; shift: number | null },
  tally: { skippedColumns: Set<string>; droppedOptions: number }
): CellInput[] {
  const out: CellInput[] = [];
  for (const cell of cells) {
    if (skip.has(cell.columnId) || cell.value === null || cell.value === undefined) continue;
    const map = mapping.get(cell.columnId);
    if (!map) {
      tally.skippedColumns.add(cell.columnId);
      continue;
    }
    const mapped = mapCellValue(map, cell.value);
    if (!mapped.ok) {
      tally.droppedOptions++;
      continue;
    }
    const value =
      lvl.shift !== null && map.targetId === lvl.targetColumnId && typeof mapped.value === "number"
        ? mapped.value + lvl.shift
        : mapped.value;
    out.push({ columnId: map.targetId, value });
  }
  return out;
}

function describeSkipped(
  columns: { id: string; name: string }[],
  tally: { skippedColumns: Set<string>; droppedOptions: number }
): string[] {
  const notes: string[] = [];
  if (tally.skippedColumns.size > 0) {
    const names = [...tally.skippedColumns].map((id) => columns.find((c) => c.id === id)?.name ?? id);
    notes.push(`目標看板沒有同名同類型的欄位,這些欄位的值沒帶過去:${names.join("、")}。`);
  }
  if (tally.droppedOptions > 0) {
    notes.push(`有 ${tally.droppedOptions} 格的狀態選項在目標看板找不到同名的選項,沒帶過去。`);
  }
  return notes;
}

function lvlShiftsByRoot(
  rootIds: string[],
  byId: Map<string, { cellValues: { columnId: string; value: unknown }[] }>,
  srcLvlColumnId: string | null,
  dstLvlColumnId: string | null,
  targetParentLvl: number | null | undefined
): Map<string, number | null> {
  const shifts = new Map<string, number | null>();
  for (const rootId of rootIds) {
    const rootLvl = srcLvlColumnId ? byId.get(rootId)?.cellValues.find((cv) => cv.columnId === srcLvlColumnId)?.value : undefined;
    shifts.set(rootId, srcLvlColumnId && dstLvlColumnId ? lvlShiftFor(rootLvl, targetParentLvl) : null);
  }
  return shifts;
}

export async function bulkCopyItemsAcross(
  itemIds: string[],
  targetParentId: string | null,
  targetGroupId: string
): Promise<CrossBoardResult> {
  const prep = await prepareAcross(itemIds, targetParentId, targetGroupId, { normalizePreds: false });
  if (!prep.ok) return fail(prep.error);
  const { session, sourceBoardId, targetBoardId, src, dst, items, visible, rootIds, firstOrder, targetParentLvl } = prep;

  // 看不到的子項目(私有列)不能因為複製就變成自己的——整串略過。
  const copyable = items.filter((i) => visible.has(i.id));
  const byId = new Map(items.map((i) => [i.id, i]));
  const plan = planCopy(copyable, rootIds, firstOrder);

  const mapping = planColumnMapping(src.columns, dst.columns, new Set(src.predColumnId ? [src.predColumnId] : []));
  const typeMapping = src.typeColumnId ? mapping.get(src.typeColumnId) : undefined;
  const shiftByRoot = lvlShiftsByRoot(rootIds, byId, src.lvlColumnId, dst.lvlColumnId, targetParentLvl);
  const wbsIndex = buildWbsIndexFromItems(items);
  const tally = { skippedColumns: new Set<string>(), droppedOptions: 0 };
  let droppedPreds = 0;

  const idMap = new Map<string, string>();
  const rootOf = new Map<string, string>();
  const createdRootIds: string[] = [];

  await prisma.$transaction(
    async (tx) => {
      for (const step of plan) {
        const source = byId.get(step.sourceId)!;
        const rootId = step.parentSourceId === null ? step.sourceId : rootOf.get(step.parentSourceId)!;
        rootOf.set(step.sourceId, rootId);
        const cells = translateCells(
          source.cellValues,
          mapping,
          new Set(src.predColumnId ? [src.predColumnId] : []),
          { targetColumnId: dst.lvlColumnId, shift: shiftByRoot.get(rootId) ?? null },
          tally
        );
        const created = await tx.item.create({
          data: {
            boardId: targetBoardId,
            groupId: targetGroupId,
            parentId: step.parentSourceId === null ? targetParentId : idMap.get(step.parentSourceId)!,
            name: source.name,
            order: step.order,
            createdById: session.userId,
            constraintType: source.constraintType,
            constraintDate: source.constraintDate,
            budgetCost: source.budgetCost,
            typeBeforeSummary: source.typeBeforeSummary ? (typeMapping?.optionMap?.get(source.typeBeforeSummary) ?? null) : null,
            visibility: source.visibility,
            viewers: source.viewers.length > 0 ? { create: source.viewers.map((v) => ({ userId: v.userId })) } : undefined,
            cellValues: { create: cells.map((c) => ({ columnId: c.columnId, value: toJson(c.value) })) },
          },
          select: { id: true },
        });
        idMap.set(step.sourceId, created.id);
        if (step.parentSourceId === null) createdRootIds.push(created.id);
      }

      // Pred 要等所有複本都建好才知道新 id:只留指到這次一起複製的項目的(改指複本),其餘清掉。
      if (src.predColumnId) {
        for (const step of plan) {
          const source = byId.get(step.sourceId)!;
          const raw = source.cellValues.find((cv) => cv.columnId === src.predColumnId)?.value;
          if (typeof raw !== "string" || !raw.trim()) continue;
          const result = remapPredAcrossBoards(wbsIndex, source.groupId, raw, (id) => idMap.get(id));
          droppedPreds += result.dropped;
          if (result.value === null || !dst.predColumnId) continue;
          await tx.cellValue.create({
            data: { itemId: idMap.get(step.sourceId)!, columnId: dst.predColumnId, value: result.value },
          });
        }
      }
    },
    // 一次可能複製幾百個項目;預設的 5 秒不夠,逾時會整批回復,什麼都沒建。
    { timeout: 120_000, maxWait: 10_000 }
  );

  if (targetParentId && dst.typeColumnId) {
    const typeIds = await loadTypeOptionIds(dst.typeColumnId);
    if (typeIds?.summaryId) await flipParentToSummary(targetParentId, dst.typeColumnId, typeIds.summaryId);
  }

  for (const [index, newId] of createdRootIds.entries()) {
    const source = byId.get(rootIds[index])!;
    await logActivity(newId, session.userId, `由看板「${src.name}」的「${source.name}」複製建立`);
    await notifyStructuralChange(prisma, newId, session.userId, "CREATED", "複製建立了這個項目");
    await dispatchWebhooks(targetBoardId, "item.created", {
      itemId: newId,
      name: source.name,
      groupId: targetGroupId,
      parentId: targetParentId,
    });
  }

  const notes = describeSkipped(src.columns, tally);
  if (droppedPreds > 0) notes.push(`有 ${droppedPreds} 條前置依賴指到這次沒一起複製的項目(或目標看板沒有 Pred 欄位),已清掉。`);

  revalidatePath(`/boards/${targetBoardId}`);
  revalidatePath(`/boards/${sourceBoardId}`);
  revalidatePath("/dashboard");
  return { roots: createdRootIds.length, items: plan.length, targetBoardName: dst.name, notes };
}

export async function bulkMoveItemsAcross(
  itemIds: string[],
  targetParentId: string | null,
  targetGroupId: string
): Promise<CrossBoardResult> {
  const prep = await prepareAcross(itemIds, targetParentId, targetGroupId, { normalizePreds: true });
  if (!prep.ok) return fail(prep.error);
  const { session, sourceBoardId, targetBoardId, src, dst, items, rootIds, firstOrder, targetParentLvl } = prep;
  const byId = new Map(items.map((i) => [i.id, i]));

  // 搬出去的來源分組也是結構變更,同樣要有權限(只有目標分組的權限不夠)。
  for (const groupId of new Set(rootIds.map((id) => byId.get(id)!.groupId))) {
    const error = await structureAccessError(session, groupId);
    if (error) return fail(error);
  }

  const moved = subtreeIdsOf(items, rootIds);
  const movedIds = [...moved];

  // 綁在原看板的紀錄搬不走:有這些的項目擋下來,請使用者改用複製或先處理。
  const [commitments, expenses, budgets, reserves, phases] = await Promise.all([
    prisma.commitment.findMany({ where: { itemId: { in: movedIds } }, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.expense.findMany({ where: { itemId: { in: movedIds } }, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.budget.findMany({ where: { itemId: { in: movedIds } }, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.reserve.findMany({ where: { itemId: { in: movedIds } }, select: { itemId: true }, distinct: ["itemId"] }),
    prisma.budgetPhase.findMany({ where: { boardId: sourceBoardId, itemId: { in: movedIds } }, select: { itemId: true } }),
  ]);
  const blocked = new Set<string>();
  for (const row of [...commitments, ...expenses, ...budgets, ...reserves, ...phases]) if (row.itemId) blocked.add(row.itemId);
  if (blocked.size > 0) {
    const names = [...blocked].slice(0, 5).map((id) => `「${byId.get(id)?.name ?? id}」`);
    return fail(
      `${names.join("、")}${blocked.size > 5 ? `等 ${blocked.size} 個項目` : ""}有已下單、支出、預算紀錄,或對應了預算階段。` +
        "這些紀錄綁在原看板,不能搬到別的看板——請先處理,或改用「複製到…」。"
    );
  }

  const mapping = planColumnMapping(src.columns, dst.columns, new Set(src.predColumnId ? [src.predColumnId] : []));
  const typeMapping = src.typeColumnId ? mapping.get(src.typeColumnId) : undefined;
  const shiftByRoot = lvlShiftsByRoot(rootIds, byId, src.lvlColumnId, dst.lvlColumnId, targetParentLvl);
  const rootOfItem = new Map<string, string>();
  const markRoot = (id: string, rootId: string) => {
    rootOfItem.set(id, rootId);
    for (const child of items) if (child.parentId === id) markRoot(child.id, rootId);
  };
  for (const rootId of rootIds) markRoot(rootId, rootId);

  const wbsIndex = buildWbsIndexFromItems(items);
  const tally = { skippedColumns: new Set<string>(), droppedOptions: 0 };
  let droppedPreds = 0;
  const newCells: { itemId: string; columnId: string; value: unknown }[] = [];
  const typeBeforeUpdates: { id: string; value: string | null }[] = [];
  for (const id of movedIds) {
    const item = byId.get(id)!;
    const cells = translateCells(
      item.cellValues,
      mapping,
      new Set(src.predColumnId ? [src.predColumnId] : []),
      { targetColumnId: dst.lvlColumnId, shift: shiftByRoot.get(rootOfItem.get(id)!) ?? null },
      tally
    );
    for (const c of cells) newCells.push({ itemId: id, ...c });
    if (src.predColumnId) {
      const raw = item.cellValues.find((cv) => cv.columnId === src.predColumnId)?.value;
      if (typeof raw === "string" && raw.trim()) {
        const result = remapPredAcrossBoards(wbsIndex, item.groupId, raw, (refId) => (moved.has(refId) ? refId : undefined));
        droppedPreds += result.dropped;
        if (result.value !== null && dst.predColumnId) newCells.push({ itemId: id, columnId: dst.predColumnId, value: result.value });
      }
    }
    if (item.typeBeforeSummary) {
      typeBeforeUpdates.push({ id, value: typeMapping?.optionMap?.get(item.typeBeforeSummary) ?? null });
    }
  }

  // 別的項目(留在原看板的)指到被搬走項目的前置,拿掉。
  const dependentUpdates: { itemId: string; value: string | null }[] = [];
  if (src.predColumnId) {
    for (const item of items) {
      if (moved.has(item.id)) continue;
      const raw = item.cellValues.find((cv) => cv.columnId === src.predColumnId)?.value;
      const stripped = stripPredReferences(raw, moved);
      if (stripped.changed) dependentUpdates.push({ itemId: item.id, value: stripped.value });
    }
  }
  const protoLinks = await prisma.itemProtoUnit.count({ where: { itemId: { in: movedIds } } });
  const oldParentIds = new Set(rootIds.map((id) => byId.get(id)!.parentId).filter((id): id is string => !!id));

  await prisma.$transaction(
    async (tx) => {
      await tx.cellValue.deleteMany({ where: { itemId: { in: movedIds } } });
      if (newCells.length > 0) {
        await tx.cellValue.createMany({
          data: newCells.map((c) => ({ itemId: c.itemId, columnId: c.columnId, value: toJson(c.value) })),
        });
      }
      await tx.item.updateMany({ where: { id: { in: movedIds } }, data: { boardId: targetBoardId, groupId: targetGroupId } });
      for (const [index, rootId] of rootIds.entries()) {
        await tx.item.update({ where: { id: rootId }, data: { parentId: targetParentId, order: firstOrder + index } });
      }
      for (const u of typeBeforeUpdates) await tx.item.update({ where: { id: u.id }, data: { typeBeforeSummary: u.value } });
      // 樣機使用紀錄指到原看板的樣機,搬走之後沒有意義。
      await tx.itemProtoUnit.deleteMany({ where: { itemId: { in: movedIds } } });
      await tx.activityLogEntry.updateMany({ where: { itemId: { in: movedIds } }, data: { boardId: targetBoardId } });
      for (const u of dependentUpdates) {
        if (u.value === null) await tx.cellValue.delete({ where: { itemId_columnId: { itemId: u.itemId, columnId: src.predColumnId! } } });
        else await tx.cellValue.update({ where: { itemId_columnId: { itemId: u.itemId, columnId: src.predColumnId! } }, data: { value: u.value } });
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  // Type=Summary 連動:新父項變成 Summary;搬空了的舊父項還原成原本的 Type。
  if (targetParentId && dst.typeColumnId) {
    const typeIds = await loadTypeOptionIds(dst.typeColumnId);
    if (typeIds?.summaryId) await flipParentToSummary(targetParentId, dst.typeColumnId, typeIds.summaryId);
  }
  if (src.typeColumnId) {
    for (const oldParentId of oldParentIds) await restoreParentTypeIfChildless(oldParentId, src.typeColumnId);
  }

  // 前置被拿掉的項目,日期照它現在剩下的規則重算(跟刪除項目同一個處理)。
  let resyncFailed = 0;
  if (src.predColumnId) {
    for (const u of dependentUpdates) {
      try {
        await syncPredecessorSchedule(sourceBoardId, u.itemId, src.predColumnId);
      } catch {
        resyncFailed++;
      }
    }
  }

  for (const rootId of rootIds) {
    await logActivity(rootId, session.userId, `從看板「${src.name}」搬移到看板「${dst.name}」`);
    await notifyStructuralChange(prisma, rootId, session.userId, "UPDATED", "把這個項目搬到別的看板");
  }

  const notes = describeSkipped(src.columns, tally);
  if (droppedPreds > 0) notes.push(`有 ${droppedPreds} 條前置依賴指到沒一起搬走的項目(或目標看板沒有 Pred 欄位),已清掉。`);
  if (dependentUpdates.length > 0) notes.push(`原看板有 ${dependentUpdates.length} 個項目的前置指到被搬走的項目,已清掉。`);
  if (protoLinks > 0) notes.push(`${protoLinks} 筆「使用樣機」紀錄指到原看板的樣機,已清掉。`);
  if (resyncFailed > 0) notes.push(`${resyncFailed} 個項目的日期重算失敗,請到原看板確認。`);

  revalidatePath(`/boards/${targetBoardId}`);
  revalidatePath(`/boards/${sourceBoardId}`);
  revalidatePath("/dashboard");
  return { roots: rootIds.length, items: moved.size, targetBoardName: dst.name, notes };
}
