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

/** "SS-2" / "FS" / "+3" / "" — what this edge overrides, in the notation the
 *  cell actually stores. */
export function formatEdgeSuffix(edge: Pick<PredEdgeSummary, "relationship" | "lag">): string {
  const rel = edge.relationship ?? "";
  const lag = edge.lag ? `${edge.lag > 0 ? "+" : ""}${edge.lag}` : "";
  return `${rel}${lag}`;
}

/** The tooltip for a Link or Lag cell some of whose edges disagree with it:
 *  null when every edge is content with the column's own value. */
export function describeEdgeOverrides(
  edges: PredEdgeSummary[],
  kind: "relationship" | "lag"
): string | null {
  const overriding = edges.filter((e) => (kind === "relationship" ? e.relationship : e.lag) !== null);
  if (overriding.length === 0) return null;
  const lines = overriding.map((e) =>
    kind === "relationship" ? `${e.label}:${e.relationship}` : `${e.label}:${e.lag! > 0 ? "+" : ""}${e.lag} 天`
  );
  return `以下前置有自己的${kind === "relationship" ? "關係型別" : " Lag"},不看這一欄:\n${lines.join("\n")}`;
}
