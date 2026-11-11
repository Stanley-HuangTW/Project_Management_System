import { prisma } from "@/lib/prisma";
import { notifyApproval } from "@/lib/notify";
import { groupIdsOfBoards, resolveApprovers } from "@/lib/timesheetApproval";
import { clampLevels, managerChain } from "@/lib/approvalLevels";
import { getApprovalLevelSettings, loadDelegations, loadSupervisorGraph } from "@/lib/approvalLevelsServer";

/**
 * 「等你簽核」與「簽核結果」的通知——請假、工時、閘門、變更單(風險 / 議題結案在 notify.ts)。
 *
 * 收件人只挑真的輪得到簽的人:專案相關的簽核人、主管鏈。管理者一個人就能簽,但不是每一筆都找他——
 * 只有找不到任何其他簽核人(例如這個人沒有主管)時才通知管理者,免得每筆請假都吵到所有管理者。
 * 不在 "use server" 檔案裡(那裡的匯出都會變成對外的 Server Action)。通知失敗不影響簽核本身。
 */

const APPROVALS_LINK = "/approvals";

async function adminIds(): Promise<string[]> {
  return (await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } })).map((u) => u.id);
}

async function nameOf(userId: string): Promise<string> {
  return (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "同仁";
}

/** 這個人登記的工時要誰簽:專案角色(Team Leader / PMD / DM)+ 主管鏈;都沒有才是管理者。 */
async function timeApproverIds(userId: string, groupIds: string[]): Promise<string[]> {
  const list = (await resolveApprovers([{ key: "n", userId, groupIds }])).get("n") ?? [];
  const named = list.filter((a) => a.reason !== "ADMIN").map((a) => a.userId);
  return named.length > 0 ? named : await adminIds();
}

/** 有一筆(或一批)工時送審了:通知簽核人。同一個人還沒讀的同樣通知不重複發(連續登記很多筆不會洗版)。 */
export async function notifyTimeApprovalNeeded(userId: string, groupIds: string[]) {
  try {
    const ids = await timeApproverIds(userId, groupIds);
    await notifyApproval({
      userIds: ids,
      actorId: userId,
      link: APPROVALS_LINK,
      message: `${await nameOf(userId)}有工時等你簽核`,
      dedupeUnread: true,
    });
  } catch {
    // 通知不能讓登記工時失敗。
  }
}

/** 對應專案的非專案工時(會議、出差…)送審了:通知那個專案的簽核人。 */
export async function notifyActivityApprovalNeeded(userId: string, boardId: string) {
  try {
    const groupIds = (await groupIdsOfBoards([boardId])).get(boardId) ?? [];
    await notifyTimeApprovalNeeded(userId, groupIds);
  } catch {
    // 通知不能讓登記工時失敗。
  }
}

/** 一筆請假送審了:通知簽核的主管(依設定的階數,含代簽的人);這個人沒有主管才找管理者。 */
export async function notifyLeaveApprovalNeeded(userId: string, startDate: string, endDate: string) {
  try {
    const [graph, settings, delegations] = await Promise.all([loadSupervisorGraph(), getApprovalLevelSettings(), loadDelegations()]);
    const chain = managerChain(graph, userId, clampLevels(settings.leave));
    const deputies = [...delegations].filter(([, principals]) => principals.some((p) => chain.includes(p))).map(([deputy]) => deputy);
    const ids = [...new Set([...chain, ...deputies])].filter((id) => id !== userId);
    await notifyApproval({
      userIds: ids.length > 0 ? ids : await adminIds(),
      actorId: userId,
      link: APPROVALS_LINK,
      message: `${await nameOf(userId)}申請請假 ${startDate}~${endDate},等你簽核`,
    });
  } catch {
    // 通知不能讓請假申請失敗。
  }
}

/** 簽核有結果了(核准 / 退回):通知送出的人。退回要附原因。 */
export async function notifyApprovalDecided(params: {
  requesterId: string;
  deciderId: string;
  what: string;
  approved: boolean;
  note?: string | null;
  link?: string;
}) {
  try {
    const decider = await nameOf(params.deciderId);
    const note = params.note?.trim();
    await notifyApproval({
      userIds: [params.requesterId],
      actorId: params.deciderId,
      link: params.link ?? APPROVALS_LINK,
      message: `${decider}${params.approved ? "核准了" : "退回了"}你的${params.what}${note ? `:${note}` : ""}`,
    });
  } catch {
    // 通知不能讓簽核失敗。
  }
}

/** 閘門送審 / 重新送審:通知每一位簽核人。 */
export async function notifyGateApprovalNeeded(gateId: string, actorId: string) {
  try {
    const gate = await prisma.gate.findUnique({
      where: { id: gateId },
      select: { name: true, boardId: true, approvers: { select: { userId: true } } },
    });
    if (!gate) return;
    await notifyApproval({
      userIds: gate.approvers.map((a) => a.userId),
      actorId,
      link: `/boards/${gate.boardId}?view=gates`,
      message: `${await nameOf(actorId)}送審閘門「${gate.name}」,等你簽核`,
    });
  } catch {
    // 通知不能讓送審失敗。
  }
}

/** 一位簽核人簽了閘門(同意 / 退回):通知看板擁有者(送審的人);退回附他寫的意見。 */
export async function notifyGateSigned(gateId: string, signerId: string, approved: boolean, comment: string | null) {
  try {
    const gate = await prisma.gate.findUnique({
      where: { id: gateId },
      select: { name: true, boardId: true, board: { select: { ownerId: true } } },
    });
    if (!gate) return;
    await notifyApproval({
      userIds: [gate.board.ownerId],
      actorId: signerId,
      link: `/boards/${gate.boardId}?view=gates`,
      message: `${await nameOf(signerId)}${approved ? "同意" : "退回"}了閘門「${gate.name}」${comment ? `:${comment}` : ""}`,
    });
  } catch {
    // 通知不能讓簽核失敗。
  }
}

/** 閘門最後的結論(放行 / 有條件放行 / 不通過):通知簽核人與送審的人(操作的人除外)。 */
export async function notifyGateDecided(gateId: string, deciderId: string, outcome: "放行" | "有條件放行" | "不通過", note: string | null) {
  try {
    const gate = await prisma.gate.findUnique({
      where: { id: gateId },
      select: { name: true, boardId: true, approvers: { select: { userId: true } }, board: { select: { ownerId: true } } },
    });
    if (!gate) return;
    await notifyApproval({
      userIds: [...gate.approvers.map((a) => a.userId), gate.board.ownerId],
      actorId: deciderId,
      link: `/boards/${gate.boardId}?view=gates`,
      message: `${await nameOf(deciderId)}對閘門「${gate.name}」的結論:${outcome}${note ? `(${note})` : ""}`,
    });
  } catch {
    // 通知不能讓簽核失敗。
  }
}

/** 變更單送審:通知看板擁有者與管理者(能核准的人)。 */
export async function notifyChangeApprovalNeeded(requestId: string, actorId: string) {
  try {
    const cr = await prisma.changeRequest.findUnique({
      where: { id: requestId },
      select: { number: true, title: true, boardId: true, board: { select: { ownerId: true } } },
    });
    if (!cr) return;
    await notifyApproval({
      userIds: [cr.board.ownerId, ...(await adminIds())],
      actorId,
      link: `/boards/${cr.boardId}?view=changes`,
      message: `${await nameOf(actorId)}送審變更單 CR-${String(cr.number).padStart(3, "0")}「${cr.title}」,等你核准`,
    });
  } catch {
    // 通知不能讓送審失敗。
  }
}

/** 變更單核准 / 駁回:通知提出的人。 */
export async function notifyChangeDecided(requestId: string, deciderId: string, approved: boolean, note: string | null) {
  try {
    const cr = await prisma.changeRequest.findUnique({
      where: { id: requestId },
      select: { number: true, title: true, boardId: true, requestedById: true },
    });
    if (!cr?.requestedById) return;
    await notifyApprovalDecided({
      requesterId: cr.requestedById,
      deciderId,
      what: `變更單 CR-${String(cr.number).padStart(3, "0")}「${cr.title}」`,
      approved,
      note,
      link: `/boards/${cr.boardId}?view=changes`,
    });
  } catch {
    // 通知不能讓簽核失敗。
  }
}
