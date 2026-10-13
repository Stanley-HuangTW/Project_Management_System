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

const MAX_UNITS = 200;

/**
 * 設定一個工作項(例如測試項目)的「使用樣機」:它用到哪幾台樣機(樣機計畫排出來的每一台)。
 * 整份換掉:傳進來的就是之後的全部。
 *
 * 誰能改:跟改狀態欄一樣——管理者、主管,或被指派到這個項目(或這個分組同職能)的人。
 * 樣機必須是這個看板的;剛好被樣機計畫拿掉的會被擋下,請對方重新整理後再選。
 */
export async function setItemProtoUnits(itemId: string, protoUnitIds: string[]): Promise<{ error?: string }> {
  const session = await requireSession();
  const boardId = await requireItemBoardAccess(itemId, session);

  const ids = [...new Set((Array.isArray(protoUnitIds) ? protoUnitIds : []).filter((id) => typeof id === "string"))];
  if (ids.length > MAX_UNITS) return { error: "一次選的樣機太多" };

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
  return {};
}
