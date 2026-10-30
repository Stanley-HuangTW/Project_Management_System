"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireItemBoardAccess } from "@/lib/boardAccess";
import { canEditCellValue } from "@/lib/permissions";
import { isItemAssignedToUser, isItemAssignedToTeam } from "@/lib/itemAssignment";
import { loadGroupRoleContext } from "@/lib/groupRoleContext";
import { logActivity } from "@/lib/activityLog";
import { protoUnitLabel } from "@/lib/protoUnits";
import { loadProtoUnitsData, type ProtoUnitOptionData } from "@/lib/protoUnitsServer";

type ProtoUnitsPayload = { options: ProtoUnitOptionData[]; byItem: Record<string, string[]> };

const MAX_UNITS = 200;

/**
 * 設定一個工作項(例如測試項目)的「使用樣機」:它用到哪幾台樣機(樣機計畫排出來的每一台)。
 * 整份換掉:傳進來的就是之後的全部。
 *
 * 誰能改:跟改狀態欄一樣——管理者、主管,或被指派到這個項目(或這個分組同職能)的人。
 * 樣機必須是這個看板的;剛好被樣機計畫拿掉的會被擋下,請對方重新整理後再選。
 */
async function loadEditableItem(itemId: string) {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const [item, personColumns] = await Promise.all([
    prisma.item.findUnique({
      where: { id: itemId },
      include: { cellValues: true, assignments: true, protoUnits: { select: { protoUnitId: true } } },
    }),
    prisma.column.findMany({ where: { boardId, type: "PERSON" }, select: { id: true } }),
  ]);
  if (!item) return { error: "找不到這個項目" };

  const personColumnIds = personColumns.map((c) => c.id);
  const assigned = isItemAssignedToUser(item, personColumnIds, session.userId);
  const groupRole = await loadGroupRoleContext(item.groupId, session.userId);
  const assignedToDiscipline = groupRole ? isItemAssignedToTeam(item, personColumnIds, groupRole.teamUserIds) : false;
  if (!canEditCellValue(session.role, "STATUS", false, assigned, assignedToDiscipline)) {
    return { error: "權限不足:你只能編輯自己被指派或負責項目的「使用樣機」" };
  }
  return { session, boardId, item };
}

export async function setItemProtoUnits(itemId: string, protoUnitIds: string[]): Promise<{ error?: string }> {
  const ids = [...new Set((Array.isArray(protoUnitIds) ? protoUnitIds : []).filter((id) => typeof id === "string"))];
  if (ids.length > MAX_UNITS) return { error: "一次選的樣機太多" };

  const loaded = await loadEditableItem(itemId);
  if ("error" in loaded) return { error: loaded.error };
  const { session, boardId, item } = loaded;

  const [units, phases] = await Promise.all([
    prisma.protoUnit.findMany({ where: { id: { in: ids }, boardId }, select: { id: true, product: true, unit: true, phaseId: true, seq: true } }),
    prisma.budgetPhase.findMany({ where: { boardId }, select: { id: true, name: true } }),
  ]);
  if (units.length !== ids.length) return { error: "有的樣機已經不在樣機計畫裡了(台數可能剛被改小),請重新整理後再選。" };

  const before = new Set(item.protoUnits.map((p) => p.protoUnitId));
  const changed = ids.length !== before.size || ids.some((id) => !before.has(id));
  if (!changed) return {};

  await prisma.$transaction([
    prisma.itemProtoUnit.deleteMany({ where: { itemId, protoUnitId: { notIn: ids } } }),
    prisma.itemProtoUnit.createMany({ data: ids.map((protoUnitId) => ({ itemId, protoUnitId })), skipDuplicates: true }),
  ]);

  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const labels = units
    .map((u) => protoUnitLabel(u, phaseName.get(u.phaseId) ?? ""))
    .sort((a, b) => a.localeCompare(b));
  await logActivity(itemId, session.userId, labels.length > 0 ? `使用樣機改為:${labels.join("、")}` : "使用樣機清空");
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/project/${boardId}`);
  return {};
}

/**
 * 在看板以外的地方(儀表板)開項目卡片、人員分配視窗時,「使用樣機」要選的樣機與這個工作項目前用到的。
 * 看板裡面這些資料已經由看板頁面給了,不用呼叫這個。
 */
export async function loadItemProtoUnits(itemId: string): Promise<ProtoUnitsPayload> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);
  return loadProtoUnitsData(boardId, new Set([itemId]));
}

/**
 * 設定一個工作項佔用某一台樣機的百分比(預設 100%,1–100)。工作項要先選了這台樣機;
 * 誰能改跟「使用樣機」一樣。儀表板的樣機使用時程會依這個百分比算每一週的佔用。
 */
export async function setItemProtoUnitPct(itemId: string, protoUnitId: string, usagePct: number): Promise<{ error?: string }> {
  if (!Number.isInteger(usagePct) || usagePct < 1 || usagePct > 100) return { error: "百分比需介於 1 到 100 之間" };

  const loaded = await loadEditableItem(itemId);
  if ("error" in loaded) return { error: loaded.error };
  const { session, boardId, item } = loaded;

  const link = await prisma.itemProtoUnit.findUnique({
    where: { itemId_protoUnitId: { itemId, protoUnitId } },
    select: { usagePct: true, protoUnit: { select: { product: true, unit: true, phaseId: true, seq: true } } },
  });
  if (!link) return { error: "這個工作項沒有選這台樣機(可能剛被拿掉),請重新整理後再試。" };
  if (link.usagePct === usagePct) return {};

  await prisma.itemProtoUnit.update({ where: { itemId_protoUnitId: { itemId, protoUnitId } }, data: { usagePct } });

  const phase = await prisma.budgetPhase.findUnique({ where: { id: link.protoUnit.phaseId }, select: { name: true } });
  await logActivity(
    item.id,
    session.userId,
    `${protoUnitLabel(link.protoUnit, phase?.name ?? "")} 的使用百分比:${link.usagePct}% → ${usagePct}%`
  );
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/project/${boardId}`);
  return {};
}
