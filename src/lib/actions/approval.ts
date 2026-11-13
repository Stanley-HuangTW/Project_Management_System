"use server";

import { revalidatePath } from "next/cache";
import type { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { logAudit } from "@/lib/activityLog";
import { groupIdsOfBoards, resolveApprovers, type ApprovalSubject, type ApproverInfo } from "@/lib/timesheetApproval";
import type { ApprovalTarget } from "@/lib/approvalSelection";
import { clampLevels, levelLabel, levelsOf, levelToSign, managerChain, type Delegations } from "@/lib/approvalLevels";
import {
  approvalNotes,
  getApprovalLevelSettings,
  loadApprovalSteps,
  loadDelegations,
  loadSupervisorGraph,
  recordSupervisorApproval,
} from "@/lib/approvalLevelsServer";
import { UserError } from "@/lib/userError";
import { notifyApprovalDecided } from "@/lib/approvalNotify";
import { withWeekday } from "@/lib/weekdayLabel";

export type PendingTimeEntry = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  note: string;
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  /** 要多階主管同意時的進度(誰簽了、還缺誰);只有要多階的才有。 */
  approvalNote?: string;
};

/** 對應專案的非專案工時(會議、出差交通…)——跟專案工時一樣要核准才計入專案成本。 */
export type PendingActivityEntry = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  hours: number;
  note: string;
  categoryName: string;
  boardId: string;
  boardName: string;
  approvalNote?: string;
};

export type PendingLeave = {
  id: string;
  userId: string;
  userName: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  approvalNote?: string;
};

export type ApprovalQueue = {
  timeEntries: PendingTimeEntry[];
  activityEntries: PendingActivityEntry[];
  leaves: PendingLeave[];
  /** Whether this person has anybody to approve for at all — used to decide
   *  whether the page is worth showing them. */
  isApprover: boolean;
};

/**
 * 請假:這個人能核准誰。
 *
 * A supervisor approves their own reports; an ADMIN approves anyone, which is
 * what keeps the queue from stalling when somebody's supervisor is the person
 * on leave. Nobody approves their own — a timesheet that approves itself is
 * the same timesheet.
 */
async function approvableUserIds(session: SessionPayload, levels: number, delegations: Delegations): Promise<string[]> {
  if (session.role === "ADMIN") {
    const all = await prisma.user.findMany({ select: { id: true } });
    return all.map((u) => u.id).filter((id) => id !== session.userId);
  }
  // 主管的「部屬」包含需要簽核的那幾階:設定要二階主管同意,二階主管也要看得到隔階部屬送來的。
  const users = await loadSupervisorGraph();
  const cap = clampLevels(levels);
  return users
    .filter((u) => u.id !== session.userId && levelsOf(managerChain(users, u.id, cap), session.userId, delegations).length > 0)
    .map((u) => u.id);
}

function countDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

const APPROVER_ROLES = ["TEAM_LEADER", "PMD", "SW_DM", "HW_DM", "ME_DM", "QA", "PM_DM"] as const;

/** 這個人在哪些分組掛了可以核准工時的角色(Team Leader / PMD / 各部門 DM)。 */
async function myApproverGroupIds(userId: string): Promise<string[]> {
  const rows = await prisma.groupRoleAssignment.findMany({
    where: { userId, role: { in: [...APPROVER_ROLES] } },
    select: { groupId: true },
  });
  return [...new Set(rows.map((r) => r.groupId))];
}

export async function listApprovalQueue(): Promise<ApprovalQueue> {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";
  const [levelSettings, delegations] = await Promise.all([getApprovalLevelSettings(), loadDelegations()]);
  const [reportIds, leaveReportIds, groupIds] = await Promise.all([
    approvableUserIds(session, levelSettings.timesheet, delegations),
    approvableUserIds(session, levelSettings.leave, delegations),
    isAdmin ? Promise.resolve([] as string[]) : myApproverGroupIds(session.userId),
  ]);
  if (reportIds.length === 0 && leaveReportIds.length === 0 && groupIds.length === 0) {
    return { timeEntries: [], activityEntries: [], leaves: [], isApprover: false };
  }

  // 候選:管理者看全部;其他人看「直屬部屬」或「自己有核准角色的分組」裡的待審工時,
  // 再用同一套規則(含 DM 只能核准同部門)逐筆確認。
  const entryScope = isAdmin
    ? {}
    : { OR: [{ userId: { in: reportIds } }, { item: { groupId: { in: groupIds } } }] };
  const activityScope = isAdmin
    ? {}
    : { OR: [{ userId: { in: reportIds } }, { board: { is: { groups: { some: { id: { in: groupIds } } } } } }] };

  const [entries, activity, leaves] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { status: "PENDING", userId: { not: session.userId }, item: { deletedAt: null }, ...entryScope },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { name: true } },
        item: { select: { id: true, name: true, groupId: true, board: { select: { id: true, name: true } } } },
      },
    }),
    prisma.activityTimeEntry.findMany({
      where: {
        status: "PENDING",
        userId: { not: session.userId },
        boardId: { not: null },
        board: { is: { deletedAt: null } },
        ...activityScope,
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { name: true } },
        category: { select: { name: true } },
        board: { select: { id: true, name: true } },
      },
    }),
    leaveReportIds.length > 0
      ? prisma.leave.findMany({
          where: { status: "PENDING", userId: { in: leaveReportIds } },
          orderBy: { startDate: "asc" },
          include: { user: { select: { name: true } } },
        })
      : Promise.resolve([]),
  ]);

  // 逐筆確認這個人真的是核准人。
  const boardGroups = await groupIdsOfBoards([...new Set(activity.map((a) => a.boardId!))]);
  const subjects: ApprovalSubject[] = [
    ...entries.map((e) => ({ key: `t:${e.id}`, userId: e.userId, groupIds: [e.item.groupId] })),
    ...activity.map((e) => ({ key: `a:${e.id}`, userId: e.userId, groupIds: boardGroups.get(e.boardId!) ?? [] })),
  ];
  const approvers = await resolveApprovers(subjects);
  const [timeSteps, activitySteps, leaveSteps, graph] = await Promise.all([
    loadApprovalSteps("TIME", entries.map((e) => e.id)),
    loadApprovalSteps("ACTIVITY", activity.map((e) => e.id)),
    loadApprovalSteps("LEAVE", leaves.map((l) => l.id)),
    loadSupervisorGraph(),
  ]);
  const mineOf = (key: string): ApproverInfo | undefined => approvers.get(key)?.find((a) => a.userId === session.userId);
  /** 以「主管」身分核准的,自己那一階已經簽過就不用再看到(要等其他階)。 */
  const mayDecide = (key: string, steps: { level: number }[] | undefined) => {
    const me = mineOf(key);
    if (!me) return false;
    return !(me.reason === "SUPERVISOR" && me.level && steps?.some((step) => step.level === me.level));
  };
  const supervisorOnly = (key: string) => mineOf(key)?.reason === "SUPERVISOR";
  const [timeNotes, activityNotes, leaveNotes] = await Promise.all([
    approvalNotes({
      kind: "TIME",
      items: entries.filter((e) => supervisorOnly(`t:${e.id}`)).map((e) => ({ targetId: e.id, submitterId: e.userId })),
      configured: levelSettings.timesheet,
      viewerId: session.userId,
    }),
    approvalNotes({
      kind: "ACTIVITY",
      items: activity.filter((e) => supervisorOnly(`a:${e.id}`)).map((e) => ({ targetId: e.id, submitterId: e.userId })),
      configured: levelSettings.timesheet,
      viewerId: session.userId,
    }),
    approvalNotes({
      kind: "LEAVE",
      items: leaves.map((l) => ({ targetId: l.id, submitterId: l.userId })),
      configured: levelSettings.leave,
      viewerId: session.userId,
    }),
  ]);
  // 請假:管理者看全部;其他人要輪得到簽(在送審者的主管鏈上、需要的階內、自己那一階還沒簽)。
  const leavesForMe = isAdmin
    ? leaves
    : leaves.filter((leave) =>
        levelToSign(managerChain(graph, leave.userId), levelSettings.leave, leaveSteps.get(leave.id) ?? [], session.userId, delegations) !== null
      );

  return {
    isApprover: true,
    timeEntries: entries
      .filter((entry) => mayDecide(`t:${entry.id}`, timeSteps.get(entry.id)))
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        userName: entry.user.name,
        date: entry.date,
        hours: Number(entry.hours),
        note: entry.note ?? "",
        itemId: entry.item.id,
        itemName: entry.item.name,
        boardId: entry.item.board.id,
        boardName: entry.item.board.name,
        approvalNote: timeNotes.get(entry.id),
      })),
    activityEntries: activity
      .filter((entry) => mayDecide(`a:${entry.id}`, activitySteps.get(entry.id)))
      .map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        userName: entry.user.name,
        date: entry.date,
        hours: Number(entry.hours),
        note: entry.note ?? "",
        categoryName: entry.category.name,
        boardId: entry.board!.id,
        boardName: entry.board!.name,
        approvalNote: activityNotes.get(entry.id),
      })),
    leaves: leavesForMe.map((leave) => ({
      id: leave.id,
      userId: leave.userId,
      userName: leave.user.name,
      startDate: leave.startDate,
      endDate: leave.endDate,
      days: countDays(leave.startDate, leave.endDate),
      reason: leave.reason ?? "",
      approvalNote: leaveNotes.get(leave.id),
    })),
  };
}

/**
 * 這個人能不能核准這筆工時,以什麼身分(寫進稽核紀錄:誰核准的、憑什麼身分核准的)。
 * 回傳身分的文字;不能核准就丟錯。
 */
async function assertMayDecideEntry(session: SessionPayload, subject: ApprovalSubject): Promise<ApproverInfo> {
  if (subject.userId === session.userId) throw new UserError("不能審核自己送出的紀錄");
  const approvers = (await resolveApprovers([subject])).get(subject.key) ?? [];
  const me = approvers.find((a) => a.userId === session.userId);
  if (!me) throw new UserError("權限不足:只有該專案分組的 Team Leader / PMD、同部門的 DM、直屬主管或管理者可以核准這筆工時");
  return me;
}

/** 稽核紀錄與提示裡的身分:主管顯示第幾階,副主管代簽加註。 */
function capacityOf(me: ApproverInfo): string {
  return me.reason === "SUPERVISOR" && me.level ? `${levelLabel(me.level)}${me.deputy ? "(代簽)" : ""}` : me.reasonLabel;
}

/**
 * 以「主管」身分核准工時:設定要多階的話,這一階簽了還要等其他階,各階都簽齊才算核准。
 * 其他身分(Team Leader、PMD、DM、管理者)單獨核准就算數,退回任何一位核准人都可以。
 * 回傳 complete:false 代表只記下了這一階,工時還在等其他階。
 */
async function applyTimeApproval(
  kind: "TIME" | "ACTIVITY",
  entryId: string,
  submitterId: string,
  me: ApproverInfo,
  userId: string
): Promise<{ error?: string; complete: boolean; note: string | null }> {
  if (me.reason !== "SUPERVISOR") return { complete: true, note: null };
  const settings = await getApprovalLevelSettings();
  return recordSupervisorApproval({ kind, targetId: entryId, submitterId, approverId: userId, configured: settings.timesheet });
}

/**
 * 核准或退回一筆工時.
 *
 * Approving is what makes the hours real: until then they are outside the
 * board's actual cost entirely, so a CPI does not move because somebody typed
 * a number — it moves because somebody who is accountable for the project
 * agreed with it. Who agreed, and in what capacity, is written down.
 */
export async function decideTimeEntry(
  entryId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    include: {
      user: { select: { name: true } },
      item: { select: { name: true, boardId: true, groupId: true } },
    },
  });
  if (!entry) return { error: "找不到這筆工時" };
  let me: ApproverInfo;
  try {
    me = await assertMayDecideEntry(session, { key: "t", userId: entry.userId, groupIds: [entry.item.groupId] });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "權限不足" };
  }
  const capacity = capacityOf(me);

  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "退回必須寫下原因" };

  if (status === "APPROVED") {
    const step = await applyTimeApproval("TIME", entryId, entry.userId, me, session.userId);
    if (step.error) return { error: step.error };
    if (!step.complete) {
      await logAudit(
        "APPROVAL",
        session.userId,
        `核准工時的「${capacity}」這一階:${entry.user.name} ${entry.date} ${Number(entry.hours)}h(${entry.item.name}),${step.note ?? "尚待其他階主管"}`,
        entry.item.boardId
      );
      revalidatePath("/approvals");
      return {};
    }
  }

  await prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      status,
      decidedById: session.userId,
      decidedAt: new Date(),
      decisionNote: trimmed || null,
    },
  });
  await logAudit(
    "APPROVAL",
    session.userId,
    `${status === "APPROVED" ? "核准" : "退回"}工時(以「${capacity}」身分):${entry.user.name} ${entry.date} ${Number(
      entry.hours
    )}h（${entry.item.name}）${trimmed ? `:${trimmed}` : ""}`,
    entry.item.boardId
  );
  await notifyApprovalDecided({
    requesterId: entry.userId,
    deciderId: session.userId,
    what: `${withWeekday(entry.date)} 的工時 ${Number(entry.hours)}h(${entry.item.name})`,
    approved: status === "APPROVED",
    note: trimmed,
  });
  revalidatePath("/approvals");
  revalidatePath("/timesheet");
  revalidatePath(`/boards/${entry.item.boardId}`);
  return {};
}

/** 核准或退回一筆對應專案的非專案工時。核准後才計入那個專案的實際成本。 */
export async function decideActivityTime(
  entryId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const entry = await prisma.activityTimeEntry.findUnique({
    where: { id: entryId },
    include: { user: { select: { name: true } }, category: { select: { name: true } } },
  });
  if (!entry || !entry.boardId) return { error: "找不到這筆工時" };
  let me: ApproverInfo;
  try {
    const groups = (await groupIdsOfBoards([entry.boardId])).get(entry.boardId) ?? [];
    me = await assertMayDecideEntry(session, { key: "a", userId: entry.userId, groupIds: groups });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "權限不足" };
  }
  const capacity = capacityOf(me);

  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "退回必須寫下原因" };

  if (status === "APPROVED") {
    const step = await applyTimeApproval("ACTIVITY", entryId, entry.userId, me, session.userId);
    if (step.error) return { error: step.error };
    if (!step.complete) {
      await logAudit(
        "APPROVAL",
        session.userId,
        `核准工時的「${capacity}」這一階:${entry.user.name} ${entry.date} ${Number(entry.hours)}h(${entry.category.name}),${step.note ?? "尚待其他階主管"}`,
        entry.boardId
      );
      revalidatePath("/approvals");
      return {};
    }
  }

  await prisma.activityTimeEntry.update({
    where: { id: entryId },
    data: { status, decidedById: session.userId, decidedAt: new Date(), decisionNote: trimmed || null },
  });
  await logAudit(
    "APPROVAL",
    session.userId,
    `${status === "APPROVED" ? "核准" : "退回"}工時(以「${capacity}」身分):${entry.user.name} ${entry.date} ${Number(
      entry.hours
    )}h(${entry.category.name})${trimmed ? `:${trimmed}` : ""}`,
    entry.boardId
  );
  await notifyApprovalDecided({
    requesterId: entry.userId,
    deciderId: session.userId,
    what: `${withWeekday(entry.date)} 的工時 ${Number(entry.hours)}h(${entry.category.name})`,
    approved: status === "APPROVED",
    note: trimmed,
  });
  revalidatePath("/approvals");
  revalidatePath("/timesheet");
  revalidatePath(`/boards/${entry.boardId}`);
  return {};
}

/** 核准或退回一筆請假。核准前那幾天的產能不變——過度配置也就不會提前示警。 */
export async function decideLeave(
  leaveId: string,
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const session = await requireSession();
  const leave = await prisma.leave.findUnique({
    where: { id: leaveId },
    include: { user: { select: { name: true } } },
  });
  if (!leave) return { error: "找不到這筆請假" };
  if (leave.userId === session.userId) return { error: "不能審核自己送出的紀錄" };

  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "退回必須寫下原因" };

  // 管理者一個人就能核准或退回(主管不在、卡住的時候靠它);其他人要在送審者的主管鏈上、輪得到簽的那一階。
  if (session.role !== "ADMIN") {
    const settings = await getApprovalLevelSettings();
    const chain = managerChain(await loadSupervisorGraph(), leave.userId);
    const delegations = await loadDelegations();
    const mayAct = levelsOf(chain, session.userId, delegations).filter((level) => level <= clampLevels(settings.leave));
    if (mayAct.length === 0) return { error: "權限不足:你不是這個人需要簽核的主管" };
    if (status === "APPROVED") {
      const step = await recordSupervisorApproval({
        kind: "LEAVE",
        targetId: leaveId,
        submitterId: leave.userId,
        approverId: session.userId,
        configured: settings.leave,
      });
      if (step.error) return { error: step.error };
      if (!step.complete) {
        await logAudit(
          "APPROVAL",
          session.userId,
          `核准請假的「${levelLabel(step.level ?? mayAct[0])}${chain.includes(session.userId) ? "" : "(代簽)"}」這一階:${leave.user.name} ${leave.startDate}~${leave.endDate},${step.note ?? "尚待其他階主管"}`
        );
        revalidatePath("/approvals");
        return {};
      }
    }
  }

  await prisma.leave.update({
    where: { id: leaveId },
    data: {
      status,
      decidedById: session.userId,
      decidedAt: new Date(),
      decisionNote: trimmed || null,
    },
  });
  await logAudit(
    "APPROVAL",
    session.userId,
    `${status === "APPROVED" ? "核准" : "退回"}請假:${leave.user.name} ${leave.startDate}~${
      leave.endDate
    }${trimmed ? `:${trimmed}` : ""}`
  );
  await notifyApprovalDecided({
    requesterId: leave.userId,
    deciderId: session.userId,
    what: `請假(${withWeekday(leave.startDate)}~${withWeekday(leave.endDate)})`,
    approved: status === "APPROVED",
    note: trimmed,
  });
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/users");
  return {};
}

const MAX_BATCH = 500;

/**
 * 一次核准或退回很多筆(待我審核頁勾選之後)。
 *
 * 一筆一筆呼叫上面三個單筆的函式:權限(能不能核准這個人、這筆)、退回要寫原因、稽核紀錄都跟單筆一模一樣,
 * 沒有另外一套規則。有幾筆做不到(例如權限不足、已經被別人處理掉)不會擋住其他的,
 * 回傳成功幾筆,與沒成功的原因(相同原因合併,附筆數)。
 */
export async function decideBatch(
  targets: ApprovalTarget[],
  status: Extract<ApprovalStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ done: number; errors: string[] }> {
  await requireSession();
  if (status === "REJECTED" && !note.trim()) return { done: 0, errors: ["退回必須寫下原因"] };

  const unique = [...new Map(targets.map((t) => [`${t.kind}:${t.id}`, t])).values()];
  if (unique.length === 0) return { done: 0, errors: ["沒有選取任何項目"] };
  if (unique.length > MAX_BATCH) return { done: 0, errors: [`一次最多處理 ${MAX_BATCH} 筆,請分批`] };

  let done = 0;
  const failures = new Map<string, number>();
  for (const target of unique) {
    let error: string | undefined;
    try {
      if (target.kind === "time") error = (await decideTimeEntry(target.id, status, note)).error;
      else if (target.kind === "activity") error = (await decideActivityTime(target.id, status, note)).error;
      else if (target.kind === "leave") error = (await decideLeave(target.id, status, note)).error;
      else error = "不認得的項目種類";
    } catch (err) {
      error = err instanceof Error ? err.message : "操作失敗";
    }
    if (error) failures.set(error, (failures.get(error) ?? 0) + 1);
    else done++;
  }
  return { done, errors: [...failures].map(([message, count]) => (count > 1 ? `${message}(${count} 筆)` : message)) };
}

/** Whether to offer this person the 審核 link at all. */
export async function hasApprovalRole(): Promise<boolean> {
  const session = await requireSession();
  if (session.role === "ADMIN") return true;
  const [reports, roles, deputyRoles, criterionSigner, gateSigner, riskReviewer] = await Promise.all([
    prisma.user.count({ where: { supervisorId: session.userId } }),
    prisma.groupRoleAssignment.count({ where: { userId: session.userId, role: { in: [...APPROVER_ROLES] } } }),
    prisma.orgRole.count({ where: { userId: session.userId, canApprove: true } }),
    // 被指定為出口條件確認人、閘門簽核人、風險 / 議題審核人的人,沒有部屬也要看得到「待我審核」。
    prisma.gateCriterionApprover.count({ where: { userId: session.userId } }),
    prisma.gateApprover.count({ where: { userId: session.userId } }),
    prisma.riskReviewer.count({ where: { userId: session.userId } }),
  ]);
  return reports > 0 || roles > 0 || deputyRoles > 0 || criterionSigner > 0 || gateSigner > 0 || riskReviewer > 0;
}
