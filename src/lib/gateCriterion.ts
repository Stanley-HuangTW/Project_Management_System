/**
 * 出口條件有指定確認人時,「達成」不是手動勾的,而是確認人表態的結果:全部同意才算達成,
 * 有一個人不同意、或還有人沒表態,都不算。沒有指定確認人的條件維持手動勾選(回 null = 不由表態決定)。
 * 純函式。
 */
export function metFromDecisions(decisions: readonly ("APPROVED" | "REJECTED" | null)[]): boolean | null {
  if (decisions.length === 0) return null;
  return decisions.every((d) => d === "APPROVED");
}

export const MAX_CRITERION_APPROVERS = 10;
