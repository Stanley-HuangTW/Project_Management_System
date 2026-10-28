import { prisma } from "@/lib/prisma";
import { getPersonIds } from "@/types/column";
import { findMentionedUserIds } from "@/lib/mentions";
import { defaultTodoAssignee, type AssigneeReason } from "@/lib/todoAssignee";

export type AssigneeSuggestion = { userId: string; reason: AssigneeReason } | null;

/** 文字裡 @ 到的使用者(依出現的先後)。沒有 @ 就不用去查使用者。 */
async function mentionedIn(text: string): Promise<string[]> {
  if (!text.includes("@")) return [];
  const users = await prisma.user.findMany({ select: { id: true, name: true } });
  return findMentionedUserIds(text, users);
}

/**
 * 一個工作項的待辦事項,預設由誰處理(規則見 todoAssignee):文字裡 @ 的人 → 負責人 →
 * 人員分配工作量比例最高的人 → 登記工時最多的人。text 給了才會看 @。
 */
export async function suggestItemAssignee(itemId: string, text = ""): Promise<AssigneeSuggestion> {
  const [mentioned, personCells, assignments, hours] = await Promise.all([
    mentionedIn(text),
    prisma.cellValue.findMany({ where: { itemId, column: { type: "PERSON" } }, select: { value: true } }),
    prisma.assignment.findMany({ where: { itemId }, select: { userId: true, allocationPct: true } }),
    prisma.timeEntry.groupBy({ by: ["userId"], where: { itemId }, _sum: { hours: true } }),
  ]);

  // 負責人欄位裡也可能是治具 / 廠商(Resource),沒有帳號,不能當處理者。
  const ownerCandidates = [...new Set(personCells.flatMap((c) => getPersonIds(c.value)))];
  const realOwners = ownerCandidates.length
    ? new Set((await prisma.user.findMany({ where: { id: { in: ownerCandidates } }, select: { id: true } })).map((u) => u.id))
    : new Set<string>();

  return defaultTodoAssignee({
    mentioned,
    ownerIds: ownerCandidates.filter((id) => realOwners.has(id)),
    assignments,
    hours: hours.map((h) => ({ userId: h.userId, hours: Number(h._sum.hours ?? 0) })),
  });
}

/** 風險 / 問題 / 議題的待辦事項:文字裡 @ 的人 → 那一筆的負責人。 */
export async function suggestRiskAssignee(riskId: string, text = ""): Promise<AssigneeSuggestion> {
  const [mentioned, risk] = await Promise.all([mentionedIn(text), prisma.riskEntry.findUnique({ where: { id: riskId }, select: { ownerId: true } })]);
  return defaultTodoAssignee({ mentioned, ownerIds: risk?.ownerId ? [risk.ownerId] : [], assignments: [], hours: [] });
}

/** 指定的處理者要是真的使用者;回傳他的名字(寫紀錄用),找不到回 null。 */
export async function assigneeName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  return user?.name ?? null;
}
