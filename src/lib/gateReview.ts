import type { GateStatus, GateDecision } from "@prisma/client";

/**
 * 階段閘門 — the rules about when a gate may be called passed, and who is
 * already through it without waiting.
 *
 * Kept apart from the database so both halves are testable: whether a gate
 * CAN pass is a rule about its criteria and its signatures, not about SQL.
 */

export type CriterionState = { required: boolean; met: boolean };
export type ApproverState = { decision: GateDecision | null };

export type GateReadiness = {
  /** Required criteria met, out of how many there are. */
  metRequired: number;
  totalRequired: number;
  /** Optional criteria are counted but never block. */
  metOptional: number;
  totalOptional: number;
  approved: number;
  totalApprovers: number;
  rejected: number;
  /** Every required criterion met and every approver has approved — the only
   *  state in which PASSED is an honest description. */
  canPass: boolean;
  /** What is still missing, phrased for the person looking at the button. */
  blockers: string[];
};

export function assessGate(
  criteria: CriterionState[],
  approvers: ApproverState[]
): GateReadiness {
  const required = criteria.filter((c) => c.required);
  const optional = criteria.filter((c) => !c.required);
  const metRequired = required.filter((c) => c.met).length;
  const approved = approvers.filter((a) => a.decision === "APPROVED").length;
  const rejected = approvers.filter((a) => a.decision === "REJECTED").length;

  const blockers: string[] = [];
  if (metRequired < required.length) {
    blockers.push(`還有 ${required.length - metRequired} 項必要條件未達成`);
  }
  if (rejected > 0) blockers.push(`有 ${rejected} 位簽核人不同意`);
  const pending = approvers.length - approved - rejected;
  if (pending > 0) blockers.push(`還有 ${pending} 位簽核人未表態`);
  // A gate nobody has to sign is a checklist, not a review. Said out loud
  // rather than quietly allowed: somebody forgot to add the approvers.
  if (approvers.length === 0) blockers.push("尚未指定簽核人");

  return {
    metRequired,
    totalRequired: required.length,
    metOptional: optional.filter((c) => c.met).length,
    totalOptional: optional.length,
    approved,
    totalApprovers: approvers.length,
    rejected,
    canPass: blockers.length === 0,
    blockers,
  };
}

/** A gate that is done with, either way — downstream work is legitimate. */
export function isCleared(status: GateStatus): boolean {
  return status === "PASSED" || status === "WAIVED";
}

export type GatePhaseItem = {
  id: string;
  name: string;
  parentId: string | null;
  groupId: string;
  order: number;
  /** 0-100 where the board scores progress; null where it does not. */
  progressPct: number | null;
  /** "YYYY-MM-DD" — the planned start, used only when there is no progress
   *  column to read. */
  startDate: string | null;
};

export type GateBreach = {
  gateId: string;
  gateName: string;
  gateStatus: GateStatus;
  nextPhaseId: string;
  nextPhaseName: string;
  /** Tasks in the next phase that are already underway. */
  startedNames: string[];
  startedCount: number;
};

function descendantsOf(id: string, items: GatePhaseItem[]): GatePhaseItem[] {
  const out: GatePhaseItem[] = [];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const item of items) {
      if (item.parentId !== parent || seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      queue.push(item.id);
    }
  }
  return out;
}

/** Underway: somebody has actually moved it, or — where the board keeps no
 *  progress column — its planned start has already come and gone. */
function hasStarted(item: GatePhaseItem, today: string): boolean {
  if (item.progressPct !== null) return item.progressPct > 0;
  return item.startDate !== null && item.startDate <= today;
}

/**
 * 闖關 — the next phase is already being worked while this gate has not been
 * cleared.
 *
 * This is the whole reason gates are worth recording. The system does not
 * stop anyone from starting PVT work before the EVT gate passes — blocking
 * edits in a tool people use all day just teaches them to delete the gate —
 * so instead it says plainly who has gone ahead, and the review has something
 * concrete to be about.
 *
 * The next phase is the gate's phase's next sibling: phases sit in order
 * under the same parent, which is what "next" means on a board.
 */
export function findGateBreaches(
  gates: { id: string; name: string; itemId: string | null; status: GateStatus }[],
  items: GatePhaseItem[],
  today: string
): GateBreach[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const breaches: GateBreach[] = [];

  for (const gate of gates) {
    if (!gate.itemId || isCleared(gate.status)) continue;
    const phase = byId.get(gate.itemId);
    if (!phase) continue;

    const next = items
      .filter(
        (i) => i.groupId === phase.groupId && i.parentId === phase.parentId && i.order > phase.order
      )
      .sort((a, b) => a.order - b.order)[0];
    if (!next) continue;

    const started = [next, ...descendantsOf(next.id, items)].filter((i) => hasStarted(i, today));
    if (started.length === 0) continue;

    breaches.push({
      gateId: gate.id,
      gateName: gate.name,
      gateStatus: gate.status,
      nextPhaseId: next.id,
      nextPhaseName: next.name,
      startedNames: started.slice(0, 5).map((i) => i.name),
      startedCount: started.length,
    });
  }

  return breaches;
}
