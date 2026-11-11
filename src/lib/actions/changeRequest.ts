"use server";

import { revalidatePath } from "next/cache";
import type { ChangeStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { requireStructureAccess } from "@/lib/permissions";
import { visibleItemIdsForBoard } from "@/lib/serverVisibility";
import { logAudit } from "@/lib/activityLog";
import { notifyChangeApprovalNeeded, notifyChangeDecided } from "@/lib/approvalNotify";

export type ChangeRequestInput = {
  title: string;
  description: string;
  reason: string;
  scheduleImpactDays: number | null;
  costImpact: number | null;
  impactNote: string;
  itemIds: string[];
};

export type ChangeRequestRow = ChangeRequestInput & {
  id: string;
  number: number;
  status: ChangeStatus;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  baselineId: string | null;
  baselineName: string | null;
  /** Names of the affected items, minus any this session may not see. */
  itemNames: string[];
  createdAt: string;
  /** True when the signed-in person raised it — only they may withdraw it. */
  isMine: boolean;
};

export async function listChangeRequests(boardId: string): Promise<ChangeRequestRow[]> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const requests = await prisma.changeRequest.findMany({
    where: { boardId },
    orderBy: { number: "desc" },
    include: {
      requestedBy: { select: { name: true } },
      decidedBy: { select: { name: true } },
      baseline: { select: { name: true } },
    },
  });

  const affectedIds = [...new Set(requests.flatMap((r) => r.itemIds))];
  const [items, visibleIds] = await Promise.all([
    prisma.item.findMany({ where: { id: { in: affectedIds } }, select: { id: true, name: true } }),
    visibleItemIdsForBoard(boardId, session),
  ]);
  // 統計只算看得到的 — the link stays, only the name of a private item is
  // withheld, exactly as the risk register does it.
  const nameById = new Map(items.filter((i) => visibleIds.has(i.id)).map((i) => [i.id, i.name]));

  return requests.map((request) => ({
    id: request.id,
    number: request.number,
    title: request.title,
    description: request.description ?? "",
    reason: request.reason ?? "",
    status: request.status,
    scheduleImpactDays: request.scheduleImpactDays,
    costImpact: request.costImpact,
    impactNote: request.impactNote ?? "",
    itemIds: request.itemIds,
    itemNames: request.itemIds
      .map((id) => nameById.get(id))
      .filter((name): name is string => !!name),
    requestedByName: request.requestedBy?.name ?? null,
    decidedByName: request.decidedBy?.name ?? null,
    decidedAt: request.decidedAt?.toISOString() ?? null,
    decisionNote: request.decisionNote,
    baselineId: request.baselineId,
    baselineName: request.baseline?.name ?? null,
    createdAt: request.createdAt.toISOString(),
    isMine: request.requestedById === session.userId,
  }));
}

function normalize(input: ChangeRequestInput) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || null,
    reason: input.reason.trim() || null,
    scheduleImpactDays: Number.isFinite(input.scheduleImpactDays as number)
      ? Math.round(input.scheduleImpactDays as number)
      : null,
    costImpact: Number.isFinite(input.costImpact as number)
      ? Math.round(input.costImpact as number)
      : null,
    impactNote: input.impactNote.trim() || null,
    itemIds: input.itemIds,
  };
}

/**
 * Anyone who can see the board may raise a change — the person who discovers
 * that the spec cannot be built is rarely the person who approves changing it.
 * Deciding one needs structure rights.
 */
export async function createChangeRequest(
  boardId: string,
  input: ChangeRequestInput
): Promise<{ error?: string; id?: string }> {
  const session = await requireSession();
  await requireBoardAccess(boardId, session);

  const data = normalize(input);
  if (!data.title) return { error: "請輸入變更標題" };
  if (!data.reason) return { error: "請寫下變更原因——這是之後唯一查得到當初為什麼改的欄位。" };

  // The number is per board and taken at creation. Two people filing at the
  // same instant would collide on the unique index, so it is retried rather
  // than served from a lock nobody else needs.
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await prisma.changeRequest.findFirst({
      where: { boardId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    try {
      const created = await prisma.changeRequest.create({
        data: {
          ...data,
          boardId,
          number: (last?.number ?? 0) + 1,
          requestedById: session.userId,
        },
      });
      revalidatePath(`/boards/${boardId}`);
      return { id: created.id };
    } catch (err) {
      if (attempt === 2) throw err;
    }
  }
  return { error: "建立失敗,請再試一次" };
}

async function loadForEdit(requestId: string) {
  const session = await requireSession();
  const request = await prisma.changeRequest.findUnique({
    where: { id: requestId },
    select: { boardId: true, status: true, requestedById: true },
  });
  if (!request) return null;
  await requireBoardAccess(request.boardId, session);
  return { session, request };
}

export async function updateChangeRequest(
  requestId: string,
  input: ChangeRequestInput
): Promise<{ error?: string }> {
  const loaded = await loadForEdit(requestId);
  if (!loaded) return { error: "找不到這張變更單" };
  const { session, request } = loaded;

  // Once a decision has been recorded the form is the thing that was decided
  // on; editing it afterwards would make the signature refer to text nobody
  // approved.
  if (request.status !== "DRAFT" && request.status !== "SUBMITTED") {
    return { error: "已經有決定的變更單不能再修改內容。" };
  }
  if (request.requestedById !== session.userId && session.role !== "ADMIN") {
    return { error: "只有提出者本人(或管理者)可以修改這張單子。" };
  }

  const data = normalize(input);
  if (!data.title) return { error: "請輸入變更標題" };
  if (!data.reason) return { error: "請寫下變更原因" };

  await prisma.changeRequest.update({ where: { id: requestId }, data });
  revalidatePath(`/boards/${request.boardId}`);
  return {};
}

export async function submitChangeRequest(requestId: string): Promise<{ error?: string }> {
  const loaded = await loadForEdit(requestId);
  if (!loaded) return { error: "找不到這張變更單" };
  if (loaded.request.status !== "DRAFT") return { error: "這張單子不是草稿狀態" };

  await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "SUBMITTED" } });
  await notifyChangeApprovalNeeded(requestId, loaded.session.userId);
  revalidatePath(`/boards/${loaded.request.boardId}`);
  return {};
}

export async function withdrawChangeRequest(requestId: string): Promise<{ error?: string }> {
  const loaded = await loadForEdit(requestId);
  if (!loaded) return { error: "找不到這張變更單" };
  const { session, request } = loaded;
  if (request.requestedById !== session.userId && session.role !== "ADMIN") {
    return { error: "只有提出者本人可以撤回" };
  }
  if (request.status === "IMPLEMENTED") return { error: "已執行的變更不能撤回" };

  await prisma.changeRequest.update({ where: { id: requestId }, data: { status: "WITHDRAWN" } });
  revalidatePath(`/boards/${request.boardId}`);
  return {};
}

/** 核准或駁回。Both demand a note when refusing — a rejection nobody can act
 *  on just comes back next week as the same request. */
export async function decideChangeRequest(
  requestId: string,
  status: Extract<ChangeStatus, "APPROVED" | "REJECTED">,
  note: string
): Promise<{ error?: string }> {
  const loaded = await loadForEdit(requestId);
  if (!loaded) return { error: "找不到這張變更單" };
  const { session, request } = loaded;
  requireStructureAccess(session.role);

  if (request.status !== "SUBMITTED") return { error: "只有已送審的變更單可以核准或駁回" };
  const trimmed = note.trim();
  if (status === "REJECTED" && !trimmed) return { error: "駁回必須寫下原因" };

  const row = await prisma.changeRequest.findUnique({
    where: { id: requestId },
    select: { number: true, title: true },
  });
  await prisma.changeRequest.update({
    where: { id: requestId },
    data: {
      status,
      decidedById: session.userId,
      decidedAt: new Date(),
      decisionNote: trimmed || null,
    },
  });
  await logAudit(
    "CHANGE",
    session.userId,
    `CR-${String(row?.number ?? 0).padStart(3, "0")}「${row?.title ?? ""}」${status === "APPROVED" ? "核准" : "駁回"}${trimmed ? `:${trimmed}` : ""}`,
    request.boardId
  );
  await notifyChangeDecided(requestId, session.userId, status === "APPROVED", trimmed || null);
  revalidatePath(`/boards/${request.boardId}`);
  return {};
}

/**
 * Marking an approved change as done, and tying it to the baseline that
 * carried it.
 *
 * That link is the point of the whole feature: the baseline already records
 * what the dates became, and this records why they became that.
 */
export async function implementChangeRequest(
  requestId: string,
  baselineId: string | null
): Promise<{ error?: string }> {
  const loaded = await loadForEdit(requestId);
  if (!loaded) return { error: "找不到這張變更單" };
  const { session, request } = loaded;
  requireStructureAccess(session.role);

  if (request.status !== "APPROVED") return { error: "只有已核准的變更單可以標記為已執行" };
  if (baselineId) {
    const baseline = await prisma.baseline.findUnique({
      where: { id: baselineId },
      select: { boardId: true },
    });
    if (baseline?.boardId !== request.boardId) return { error: "這一版基準線不屬於本看板" };
  }

  await prisma.changeRequest.update({
    where: { id: requestId },
    data: { status: "IMPLEMENTED", baselineId },
  });
  revalidatePath(`/boards/${request.boardId}`);
  return {};
}

export async function deleteChangeRequest(requestId: string): Promise<{ error?: string }> {
  const loaded = await loadForEdit(requestId);
  if (!loaded) return { error: "找不到這張變更單" };
  const { session, request } = loaded;
  requireStructureAccess(session.role);
  // Deleting a decided change would erase the only record that the decision
  // was ever made. Withdrawing is the way to retire one.
  if (request.status !== "DRAFT" && request.status !== "WITHDRAWN") {
    return { error: "只有草稿或已撤回的變更單可以刪除——已審過的要留著,那是紀錄。" };
  }

  await prisma.changeRequest.delete({ where: { id: requestId } });
  revalidatePath(`/boards/${request.boardId}`);
  return {};
}
