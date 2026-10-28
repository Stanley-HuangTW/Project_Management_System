/**
 * 待辦事項的「處理者」預設是誰。依序:
 * 1. 訊息裡 @ 提到的人(從對話轉過來才有)——**即使工作項已經有負責人**,也以被提到的為準;提到好幾位取第一位;
 * 2. 工作項的負責人(負責人欄位);好幾位就取人員分配工作量比例最高的;
 * 3. 沒有負責人:人員分配裡工作量比例最高的人;
 * 4. 還是沒有:登記過工時最多的人。
 * 風險 / 問題 / 議題的待辦事項只有 1(提到的人)與 2(那一筆的負責人)。
 */

export type AssigneeReason = "mention" | "owner" | "allocation" | "hours";

export const ASSIGNEE_REASON_LABELS: Record<AssigneeReason, string> = {
  mention: "訊息裡提到的人",
  owner: "負責人",
  allocation: "人員分配裡工作量比例最高的人",
  hours: "登記工時最多的人",
};

export type AssigneeInputs = {
  /** 訊息裡 @ 到的使用者,依出現的先後。 */
  mentioned?: string[];
  /** 工作項的負責人(負責人欄位裡真的有帳號的人)。 */
  ownerIds: string[];
  /** 人員分配:誰、工作量比例。 */
  assignments: { userId: string; allocationPct: number }[];
  /** 工時:誰、登記了幾小時。 */
  hours: { userId: string; hours: number }[];
};

export function defaultTodoAssignee(input: AssigneeInputs): { userId: string; reason: AssigneeReason } | null {
  const mentioned = input.mentioned?.[0];
  if (mentioned) return { userId: mentioned, reason: "mention" };

  const pctOf = new Map<string, number>();
  for (const a of input.assignments) pctOf.set(a.userId, Math.max(pctOf.get(a.userId) ?? 0, a.allocationPct));
  const hoursOf = new Map<string, number>();
  for (const h of input.hours) hoursOf.set(h.userId, (hoursOf.get(h.userId) ?? 0) + h.hours);

  /** 工作量比例高的在前;一樣就看工時;還是一樣保持原本的順序(sort 是穩定的)。 */
  const strongest = (ids: string[]) =>
    [...ids].sort((a, b) => (pctOf.get(b) ?? 0) - (pctOf.get(a) ?? 0) || (hoursOf.get(b) ?? 0) - (hoursOf.get(a) ?? 0))[0];

  const owners = [...new Set(input.ownerIds)];
  if (owners.length > 0) return { userId: strongest(owners), reason: "owner" };
  if (pctOf.size > 0) return { userId: strongest([...pctOf.keys()]), reason: "allocation" };
  if (hoursOf.size > 0) return { userId: strongest([...hoursOf.keys()]), reason: "hours" };
  return null;
}
