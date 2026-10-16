"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { logAudit } from "@/lib/activityLog";
import { findSupervisorCycle, planOrgMove, planSupervisorSync, wouldCreateNodeCycle, type OrgNodeLite } from "@/lib/orgTree";

/**
 * 公司組織架構圖:部門成樹、每個部門一位主管、人掛在部門底下。
 * 每次改動之後,把掛在部門底下的人的「所屬主管」(User.supervisorId)照架構圖重算——簽核、可見範圍、
 * 主管的下轄範圍本來就讀 supervisorId,所以全部沿用。沒掛部門的人,主管仍是手動指定的,不動。
 *
 * 錯誤一律用回傳值帶回去,不用丟例外——production 的 Next.js 會把丟出來的訊息洗成一句通用的話。
 */

export type OrgChartPerson = {
  id: string;
  name: string;
  orgNodeId: string | null;
  supervisorId: string | null;
  /** 人力表的單位代號(EE、ME…),只是顯示用。 */
  discipline: string | null;
};

/** 部門裡主管以外的職能:副主管、行政……。canApprove = 可以代這個部門的主管簽核。 */
export type OrgRoleRow = { id: string; nodeId: string; userId: string; title: string; canApprove: boolean };

export type OrgChartData = { nodes: OrgNodeLite[]; people: OrgChartPerson[]; roles: OrgRoleRow[] };

/** 任何登入的人都能看架構圖。 */
export async function getOrgChart(): Promise<OrgChartData> {
  await requireSession();
  const [nodes, people, roles] = await Promise.all([
    prisma.orgNode.findMany({
      select: { id: true, name: true, parentId: true, headId: true, order: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      select: { id: true, name: true, orgNodeId: true, supervisorId: true, discipline: true },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    }),
    prisma.orgRole.findMany({
      select: { id: true, nodeId: true, userId: true, title: true, canApprove: true },
      orderBy: [{ createdAt: "asc" }],
    }),
  ]);
  return { nodes, people, roles };
}

async function requireAdminSession() {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足:僅管理者可以修改組織架構圖" } as const;
  return { session } as const;
}

class OrgEditError extends Error {}

/** 在交易裡照架構圖重算主管;會繞成環就整個回復並說明是誰。 */
async function syncSupervisors(tx: Prisma.TransactionClient): Promise<number> {
  const [nodes, people] = await Promise.all([
    tx.orgNode.findMany({ select: { id: true, name: true, parentId: true, headId: true, order: true } }),
    tx.user.findMany({ select: { id: true, name: true, orgNodeId: true, supervisorId: true } }),
  ]);
  const changes = planSupervisorSync(nodes, people);
  const cycleUserId = findSupervisorCycle(people, changes);
  if (cycleUserId) {
    const name = people.find((p) => p.id === cycleUserId)?.name ?? "某位同仁";
    throw new OrgEditError(
      `這樣設定會讓「${name}」和他的主管互為主管。常見原因:某人是上層部門的主管,自己卻掛在下層部門底下——請先把他掛到他帶領的部門。`
    );
  }
  for (const change of changes) {
    await tx.user.update({ where: { id: change.userId }, data: { supervisorId: change.supervisorId } });
  }
  return changes.length;
}

/**
 * 改架構圖 + 重算主管,同一個交易;回傳有幾個人的主管因此變動。
 * 稽核紀錄等交易成功之後才寫(回復的改動不該留下「已修改」的紀錄)。
 */
async function editOrg(
  actorId: string,
  work: (tx: Prisma.TransactionClient) => Promise<{ error?: string; audit?: string }>
): Promise<{ error?: string; supervisorsChanged?: number }> {
  let audit: string | undefined;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const outcome = await work(tx);
      if (outcome.error) return { error: outcome.error };
      audit = outcome.audit;
      return { supervisorsChanged: await syncSupervisors(tx) };
    });
    if (!("error" in result) && audit) await logAudit("SETTINGS", actorId, audit);
    return result;
  } catch (err) {
    if (err instanceof OrgEditError) return { error: err.message };
    throw err;
  }
}

function done() {
  revalidatePath("/org-chart");
  revalidatePath("/users");
  revalidatePath("/approvals");
}

export async function createOrgNode(name: string, parentId: string | null): Promise<{ error?: string; id?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入部門名稱" };
  if (parentId && !(await prisma.orgNode.findUnique({ where: { id: parentId }, select: { id: true } }))) {
    return { error: "找不到上層部門" };
  }
  const last = await prisma.orgNode.findFirst({ where: { parentId }, orderBy: { order: "desc" }, select: { order: true } });
  const node = await prisma.orgNode.create({ data: { name: trimmed, parentId, order: (last?.order ?? -1) + 1 } });
  await logAudit("SETTINGS", guard.session.userId, `組織架構圖:新增部門「${node.name}」`);
  done();
  return { id: node.id };
}

export async function renameOrgNode(id: string, name: string): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const trimmed = name.trim();
  if (!trimmed) return { error: "請輸入部門名稱" };
  const before = await prisma.orgNode.findUnique({ where: { id }, select: { name: true } });
  if (!before) return { error: "找不到這個部門" };
  await prisma.orgNode.update({ where: { id }, data: { name: trimmed } });
  await logAudit("SETTINGS", guard.session.userId, `組織架構圖:部門改名「${before.name}」→「${trimmed}」`);
  done();
  return {};
}

/** 把部門掛到新的上層(null = 變成最上層)。 */
export async function moveOrgNode(id: string, newParentId: string | null): Promise<{ error?: string; supervisorsChanged?: number }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const result = await editOrg(guard.session.userId, async (tx) => {
    const nodes = await tx.orgNode.findMany({ select: { id: true, name: true, parentId: true, headId: true, order: true } });
    const node = nodes.find((n) => n.id === id);
    if (!node) return { error: "找不到這個部門" };
    if (newParentId && !nodes.some((n) => n.id === newParentId)) return { error: "找不到上層部門" };
    if (wouldCreateNodeCycle(nodes, id, newParentId)) return { error: "不能把部門掛到它自己或它的下層部門底下" };
    if (node.parentId === newParentId) return {};
    const last = await tx.orgNode.findFirst({ where: { parentId: newParentId }, orderBy: { order: "desc" }, select: { order: true } });
    await tx.orgNode.update({ where: { id }, data: { parentId: newParentId, order: (last?.order ?? -1) + 1 } });
    const parentName = nodes.find((n) => n.id === newParentId)?.name;
    return { audit: `組織架構圖:「${node.name}」${parentName ? `移到「${parentName}」底下` : "改為最上層"}` };
  });
  done();
  return result;
}

/**
 * 拖曳部門:放到 parentId 底下(null = 最上層)的第 index 個位置。換上層與調順序是同一個動作,
 * 新同層的順序整個重新編號。
 */
export async function moveOrgNodeTo(
  id: string,
  parentId: string | null,
  index: number
): Promise<{ error?: string; supervisorsChanged?: number }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const result = await editOrg(guard.session.userId, async (tx) => {
    const nodes = await tx.orgNode.findMany({ select: { id: true, name: true, parentId: true, headId: true, order: true } });
    const node = nodes.find((n) => n.id === id);
    if (!node) return { error: "找不到這個部門" };
    if (parentId && !nodes.some((n) => n.id === parentId)) return { error: "找不到上層部門" };
    if (wouldCreateNodeCycle(nodes, id, parentId)) return { error: "不能把部門掛到它自己或它的下層部門底下" };
    const updates = planOrgMove(nodes, id, parentId, Number.isFinite(index) ? Math.trunc(index) : 0);
    if (updates.length === 0) return {};
    for (const update of updates) {
      await tx.orgNode.update({ where: { id: update.id }, data: { parentId: update.parentId, order: update.order } });
    }
    const parentName = nodes.find((n) => n.id === parentId)?.name;
    const moved = node.parentId !== parentId;
    return {
      audit: moved
        ? `組織架構圖:拖曳「${node.name}」${parentName ? `到「${parentName}」底下` : "改為最上層"}`
        : `組織架構圖:拖曳調整「${node.name}」的順序`,
    };
  });
  done();
  return result;
}

/** 指定部門主管(null = 不設)。主管本人如果還沒掛在任何部門底下,就掛在他帶領的這個部門。 */
export async function setOrgNodeHead(id: string, userId: string | null): Promise<{ error?: string; supervisorsChanged?: number }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const result = await editOrg(guard.session.userId, async (tx) => {
    const node = await tx.orgNode.findUnique({ where: { id }, select: { name: true } });
    if (!node) return { error: "找不到這個部門" };
    let userName: string | null = null;
    if (userId) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true, orgNodeId: true } });
      if (!user) return { error: "找不到這位使用者" };
      userName = user.name;
      if (!user.orgNodeId) await tx.user.update({ where: { id: userId }, data: { orgNodeId: id } });
    }
    await tx.orgNode.update({ where: { id }, data: { headId: userId } });
    return { audit: `組織架構圖:「${node.name}」主管設為${userName ? `「${userName}」` : "(未設)"}` };
  });
  done();
  return result;
}

/** 把人掛到部門底下(null = 移出架構圖,主管回到手動指定)。 */
export async function setUserOrgNode(userId: string, nodeId: string | null): Promise<{ error?: string; supervisorsChanged?: number }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const result = await editOrg(guard.session.userId, async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!user) return { error: "找不到這位使用者" };
    let nodeName: string | null = null;
    if (nodeId) {
      const node = await tx.orgNode.findUnique({ where: { id: nodeId }, select: { name: true } });
      if (!node) return { error: "找不到這個部門" };
      nodeName = node.name;
    }
    await tx.user.update({ where: { id: userId }, data: { orgNodeId: nodeId } });
    return { audit: `組織架構圖:「${user.name}」${nodeName ? `掛在「${nodeName}」底下` : "移出架構圖"}` };
  });
  done();
  return result;
}

const MAX_ROLE_TITLE = 20;

/**
 * 在部門裡加一個主管以外的職能(副主管、行政……),已經有就改職稱與可否代簽。
 * 不影響「誰是誰的主管」,所以不用重算所屬主管;canApprove 才會影響簽核(代這個部門的主管簽)。
 */
export async function saveOrgRole(
  nodeId: string,
  userId: string,
  title: string,
  canApprove: boolean
): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const trimmed = title.trim();
  if (!trimmed) return { error: "請輸入職稱(例如:副主管)" };
  if (trimmed.length > MAX_ROLE_TITLE) return { error: `職稱最多 ${MAX_ROLE_TITLE} 個字` };
  const [node, user] = await Promise.all([
    prisma.orgNode.findUnique({ where: { id: nodeId }, select: { name: true, headId: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  if (!node) return { error: "找不到這個部門" };
  if (!user) return { error: "找不到這位使用者" };
  if (node.headId === userId) return { error: `${user.name}本來就是「${node.name}」的主管,不用再設職能` };
  await prisma.orgRole.upsert({
    where: { nodeId_userId: { nodeId, userId } },
    create: { nodeId, userId, title: trimmed, canApprove },
    update: { title: trimmed, canApprove },
  });
  await logAudit(
    "SETTINGS",
    guard.session.userId,
    `組織架構圖:「${node.name}」的${trimmed}設為「${user.name}」${canApprove ? "(可代主管簽核)" : ""}`
  );
  done();
  return {};
}

export async function removeOrgRole(id: string): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const role = await prisma.orgRole.findUnique({
    where: { id },
    select: { title: true, node: { select: { name: true } }, user: { select: { name: true } } },
  });
  if (!role) return { error: "找不到這個職能" };
  await prisma.orgRole.delete({ where: { id } });
  await logAudit("SETTINGS", guard.session.userId, `組織架構圖:移除「${role.node.name}」的${role.title}「${role.user.name}」`);
  done();
  return {};
}

/** 刪除部門:底下還有子部門或成員就不行,請先處理。 */
export async function deleteOrgNode(id: string): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const node = await prisma.orgNode.findUnique({
    where: { id },
    select: { name: true, _count: { select: { children: true, members: true } } },
  });
  if (!node) return { error: "找不到這個部門" };
  if (node._count.children > 0) return { error: `「${node.name}」底下還有 ${node._count.children} 個子部門,請先移走或刪除它們` };
  if (node._count.members > 0) return { error: `「${node.name}」還有 ${node._count.members} 位成員,請先把他們移到別的部門或移出架構圖` };
  await prisma.orgNode.delete({ where: { id } });
  await logAudit("SETTINGS", guard.session.userId, `組織架構圖:刪除部門「${node.name}」`);
  done();
  return {};
}

/** 同一層部門往前或往後移一格。 */
export async function moveOrgNodeOrder(id: string, direction: "up" | "down"): Promise<{ error?: string }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const node = await prisma.orgNode.findUnique({ where: { id }, select: { parentId: true } });
  if (!node) return { error: "找不到這個部門" };
  const siblings = await prisma.orgNode.findMany({
    where: { parentId: node.parentId },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const index = siblings.findIndex((s) => s.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= siblings.length) return {};
  const ids = siblings.map((s) => s.id);
  [ids[index], ids[target]] = [ids[target], ids[index]];
  // 重新編成連續的順序,不怕原本有並列的 order。
  await prisma.$transaction(ids.map((siblingId, order) => prisma.orgNode.update({ where: { id: siblingId }, data: { order } })));
  done();
  return {};
}
