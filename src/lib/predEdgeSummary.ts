import { splitPredEntry, type RelationshipType } from "@/lib/predecessorLink";

export type PredEdgeSummary = {
  itemId: string;
  /** "1.3.2 底盤機構設計" — how people refer to it. */
  label: string;
  relationship: RelationshipType | null;
  lag: number | null;
};

/**
 * Reads a Pred cell into something displayable, resolving each reference
 * against the items already on screen.
 *
 * Deliberately index-free: the table renders hundreds of rows and building a
 * WBS index per row to show a label would cost more than the label is worth.
 * Ids and legacy WBS codes are both matched, the same two forms the picker
 * accepts.
 */
export function summarizePredEdges(
  value: unknown,
  options: { id: string; code: string; name: string }[]
): PredEdgeSummary[] {
  if (typeof value !== "string" || !value.trim()) return [];
  const summaries: PredEdgeSummary[] = [];
  const seen = new Set<string>();
  for (const part of value.split(",")) {
    if (!part.trim()) continue;
    const { ref, relationship, lag } = splitPredEntry(part);
    const match = options.find((o) => o.id === ref) ?? options.find((o) => o.code === ref);
    if (!match || seen.has(match.id)) continue;
    seen.add(match.id);
    summaries.push({
      itemId: match.id,
      label: `${match.code} ${match.name}`.trim(),
      relationship,
      lag,
    });
  }
  return summaries;
}

const RELATIONSHIP_LABELS: readonly string[] = ["FS", "SS", "FF", "SF"];

/**
 * 新選一個前置時,這條依賴的關聯類型該是什麼:
 *  - 這個項目的 Link 欄已經填了關係(FS / SS / FF / SF)→ null,也就是「預設」,沿用 Link 欄——
 *    使用者已經挑過了,新前置不該偷偷蓋過它;
 *  - Link 欄空白(或不是四種關係)→ "FS"(最常見的關係),而且寫明在這條依賴上,
 *    不然 Link 空白就排不出日期。
 */
export function defaultNewPredRelationship(linkLabel: string | null | undefined): RelationshipType | null {
  return linkLabel && RELATIONSHIP_LABELS.includes(linkLabel) ? null : "FS";
}

/** "SS-2" / "FS" / "+3" / "" — what this edge overrides, in the notation the
 *  cell actually stores. */
export function formatEdgeSuffix(edge: Pick<PredEdgeSummary, "relationship" | "lag">): string {
  const rel = edge.relationship ?? "";
  const lag = edge.lag ? `${edge.lag > 0 ? "+" : ""}${edge.lag}` : "";
  return `${rel}${lag}`;
}

/** The tooltip for a Link or Lag cell some of whose edges disagree with it:
 *  null when every edge is content with the column's own value.
 *
 *  columnValue is what the column effectively says ("FS" for an empty Link,
 *  since a new predecessor now defaults to FS) — an edge that says the same
 *  thing is not overriding anything, so it gets no marker. */
export function describeEdgeOverrides(
  edges: PredEdgeSummary[],
  kind: "relationship" | "lag",
  columnValue?: RelationshipType | null
): string | null {
  const overriding = edges.filter((e) => {
    const own = kind === "relationship" ? e.relationship : e.lag;
    return own !== null && !(kind === "relationship" && columnValue && own === columnValue);
  });
  if (overriding.length === 0) return null;
  const lines = overriding.map((e) =>
    kind === "relationship" ? `${e.label}:${e.relationship}` : `${e.label}:${e.lag! > 0 ? "+" : ""}${e.lag} 天`
  );
  return `以下前置有自己的${kind === "relationship" ? "關係型別" : " Lag"},不看這一欄:\n${lines.join("\n")}`;
}
