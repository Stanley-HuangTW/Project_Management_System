"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { upsertAssignment, removeAssignment } from "@/lib/actions/assignment";
import { setItemProtoUnits } from "@/lib/actions/itemProtoUnits";
import { normalizeAllocationPct } from "@/lib/allocationPct";
import { UserError } from "@/lib/userError";

/** 跟 bulk.ts 的 BulkResult 同一個形狀:applied = 做了幾項;skipped = 沒做的原因(每個原因一行,已統計項數)與要讓人知道的注意事項。 */
export type BulkAssignResult = { applied: number; skipped: string[] };

const MAX_ITEMS = 500;

/** 同一個原因的項目合併成一行:「3 項:權限不足…」。 */
function tally(reasons: string[]): string[] {
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return [...counts].map(([reason, n]) => `${n} 項:${reason}`);
}

const reasonOf = (err: unknown) => (err instanceof UserError ? err.message : "發生未預期的錯誤,沒有套用");

/**
 * 勾選的工作項一次「加入 / 移除」某個人的人員分配。
 *
 * 每一項照單項的規則逐個處理(upsertAssignment / removeAssignment):權限(負責人、主管的團隊、
 * Team Leader…)、主管只能指派自己團隊、活動紀錄、被指派的人收到通知,都跟一個一個設定一樣。
 * 沒權限或做不到的項目略過並說明原因,不會讓整批失敗——選了 200 項,一項不能改不該讓其他 199 項也不做。
 *
 * 注意:被指派的人每個新指派的項目會各收到一則通知(跟一個一個指派一樣)。
 */
export async function bulkAssignUsers(
  boardId: string,
  itemIds: string[],
  userId: string,
  allocationPct: number,
  mode: "add" | "remove"
): Promise<BulkAssignResult> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (mode !== "add" && mode !== "remove") throw new UserError("不認得的動作");
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).filter((id) => typeof id === "string"))];
  if (ids.length === 0) return { applied: 0, skipped: ["沒有選取任何項目"] };
  if (ids.length > MAX_ITEMS) throw new UserError(`一次最多處理 ${MAX_ITEMS} 項,請分批`);
  if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw new UserError("找不到這位使用者");
  const pct = normalizeAllocationPct(allocationPct);

  const items = await prisma.item.findMany({
    where: { id: { in: ids }, boardId, deletedAt: null },
    select: { id: true, assignments: { select: { userId: true } } },
  });
  const reasons: string[] = ids.length > items.length ? Array(ids.length - items.length).fill("項目不存在或不屬於這個看板") : [];
  let applied = 0;

  for (const item of items) {
    const already = item.assignments.some((a) => a.userId === userId);
    if (mode === "remove" && !already) {
      reasons.push("這個人本來就沒有被分配到,不用移除");
      continue;
    }
    try {
      if (mode === "add") await upsertAssignment(boardId, item.id, userId, pct);
      else await removeAssignment(boardId, item.id, userId);
      applied++;
    } catch (err) {
      reasons.push(reasonOf(err));
    }
  }
  return { applied, skipped: tally(reasons) };
}

/**
 * 勾選的工作項一次「加入 / 移除」某幾台樣機(「使用樣機」)。逐項走 setItemProtoUnits:誰能改、
 * 樣機是不是這個看板的、活動紀錄、樣機使用時間重疊的提醒與通知都跟單項一樣。
 * 加入時沿用那一項已經選的樣機(只是多加);移除時只拿掉指定的,其他不動。
 */
export async function bulkSetProtoUnits(
  boardId: string,
  itemIds: string[],
  protoUnitIds: string[],
  mode: "add" | "remove"
): Promise<BulkAssignResult> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);
  if (mode !== "add" && mode !== "remove") throw new UserError("不認得的動作");
  const ids = [...new Set((Array.isArray(itemIds) ? itemIds : []).filter((id) => typeof id === "string"))];
  const units = [...new Set((Array.isArray(protoUnitIds) ? protoUnitIds : []).filter((id) => typeof id === "string"))];
  if (ids.length === 0) return { applied: 0, skipped: ["沒有選取任何項目"] };
  if (units.length === 0) throw new UserError("請先選要加入或移除的樣機");
  if (ids.length > MAX_ITEMS) throw new UserError(`一次最多處理 ${MAX_ITEMS} 項,請分批`);

  const items = await prisma.item.findMany({
    where: { id: { in: ids }, boardId, deletedAt: null },
    select: { id: true, protoUnits: { select: { protoUnitId: true } } },
  });
  const reasons: string[] = ids.length > items.length ? Array(ids.length - items.length).fill("項目不存在或不屬於這個看板") : [];
  const warnings = new Set<string>();
  let applied = 0;

  for (const item of items) {
    const current = item.protoUnits.map((p) => p.protoUnitId);
    const next =
      mode === "add" ? [...new Set([...current, ...units])] : current.filter((id) => !units.includes(id));
    const unchanged = next.length === current.length && next.every((id) => current.includes(id));
    if (unchanged) {
      reasons.push(mode === "add" ? "已經選了這些樣機" : "本來就沒有選這些樣機");
      continue;
    }
    try {
      const result = await setItemProtoUnits(item.id, next);
      if (result.error) {
        reasons.push(result.error);
        continue;
      }
      if (result.warning) warnings.add(result.warning);
      applied++;
    } catch (err) {
      reasons.push(reasonOf(err));
    }
  }
  return { applied, skipped: [...tally(reasons), ...[...warnings].map((w) => `注意:${w}`)] };
}
