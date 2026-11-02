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
import { checkMachineOverload } from "@/lib/protoOverloadServer";

type ProtoUnitsPayload = { options: ProtoUnitOptionData[]; byItem: Record<string, string[]> };

const MAX_UNITS = 200;

/**
 * 誰能改一個工作項的「使用樣機」:跟改狀態欄一樣——管理者、主管,或被指派到這個項目(或這個分組同職能)的人。
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

/**
 * 這個人能不能改這個工作項的「使用樣機」——畫面上決定要不要給選單用。
 * 項目卡片、人員分配視窗不像表格那一欄知道「分組同職能」這層關係,所以直接問伺服器,跟存檔時的判斷同一份。
 */
export async function canEditProtoUnitsOf(itemId: string): Promise<boolean> {
  try {
    return !("error" in (await loadEditableItem(itemId)));
  } catch {
    return false;
  }
}

/**
 * 設定一個工作項(例如測試項目)的「使用樣機」:它用到哪幾台樣機(樣機計畫排出來的每一台)。
 * 整份換掉:傳進來的就是之後的全部。
 *
 * 樣機必須是這個看板的;剛好被樣機計畫拿掉的會被擋下,請對方重新整理後再選。
 * 新選的樣機如果在那幾天已經有別的工作項在用、合計超過 100%,回傳 warning 給操作的人看,
 * 也會通知其他工作項的負責人(見 checkMachineOverload)。
 */
export async function setItemProtoUnits(
  itemId: string,
  protoUnitIds: string[],
  /** 給「上一步 / 下一步」用:目前應該正好是這幾台;不是就代表中間被別人改過,不蓋掉。 */
  expectedCurrent?: string[]
): Promise<{ error?: string; warning?: string }> {
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
  if (expectedCurrent && (expectedCurrent.length !== before.size || expectedCurrent.some((id) => !before.has(id)))) {
    return { error: "這個工作項的「使用樣機」已經被改過,為了不蓋掉新的修改,沒有執行。" };
  }
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

  // 「上一步 / 下一步」重做時(帶著 expectedCurrent)不再提醒、不再通知:同一個選擇不該對別人通知兩次。
  const added = ids.filter((id) => !before.has(id));
  const warning = !expectedCurrent && added.length > 0 ? await checkMachineOverload(added, session, { itemId, itemName: item.name }) : null;
  return warning ? { warning } : {};
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
 * applyToAll:這個工作項用到的每一台都改成同一個百分比(一個測試同時用好幾台時,不必一台一台點)。
 * 把百分比調高、讓那幾天合計超過 100% 的,回傳 warning 並通知其他工作項的負責人。
 */
export async function setItemProtoUnitPct(
  itemId: string,
  protoUnitId: string,
  usagePct: number,
  applyToAll = false
): Promise<{ error?: string; warning?: string }> {
  if (!Number.isInteger(usagePct) || usagePct < 1 || usagePct > 100) return { error: "百分比需介於 1 到 100 之間" };

  const loaded = await loadEditableItem(itemId);
  if ("error" in loaded) return { error: loaded.error };
  const { session, boardId, item } = loaded;

  const links = await prisma.itemProtoUnit.findMany({
    where: applyToAll ? { itemId } : { itemId, protoUnitId },
    select: { protoUnitId: true, usagePct: true, protoUnit: { select: { product: true, unit: true, phaseId: true, seq: true } } },
  });
  if (links.length === 0) return { error: "這個工作項沒有選這台樣機(可能剛被拿掉),請重新整理後再試。" };
  const changing = links.filter((l) => l.usagePct !== usagePct);
  if (changing.length === 0) return {};

  await prisma.itemProtoUnit.updateMany({
    where: { itemId, protoUnitId: { in: changing.map((l) => l.protoUnitId) } },
    data: { usagePct },
  });

  const phases = await prisma.budgetPhase.findMany({ where: { boardId }, select: { id: true, name: true } });
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const labelOf = (l: (typeof links)[number]) => protoUnitLabel(l.protoUnit, phaseName.get(l.protoUnit.phaseId) ?? "");
  await logActivity(
    item.id,
    session.userId,
    changing.length === 1
      ? `${labelOf(changing[0])} 的使用百分比:${changing[0].usagePct}% → ${usagePct}%`
      : `使用百分比統一改為 ${usagePct}%(${changing.length} 台):${changing.map(labelOf).join("、")}`
  );
  revalidatePath(`/boards/${boardId}`);
  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/project/${boardId}`);

  const raised = changing.filter((l) => usagePct > l.usagePct).map((l) => l.protoUnitId);
  const warning = raised.length > 0 ? await checkMachineOverload(raised, session, { itemId, itemName: item.name }) : null;
  return warning ? { warning } : {};
}
