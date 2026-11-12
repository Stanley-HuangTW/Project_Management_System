"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { UserError } from "@/lib/userError";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { canManageStructure } from "@/lib/permissions";
import { listApprovalQueue } from "@/lib/actions/approval";

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

/**
 * 等你審核的件數(工時、請假,加上出口條件、閘門、風險議題、變更單):側邊欄「待我審核」旁與鈴鐺上的提示用。
 * 跟待我審核頁列的是同一份,所以兩邊數字一致。
 */
export async function getPendingApprovalCount(): Promise<number> {
  const [queue, extras] = await Promise.all([listApprovalQueue(), listApprovalExtras()]);
  return (
    queue.timeEntries.length +
    queue.activityEntries.length +
    queue.leaves.length +
    extras.criteria.length +
    extras.gates.length +
    extras.risks.length +
    extras.changes.length
  );
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
  /** 誰處理的(稽核軌跡的「審核結果」看所有人的時候要顯示)。 */
  deciderId: string | null;
  deciderName: string | null;
};

const HISTORY_LIMIT = 80;
const ALL_DECISIONS_LIMIT = 200;

type DecisionScope = {
  /** 限定哪個人處理的;null = 不限。 */
  deciderId: string | null;
  boardId: string | null;
  /** "YYYY-MM-DD",含當天。 */
  from: string | null;
  to: string | null;
  limit: number;
};

/**
 * 核准、退回、同意、不同意過的簽核,最近的在前面。
 * viewerId 是現在操作的人:閘門與出口條件的簽核只有簽核人本人能改,所以別人處理的那幾列不能改判。
 */
async function loadDecisions(scope: DecisionScope, viewerId: string): Promise<ApprovalHistoryRow[]> {
  const take = scope.limit;
  const by = scope.deciderId ?? { not: null };
  const range =
    scope.from || scope.to
      ? {
          ...(scope.from ? { gte: new Date(`${scope.from}T00:00:00.000Z`) } : {}),
          ...(scope.to ? { lte: new Date(`${scope.to}T23:59:59.999Z`) } : {}),
        }
      : null;
  const decidedAt = range ? { decidedAt: range } : {};
  const board = scope.boardId;

  const [leaves, times, activities, criteria, gates, risks, changes] = await Promise.all([
    prisma.leave.findMany({
      // 請假不屬於任何看板:篩了看板就不該有請假。
      where: { decidedById: by, status: { in: ["APPROVED", "REJECTED"] }, ...decidedAt, ...(board ? { id: { in: [] } } : {}) },
      orderBy: { decidedAt: "desc" },
      take,
      include: { user: { select: { name: true } } },
    }),
    prisma.timeEntry.findMany({
      where: { decidedById: by, status: { in: ["APPROVED", "REJECTED"] }, ...decidedAt, ...(board ? { item: { boardId: board } } : {}) },
      orderBy: { decidedAt: "desc" },
      take,
      include: { user: { select: { name: true } }, item: { select: { name: true, boardId: true } } },
    }),
    prisma.activityTimeEntry.findMany({
      where: { decidedById: by, status: { in: ["APPROVED", "REJECTED"] }, ...decidedAt, ...(board ? { boardId: board } : {}) },
      orderBy: { decidedAt: "desc" },
      take,
      include: { user: { select: { name: true } }, category: { select: { name: true } } },
    }),
    prisma.gateCriterionApprover.findMany({
      where: {
        ...(scope.deciderId ? { userId: scope.deciderId } : {}),
        decision: { not: null },
        ...decidedAt,
        ...(board ? { criterion: { gate: { boardId: board } } } : {}),
      },
      orderBy: { decidedAt: "desc" },
      take,
      include: {
        user: { select: { name: true } },
        criterion: { select: { id: true, text: true, gate: { select: { name: true, status: true, boardId: true } } } },
      },
    }),
    prisma.gateApprover.findMany({
      where: {
        ...(scope.deciderId ? { userId: scope.deciderId } : {}),
        decision: { not: null },
        ...decidedAt,
        ...(board ? { gate: { boardId: board } } : {}),
      },
      orderBy: { decidedAt: "desc" },
      take,
      include: { user: { select: { name: true } }, gate: { select: { id: true, name: true, status: true, boardId: true } } },
    }),
    prisma.riskReviewer.findMany({
      where: {
        ...(scope.deciderId ? { userId: scope.deciderId } : {}),
        approvedAt: { not: null, ...(range ?? {}) },
        ...(board ? { risk: { boardId: board } } : {}),
      },
      orderBy: { approvedAt: "desc" },
      take,
      include: { user: { select: { name: true } }, risk: { select: { id: true, title: true, kind: true, status: true, boardId: true } } },
    }),
    prisma.changeRequest.findMany({
      where: { decidedById: by, status: { in: ["APPROVED", "REJECTED", "IMPLEMENTED"] }, ...decidedAt, ...(board ? { boardId: board } : {}) },
      orderBy: { decidedAt: "desc" },
      take,
      select: { id: true, number: true, title: true, status: true, decidedAt: true, decisionNote: true, boardId: true, decidedById: true },
    }),
  ]);

  // 請假、工時、變更單的處理人只存了 id:一次查回名字。
  const deciderIds = [
    ...new Set(
      [...leaves, ...times, ...activities, ...changes].map((r) => r.decidedById).filter((id): id is string => !!id)
    ),
  ];
  const deciderNames = new Map(
    (deciderIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: deciderIds } }, select: { id: true, name: true } }) : []).map(
      (u) => [u.id, u.name]
    )
  );
  const decider = (id: string | null) => ({ deciderId: id, deciderName: id ? (deciderNames.get(id) ?? null) : null });

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
      ...decider(l.decidedById),
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
      ...decider(t.decidedById),
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
      ...decider(a.decidedById),
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
      // 簽核只有簽核人本人能改(signCriterion 檢查的是「現在操作的人」是不是確認人)。
      canRevise: c.userId === viewerId && c.criterion.gate.status !== "PASSED" && c.criterion.gate.status !== "WAIVED",
      boardId: c.criterion.gate.boardId,
      deciderId: c.userId,
      deciderName: c.user.name,
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
      canRevise: g.userId === viewerId && g.gate.status === "PENDING",
      boardId: g.gate.boardId,
      deciderId: g.userId,
      deciderName: g.user.name,
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
      deciderId: r.userId,
      deciderName: r.user.name,
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
      ...decider(c.decidedById),
    });
  }

  return rows.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt)).slice(0, scope.limit);
}

/** 我處理過的簽核(核准、退回、同意、不同意),最近的在前面,可以回溯,有的還能改判。 */
export async function listApprovalHistory(): Promise<ApprovalHistoryRow[]> {
  const session = await requireSession();
  return loadDecisions({ deciderId: session.userId, boardId: null, from: null, to: null, limit: HISTORY_LIMIT }, session.userId);
}

/**
 * 稽核軌跡頁的「審核結果」:管理者看所有人的審核結果(可以篩看板、處理的人、日期),
 * 工時與請假不管誰處理的,管理者都能改判;閘門與出口條件只有簽核人本人能改,別人的只能看。
 */
export async function listAllApprovalDecisions(filter: {
  boardId?: string | null;
  deciderId?: string | null;
  from?: string | null;
  to?: string | null;
}): Promise<ApprovalHistoryRow[]> {
  const session = await requireSession();
  if (session.role !== "ADMIN") throw new UserError("權限不足:僅管理者可以檢視所有人的審核結果");
  return loadDecisions(
    {
      deciderId: filter.deciderId || null,
      boardId: filter.boardId || null,
      from: filter.from || null,
      to: filter.to || null,
      limit: ALL_DECISIONS_LIMIT,
    },
    session.userId
  );
}
