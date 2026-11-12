"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { canManageStructure } from "@/lib/permissions";

/**
 * 「待我審核」除了工時與請假,還有:出口條件要我確認、閘門要我簽核、風險 / 議題要我審核結案、變更單等我核准。
 * 工時與請假在 approval.ts(規則比較多);這裡是其餘的「等我表態」的東西,以及「已處理」的紀錄。
 * 只列這個人看得到的看板上的。
 */

export type PendingCriterion = {
  id: string;
  text: string;
  gateName: string;
  boardId: string;
  boardName: string;
};

export type PendingGateSignoff = {
  gateId: string;
  gateName: string;
  boardId: string;
  boardName: string;
  /** 必要條件達成幾條 / 共幾條。 */
  progress: string;
};

export type PendingRiskReview = {
  id: string;
  title: string;
  kindLabel: string;
  boardId: string;
  boardName: string;
  ownerName: string | null;
};

export type PendingChange = {
  id: string;
  label: string;
  title: string;
  boardId: string;
  boardName: string;
  requestedByName: string | null;
};

export type ApprovalExtras = {
  criteria: PendingCriterion[];
  gates: PendingGateSignoff[];
  risks: PendingRiskReview[];
  changes: PendingChange[];
};

export async function listApprovalExtras(): Promise<ApprovalExtras> {
  const session = await requireSession();
  const boardScope = { board: accessibleBoardWhere(session) };

  const [criteria, gateSignoffs, risks, changes] = await Promise.all([
    prisma.gateCriterionApprover.findMany({
      where: {
        userId: session.userId,
        decision: null,
        criterion: { gate: { status: { notIn: ["PASSED", "WAIVED"] }, ...boardScope } },
      },
      orderBy: { id: "asc" },
      select: {
        criterion: {
          select: { id: true, text: true, gate: { select: { name: true, board: { select: { id: true, name: true } } } } },
        },
      },
    }),
    prisma.gateApprover.findMany({
      where: { userId: session.userId, decision: null, gate: { status: "PENDING", ...boardScope } },
      select: {
        gate: {
          select: {
            id: true,
            name: true,
            board: { select: { id: true, name: true } },
            criteria: { select: { required: true, met: true } },
          },
        },
      },
    }),
    prisma.riskReviewer.findMany({
      where: { userId: session.userId, approvedAt: null, risk: { status: "PENDING_REVIEW", ...boardScope } },
      select: {
        risk: {
          select: { id: true, title: true, kind: true, board: { select: { id: true, name: true } }, owner: { select: { name: true } } },
        },
      },
    }),
    canManageStructure(session.role)
      ? prisma.changeRequest.findMany({
          where: { status: "SUBMITTED", ...boardScope },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            number: true,
            title: true,
            board: { select: { id: true, name: true } },
            requestedBy: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return {
    criteria: criteria.map((c) => ({
      id: c.criterion.id,
      text: c.criterion.text,
      gateName: c.criterion.gate.name,
      boardId: c.criterion.gate.board.id,
      boardName: c.criterion.gate.board.name,
    })),
    gates: gateSignoffs.map((g) => {
      const required = g.gate.criteria.filter((c) => c.required);
      return {
        gateId: g.gate.id,
        gateName: g.gate.name,
        boardId: g.gate.board.id,
        boardName: g.gate.board.name,
        progress: `${required.filter((c) => c.met).length}/${required.length}`,
      };
    }),
    risks: risks.map((r) => ({
      id: r.risk.id,
      title: r.risk.title,
      kindLabel: r.risk.kind === "ISSUE" ? "議題" : "風險",
      boardId: r.risk.board.id,
      boardName: r.risk.board.name,
      ownerName: r.risk.owner?.name ?? null,
    })),
    changes: changes.map((c) => ({
      id: c.id,
      label: `CR-${String(c.number).padStart(3, "0")}`,
      title: c.title,
      boardId: c.board.id,
      boardName: c.board.name,
      requestedByName: c.requestedBy?.name ?? null,
    })),
  };
}

export type ApprovalHistoryKind = "leave" | "time" | "activity" | "criterion" | "gate" | "risk" | "change";

export type ApprovalHistoryRow = {
  /** kind + id 合起來是唯一的。 */
  kind: ApprovalHistoryKind;
  id: string;
  /** 一句話說這是什麼(誰的什麼)。 */
  title: string;
  detail: string;
  decision: "APPROVED" | "REJECTED";
  decidedAt: string;
  note: string | null;
  /** 還能不能改判(已經放行的閘門、已結案的風險、已核准的變更單等不能)。 */
  canRevise: boolean;
  /** 改判之後要去哪個看板(給「到看板」連結);沒有就是 null。 */
  boardId: string | null;
};

const HISTORY_LIMIT = 80;

/** 我處理過的簽核(核准、退回、同意、不同意),最近的在前面,可以回溯,有的還能改判。 */
export async function listApprovalHistory(): Promise<ApprovalHistoryRow[]> {
  const session = await requireSession();
  const me = session.userId;

  const [leaves, times, activities, criteria, gates, risks, changes] = await Promise.all([
    prisma.leave.findMany({
      where: { decidedById: me, status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      include: { user: { select: { name: true } } },
    }),
    prisma.timeEntry.findMany({
      where: { decidedById: me, status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      include: { user: { select: { name: true } }, item: { select: { name: true, boardId: true } } },
    }),
    prisma.activityTimeEntry.findMany({
      where: { decidedById: me, status: { in: ["APPROVED", "REJECTED"] } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      include: { user: { select: { name: true } }, category: { select: { name: true } } },
    }),
    prisma.gateCriterionApprover.findMany({
      where: { userId: me, decision: { not: null } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      include: { criterion: { select: { id: true, text: true, gate: { select: { name: true, status: true, boardId: true } } } } },
    }),
    prisma.gateApprover.findMany({
      where: { userId: me, decision: { not: null } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      include: { gate: { select: { id: true, name: true, status: true, boardId: true } } },
    }),
    prisma.riskReviewer.findMany({
      where: { userId: me, approvedAt: { not: null } },
      orderBy: { approvedAt: "desc" },
      take: HISTORY_LIMIT,
      include: { risk: { select: { id: true, title: true, kind: true, status: true, boardId: true } } },
    }),
    prisma.changeRequest.findMany({
      where: { decidedById: me, status: { in: ["APPROVED", "REJECTED", "IMPLEMENTED"] } },
      orderBy: { decidedAt: "desc" },
      take: HISTORY_LIMIT,
      select: { id: true, number: true, title: true, status: true, decidedAt: true, decisionNote: true, boardId: true },
    }),
  ]);

  const rows: ApprovalHistoryRow[] = [];
  for (const l of leaves) {
    rows.push({
      kind: "leave",
      id: l.id,
      title: `${l.user.name} 請假 ${l.startDate}~${l.endDate}`,
      detail: l.reason ?? "",
      decision: l.status === "APPROVED" ? "APPROVED" : "REJECTED",
      decidedAt: (l.decidedAt ?? l.createdAt).toISOString(),
      note: l.decisionNote,
      canRevise: true,
      boardId: null,
    });
  }
  for (const t of times) {
    rows.push({
      kind: "time",
      id: t.id,
      title: `${t.user.name} ${t.date} 工時 ${Number(t.hours)}h`,
      detail: t.item.name,
      decision: t.status === "APPROVED" ? "APPROVED" : "REJECTED",
      decidedAt: (t.decidedAt ?? t.createdAt).toISOString(),
      note: t.decisionNote,
      canRevise: true,
      boardId: t.item.boardId,
    });
  }
  for (const a of activities) {
    rows.push({
      kind: "activity",
      id: a.id,
      title: `${a.user.name} ${a.date} 工時 ${Number(a.hours)}h`,
      detail: a.category.name,
      decision: a.status === "APPROVED" ? "APPROVED" : "REJECTED",
      decidedAt: (a.decidedAt ?? a.createdAt).toISOString(),
      note: a.decisionNote,
      canRevise: true,
      boardId: a.boardId,
    });
  }
  for (const c of criteria) {
    rows.push({
      kind: "criterion",
      id: c.criterion.id,
      title: `閘門「${c.criterion.gate.name}」的出口條件`,
      detail: c.criterion.text,
      decision: c.decision === "APPROVED" ? "APPROVED" : "REJECTED",
      decidedAt: (c.decidedAt ?? new Date(0)).toISOString(),
      note: c.comment,
      canRevise: c.criterion.gate.status !== "PASSED" && c.criterion.gate.status !== "WAIVED",
      boardId: c.criterion.gate.boardId,
    });
  }
  for (const g of gates) {
    rows.push({
      kind: "gate",
      id: g.gate.id,
      title: `閘門「${g.gate.name}」簽核`,
      detail: "",
      decision: g.decision === "APPROVED" ? "APPROVED" : "REJECTED",
      decidedAt: (g.decidedAt ?? new Date(0)).toISOString(),
      note: g.comment,
      canRevise: g.gate.status === "PENDING",
      boardId: g.gate.boardId,
    });
  }
  for (const r of risks) {
    rows.push({
      kind: "risk",
      id: r.risk.id,
      title: `${r.risk.kind === "ISSUE" ? "議題" : "風險"}「${r.risk.title}」結案審核`,
      detail: "",
      decision: "APPROVED",
      decidedAt: (r.approvedAt ?? new Date(0)).toISOString(),
      note: null,
      canRevise: false,
      boardId: r.risk.boardId,
    });
  }
  for (const c of changes) {
    rows.push({
      kind: "change",
      id: c.id,
      title: `變更單 CR-${String(c.number).padStart(3, "0")}「${c.title}」`,
      detail: "",
      decision: c.status === "REJECTED" ? "REJECTED" : "APPROVED",
      decidedAt: (c.decidedAt ?? new Date(0)).toISOString(),
      note: c.decisionNote,
      canRevise: false,
      boardId: c.boardId,
    });
  }

  return rows.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, HISTORY_LIMIT);
}
