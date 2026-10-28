"use server";

import { revalidatePath } from "next/cache";
import type { GroupRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { logActivity, logAudit } from "@/lib/activityLog";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { resyncBoardLabour } from "@/lib/actions/labourSheet";
import { pickStatusColumnId } from "@/lib/itemEvents";
import { getPersonIds, getStatusOptions } from "@/types/column";
import { currentMonthTaipei, isUnfinished, mergeAllocationPct, replacePersonValue, slotIsOngoing } from "@/lib/handover";
import { syncGroupRolesFromBoard } from "@/lib/boardRolesServer";

/** 交接清單裡「看板層級角色」那幾列的 id 前綴(跟分組角色的列區分)。 */
const BOARD_ROLE_PREFIX = "board:";

/**
 * 工作交接(使用者管理):把一個人名下還沒做完的工作交給另一個人。只有管理者能用。
 * 先 previewHandover 列出會動到哪些,管理者逐筆確認(可以取消勾選)之後,才 executeHandover 真的轉。
 * 錯誤一律用回傳值帶回去,不用丟例外——production 的 Next.js 會把丟出來的訊息洗成一句通用的話。
 */

export type HandoverItemRow = {
  itemId: string;
  itemName: string;
  boardId: string;
  boardName: string;
  groupName: string;
  /** 轉出者在這個工作項的人員分配(投入 %);沒有分配是 null。 */
  allocationPct: number | null;
  /** 這個工作項上填了轉出者的人員欄位名稱(負責人、測試工具…)。 */
  personColumns: string[];
  /** 接手的人本來就有這個工作項的人員分配(投入 % 會加總)。 */
  targetAllocationPct: number | null;
};

export type HandoverRiskRow = { riskId: string; title: string; kind: "RISK" | "ISSUE"; boardName: string; asOwner: boolean; asReviewer: boolean };
export type HandoverSlotRow = { slotId: string; label: string; func: string; boardName: string };
export type HandoverRoleRow = { roleId: string; role: GroupRole; groupName: string; boardName: string };

export type HandoverPreview = {
  fromName: string;
  toName: string;
  items: HandoverItemRow[];
  risks: HandoverRiskRow[];
  slots: HandoverSlotRow[];
  roles: HandoverRoleRow[];
};

async function requireAdminSession() {
  const session = await requireSession();
  if (session.role !== "ADMIN") return { error: "權限不足:僅管理者可以做工作交接" } as const;
  return { session } as const;
}

async function loadPeople(fromId: string, toId: string) {
  if (!fromId || !toId) return { error: "請選擇轉出者與接手者" } as const;
  if (fromId === toId) return { error: "轉出者與接手者不能是同一個人" } as const;
  const people = await prisma.user.findMany({ where: { id: { in: [fromId, toId] } }, select: { id: true, name: true } });
  const from = people.find((p) => p.id === fromId);
  const to = people.find((p) => p.id === toId);
  if (!from || !to) return { error: "找不到這位使用者" } as const;
  return { from, to } as const;
}

export async function previewHandover(fromId: string, toId: string): Promise<{ error?: string; preview?: HandoverPreview }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const people = await loadPeople(fromId, toId);
  if ("error" in people) return { error: people.error };

  const liveItem = { deletedAt: null, board: { deletedAt: null } };
  const [assignments, personColumns] = await Promise.all([
    prisma.assignment.findMany({ where: { userId: fromId, item: liveItem }, select: { itemId: true, allocationPct: true } }),
    prisma.column.findMany({ where: { type: "PERSON", board: { deletedAt: null } }, select: { id: true, name: true } }),
  ]);
  const personCells =
    personColumns.length > 0
      ? await prisma.cellValue.findMany({
          where: { columnId: { in: personColumns.map((c) => c.id) }, item: liveItem },
          select: { itemId: true, columnId: true, value: true },
        })
      : [];
  const columnName = new Map(personColumns.map((c) => [c.id, c.name]));

  const links = new Map<string, { pct: number | null; columns: string[] }>();
  for (const a of assignments) links.set(a.itemId, { pct: a.allocationPct, columns: [] });
  for (const cell of personCells) {
    if (!getPersonIds(cell.value).includes(fromId)) continue;
    const link = links.get(cell.itemId) ?? { pct: null, columns: [] };
    link.columns.push(columnName.get(cell.columnId) ?? "人員欄位");
    links.set(cell.itemId, link);
  }

  const itemIds = [...links.keys()];
  const items = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: {
      id: true,
      name: true,
      boardId: true,
      board: { select: { name: true, reportDoneOptionIds: true } },
      group: { select: { name: true } },
    },
  });
  const boardIds = [...new Set(items.map((i) => i.boardId))];
  const statusColumns = boardIds.length
    ? await prisma.column.findMany({ where: { boardId: { in: boardIds }, type: "STATUS" }, select: { id: true, name: true, type: true, boardId: true, options: true } })
    : [];
  const statusColumnByBoard = new Map<string, (typeof statusColumns)[number]>();
  for (const boardId of boardIds) {
    const own = statusColumns.filter((c) => c.boardId === boardId);
    const pickedId = pickStatusColumnId(own);
    const picked = own.find((c) => c.id === pickedId);
    if (picked) statusColumnByBoard.set(boardId, picked);
  }
  const statusCells = statusColumnByBoard.size
    ? await prisma.cellValue.findMany({
        where: { itemId: { in: itemIds }, columnId: { in: [...statusColumnByBoard.values()].map((c) => c.id) } },
        select: { itemId: true, columnId: true, value: true },
      })
    : [];
  const statusOf = new Map(statusCells.map((c) => [`${c.itemId}:${c.columnId}`, c.value]));
  const targetAssignments = new Map(
    (await prisma.assignment.findMany({ where: { userId: toId, itemId: { in: itemIds } }, select: { itemId: true, allocationPct: true } })).map((a) => [a.itemId, a.allocationPct])
  );

  const rows: HandoverItemRow[] = [];
  for (const item of items) {
    const statusColumn = statusColumnByBoard.get(item.boardId);
    const unfinished = statusColumn
      ? isUnfinished(statusOf.get(`${item.id}:${statusColumn.id}`), getStatusOptions(statusColumn.options), item.board.reportDoneOptionIds)
      : true;
    if (!unfinished) continue;
    const link = links.get(item.id)!;
    rows.push({
      itemId: item.id,
      itemName: item.name,
      boardId: item.boardId,
      boardName: item.board.name,
      groupName: item.group.name,
      allocationPct: link.pct,
      personColumns: link.columns,
      targetAllocationPct: targetAssignments.get(item.id) ?? null,
    });
  }
  rows.sort((a, b) => a.boardName.localeCompare(b.boardName, "zh-TW") || a.itemName.localeCompare(b.itemName, "zh-TW", { numeric: true }));

  const openRisk = { status: { not: "CLOSED" as const }, board: { deletedAt: null } };
  const [owned, reviewing, slots, groupRoles, boardRoles] = await Promise.all([
    prisma.riskEntry.findMany({ where: { ownerId: fromId, ...openRisk }, select: { id: true, title: true, kind: true, board: { select: { name: true } } } }),
    prisma.riskReviewer.findMany({
      where: { userId: fromId, approvedAt: null, risk: openRisk },
      select: { risk: { select: { id: true, title: true, kind: true, board: { select: { name: true } } } } },
    }),
    prisma.labourSlot.findMany({
      where: { userId: fromId, board: { deletedAt: null } },
      select: { id: true, label: true, func: true, board: { select: { name: true } }, months: { select: { month: true } } },
    }),
    prisma.groupRoleAssignment.findMany({
      where: { userId: fromId, group: { board: { deletedAt: null } } },
      select: { id: true, role: true, group: { select: { name: true, roleOverrides: true, board: { select: { name: true } } } } },
    }),
    prisma.boardRoleAssignment.findMany({
      where: { userId: fromId, board: { deletedAt: null } },
      select: { id: true, role: true, board: { select: { name: true } } },
    }),
  ]);
  const riskById = new Map<string, HandoverRiskRow>();
  for (const r of owned) riskById.set(r.id, { riskId: r.id, title: r.title, kind: r.kind, boardName: r.board.name, asOwner: true, asReviewer: false });
  for (const { risk } of reviewing) {
    const existing = riskById.get(risk.id);
    if (existing) existing.asReviewer = true;
    else riskById.set(risk.id, { riskId: risk.id, title: risk.title, kind: risk.kind, boardName: risk.board.name, asOwner: false, asReviewer: true });
  }
  const month = currentMonthTaipei();

  return {
    preview: {
      fromName: people.from.name,
      toName: people.to.name,
      items: rows,
      risks: [...riskById.values()].sort((a, b) => a.boardName.localeCompare(b.boardName, "zh-TW") || a.title.localeCompare(b.title, "zh-TW")),
      slots: slots
        .filter((s) => slotIsOngoing(s.months.map((m) => m.month), month))
        .map((s) => ({ slotId: s.id, label: s.label, func: s.func, boardName: s.board.name })),
      // 沿用看板的角色(分組裡的列只是看板名單的複本)不單獨列:交接看板那一列,各分組跟著換。
      roles: [
        ...boardRoles.map((r) => ({ roleId: `${BOARD_ROLE_PREFIX}${r.id}`, role: r.role, groupName: "整個看板(沿用的分組一起換)", boardName: r.board.name })),
        ...groupRoles
          .filter((r) => r.group.roleOverrides.includes(r.role))
          .map((r) => ({ roleId: r.id, role: r.role, groupName: r.group.name, boardName: r.group.board.name })),
      ],
    },
  };
}

export type HandoverResult = { items: number; risks: number; slots: number; roles: number };

export async function executeHandover(args: {
  fromId: string;
  toId: string;
  itemIds: string[];
  riskIds: string[];
  slotIds: string[];
  roleIds: string[];
}): Promise<{ error?: string; moved?: HandoverResult }> {
  const guard = await requireAdminSession();
  if ("error" in guard) return { error: guard.error };
  const people = await loadPeople(args.fromId, args.toId);
  if ("error" in people) return { error: people.error };
  const { from, to } = people;
  const actorId = guard.session.userId;

  const movedItems: { id: string; name: string; boardId: string; summary: string }[] = [];
  let risksMoved = 0;
  let slotsMoved = 0;
  let rolesMoved = 0;
  const slotBoardIds = new Set<string>();

  try {
    await prisma.$transaction(
      async (tx) => {
        for (const itemId of new Set(args.itemIds)) {
          const item = await tx.item.findUnique({ where: { id: itemId }, select: { id: true, name: true, boardId: true, deletedAt: true } });
          if (!item || item.deletedAt) continue;
          const parts: string[] = [];

          const mine = await tx.assignment.findUnique({ where: { itemId_userId: { itemId, userId: from.id } } });
          if (mine) {
            const theirs = await tx.assignment.findUnique({ where: { itemId_userId: { itemId, userId: to.id } } });
            if (theirs) {
              const merged = mergeAllocationPct(theirs.allocationPct, mine.allocationPct);
              await tx.assignment.update({ where: { id: theirs.id }, data: { allocationPct: merged } });
              await tx.assignment.delete({ where: { id: mine.id } });
              parts.push(`人員分配 ${mine.allocationPct}% 併入(共 ${merged}%)`);
            } else {
              await tx.assignment.update({ where: { id: mine.id }, data: { userId: to.id } });
              parts.push(`人員分配 ${mine.allocationPct}%`);
            }
          }

          const cells = await tx.cellValue.findMany({
            where: { itemId, column: { type: "PERSON" } },
            select: { id: true, value: true, column: { select: { name: true } } },
          });
          for (const cell of cells) {
            if (!getPersonIds(cell.value).includes(from.id)) continue;
            await tx.cellValue.update({
              where: { id: cell.id },
              data: { value: replacePersonValue(cell.value, from.id, to.id) as Prisma.InputJsonValue },
            });
            parts.push(`「${cell.column.name}」`);
          }

          if (parts.length > 0) movedItems.push({ id: item.id, name: item.name, boardId: item.boardId, summary: parts.join("、") });
        }

        for (const riskId of new Set(args.riskIds)) {
          let touched = false;
          const owner = await tx.riskEntry.updateMany({ where: { id: riskId, ownerId: from.id }, data: { ownerId: to.id } });
          if (owner.count > 0) touched = true;
          const reviewer = await tx.riskReviewer.findFirst({ where: { riskId, userId: from.id, approvedAt: null } });
          if (reviewer) {
            const already = await tx.riskReviewer.findUnique({ where: { riskId_userId: { riskId, userId: to.id } } });
            if (already) await tx.riskReviewer.delete({ where: { id: reviewer.id } });
            else await tx.riskReviewer.update({ where: { id: reviewer.id }, data: { userId: to.id } });
            touched = true;
          }
          if (touched) risksMoved += 1;
        }

        const slots = await tx.labourSlot.findMany({ where: { id: { in: args.slotIds }, userId: from.id }, select: { id: true, boardId: true } });
        if (slots.length > 0) {
          await tx.labourSlot.updateMany({ where: { id: { in: slots.map((s) => s.id) } }, data: { userId: to.id } });
          slotsMoved = slots.length;
          for (const s of slots) slotBoardIds.add(s.boardId);
        }

        const syncBoardIds = new Set<string>();
        for (const roleId of new Set(args.roleIds)) {
          if (roleId.startsWith(BOARD_ROLE_PREFIX)) {
            const boardRole = await tx.boardRoleAssignment.findUnique({ where: { id: roleId.slice(BOARD_ROLE_PREFIX.length) } });
            if (!boardRole || boardRole.userId !== from.id) continue;
            const already = await tx.boardRoleAssignment.findUnique({
              where: { boardId_role_userId: { boardId: boardRole.boardId, role: boardRole.role, userId: to.id } },
            });
            if (already) await tx.boardRoleAssignment.delete({ where: { id: boardRole.id } });
            else await tx.boardRoleAssignment.update({ where: { id: boardRole.id }, data: { userId: to.id } });
            syncBoardIds.add(boardRole.boardId);
            rolesMoved += 1;
            continue;
          }
          const role = await tx.groupRoleAssignment.findUnique({ where: { id: roleId }, include: { group: { select: { roleOverrides: true } } } });
          if (!role || role.userId !== from.id) continue;
          // 沿用看板的角色跟著看板那一列走,不能單獨改這個分組(下一次同步又會被蓋回去)。
          if (!role.group.roleOverrides.includes(role.role)) continue;
          const already = await tx.groupRoleAssignment.findUnique({
            where: { groupId_role_userId: { groupId: role.groupId, role: role.role, userId: to.id } },
          });
          if (already) await tx.groupRoleAssignment.delete({ where: { id: role.id } });
          else await tx.groupRoleAssignment.update({ where: { id: role.id }, data: { userId: to.id } });
          rolesMoved += 1;
        }
        for (const boardId of syncBoardIds) await syncGroupRolesFromBoard(boardId, {}, tx);
      },
      { timeout: 60_000, maxWait: 10_000 }
    );
  } catch {
    return { error: "交接失敗,資料沒有被改動,請重新整理後再試一次。" };
  }

  // 交接成功之後的紀錄與通知;這些失敗不該讓已經完成的交接看起來像失敗。
  for (const item of movedItems) {
    await logActivity(item.id, actorId, `工作交接:${from.name} → ${to.name}(${item.summary})`);
  }
  const counts: HandoverResult = { items: movedItems.length, risks: risksMoved, slots: slotsMoved, roles: rolesMoved };
  await logAudit(
    "ACCESS",
    actorId,
    `工作交接:${from.name} → ${to.name}:工作項 ${counts.items}、風險與議題 ${counts.risks}、人力名額 ${counts.slots}、分組角色 ${counts.roles}`
  );
  for (const boardId of slotBoardIds) await resyncBoardLabour(boardId).catch(() => {});

  if (counts.items > 0 && to.id !== actorId) {
    const message = `${from.name} 的 ${counts.items} 個工作項交接給你`;
    const [notifiableId] = await filterInAppRecipients(prisma, "ASSIGNED", [to.id]);
    if (notifiableId) {
      await prisma.notification.create({ data: { userId: to.id, actorId, type: "ASSIGNED", itemId: movedItems[0].id, message } });
    }
    await notifyEmailIfNeeded(to.id, "ASSIGNED", message);
  }

  for (const boardId of new Set(movedItems.map((i) => i.boardId))) revalidatePath(`/boards/${boardId}`);
  revalidatePath("/users");
  revalidatePath("/dashboard");
  return { moved: counts };
}
