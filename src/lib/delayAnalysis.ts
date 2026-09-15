/**
 * 延遲追因 — which task actually caused the slip.
 *
 * Almost every task on a delayed project is late, and almost none of them
 * are to blame: they were pushed. The one worth talking about is the task
 * that moved further than its predecessors moved it, or that took longer
 * than it said it would. Everything downstream of that is arithmetic.
 */

const DAY_MS = 86_400_000;

export type DelayEdge = {
  predId: string;
  /** Which end of the predecessor drives this task: FS/FF follow its finish,
   *  SS/SF its start. */
  uses: "start" | "end";
};

export type DelayInput = {
  id: string;
  name: string;
  wbsCode: string;
  /** 它在哪個看板 —— 專案群組的追因橫跨好幾個看板,連結需要它。 */
  boardId: string;
  /** The saved plan. Null for anything the baseline never covered — a task
   *  added after the plan was made cannot have slipped from it. */
  baselineStart: Date | null;
  baselineEnd: Date | null;
  baselineDays: number | null;
  currentStart: Date | null;
  currentEnd: Date | null;
  currentDays: number | null;
  preds: DelayEdge[];
};

export type DelayCulprit = {
  id: string;
  name: string;
  wbsCode: string;
  boardId: string;
  /** Calendar days later than planned. */
  startDelta: number;
  endDelta: number;
  /** Working days added to the task itself. */
  daysDelta: number;
  /** How much of its slip the chain handed it. */
  inheritedDelay: number;
  /** How much it slipped beyond that — the part that is its own. */
  ownDelay: number;
  /** Tasks downstream of it, transitively: how far the blame spreads. */
  downstreamCount: number;
};

export type DelayAnalysis = {
  /** The worst finish slip anywhere on the board, in calendar days. */
  projectDelay: number;
  /** Tasks that slipped on their own, worst first. */
  culprits: DelayCulprit[];
  /** True when nothing carries a baseline — there is nothing to compare. */
  noBaseline: boolean;
};

function dayDelta(from: Date | null, to: Date | null): number {
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Splits every task's slip into the part it inherited and the part it owns.
 *
 * The inherited part is whatever its worst predecessor moved by — with
 * several predecessors the binding one is the latest, exactly as the
 * scheduler treats them. What is left over is the task's own: it started
 * later than it was pushed to, or it ran longer than planned.
 */
export function analyzeDelays(items: DelayInput[], scopeIds?: Set<string>): DelayAnalysis {
  const byId = new Map(items.map((item) => [item.id, item]));
  // Everything takes part in the maths; only what is in scope is reported.
  // A board inside a 專案群組 is analysed against the whole group — otherwise
  // a predecessor on a sibling board is simply missing, and the slip it handed
  // down gets counted as the successor's own delay, naming the wrong task.
  // What is NAMED stays that board's own work.
  const inScope = (id: string) => !scopeIds || scopeIds.has(id);
  const withBaseline = items.filter((item) => item.baselineStart && item.baselineEnd);
  const reportable = withBaseline.filter((item) => inScope(item.id));
  if (reportable.length === 0) {
    return { projectDelay: 0, culprits: [], noBaseline: true };
  }

  const startDeltas = new Map<string, number>();
  const endDeltas = new Map<string, number>();
  for (const item of items) {
    startDeltas.set(item.id, dayDelta(item.baselineStart, item.currentStart));
    endDeltas.set(item.id, dayDelta(item.baselineEnd, item.currentEnd));
  }

  // predecessor -> everything that waits on it, for counting how far a slip
  // spread.
  const successorsOf = new Map<string, string[]>();
  for (const item of items) {
    for (const edge of item.preds) {
      if (!byId.has(edge.predId)) continue;
      successorsOf.set(edge.predId, [...(successorsOf.get(edge.predId) ?? []), item.id]);
    }
  }

  function countDownstream(id: string): number {
    const seen = new Set<string>();
    const queue = [...(successorsOf.get(id) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(...(successorsOf.get(next) ?? []));
    }
    return seen.size;
  }

  const culprits: DelayCulprit[] = [];
  for (const item of reportable) {
    const startDelta = startDeltas.get(item.id) ?? 0;
    const endDelta = endDeltas.get(item.id) ?? 0;
    const daysDelta =
      item.currentDays !== null && item.baselineDays !== null ? item.currentDays - item.baselineDays : 0;

    const inheritedDelay = item.preds.reduce((worst, edge) => {
      const pred = byId.get(edge.predId);
      if (!pred || !pred.baselineStart) return worst;
      const delta = edge.uses === "start" ? (startDeltas.get(edge.predId) ?? 0) : (endDeltas.get(edge.predId) ?? 0);
      return Math.max(worst, delta);
    }, 0);

    // What it did to itself: moved further than it was pushed, or grew.
    const ownDelay = Math.max(0, startDelta - Math.max(0, inheritedDelay)) + Math.max(0, daysDelta);
    if (ownDelay <= 0) continue;

    culprits.push({
      id: item.id,
      name: item.name,
      wbsCode: item.wbsCode,
      boardId: item.boardId,
      startDelta,
      endDelta,
      daysDelta,
      inheritedDelay: Math.max(0, inheritedDelay),
      ownDelay,
      downstreamCount: countDownstream(item.id),
    });
  }

  // Worst first, and where two slipped the same, the one that dragged more
  // of the project with it.
  culprits.sort((a, b) => b.ownDelay - a.ownDelay || b.downstreamCount - a.downstreamCount);

  const projectDelay = Math.max(0, ...reportable.map((item) => endDeltas.get(item.id) ?? 0));
  return { projectDelay, culprits, noBaseline: false };
}
