"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere } from "@/lib/boardAccess";
import { computeVisibleItemIds } from "@/lib/itemVisibility";
import { getPersonIds } from "@/types/column";

export type SearchHit = {
  kind: "item" | "comment" | "attachment" | "risk";
  /** Where clicking it goes — always a board, highlighting the item when
   *  there is one. */
  boardId: string;
  boardName: string;
  itemId: string | null;
  title: string;
  /** The line that matched, for a comment or a file; empty for a plain name
   *  match, where the title is already the match. */
  excerpt: string;
  at: string;
};

export type SearchResults = {
  hits: SearchHit[];
  /** True when a category hit its cap, so the UI can say "還有更多". */
  truncated: boolean;
};

const PER_KIND = 25;

/** Keeps a matched comment readable in a list: the words around the hit,
 *  not the first 120 characters of an essay. */
function excerptAround(body: string, query: string): string {
  const at = body.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return body.slice(0, 120);
  const from = Math.max(0, at - 40);
  const to = Math.min(body.length, at + query.length + 60);
  return `${from > 0 ? "…" : ""}${body.slice(from, to)}${to < body.length ? "…" : ""}`;
}

/**
 * Searches every board the caller can open: work items by name, comments by
 * body, attachments by filename, and the risk register.
 *
 * Access is enforced by starting from the boards the session can see rather
 * than by filtering afterwards — a search that finds a title on a board you
 * cannot open has already leaked it.
 */
export async function searchEverything(rawQuery: string): Promise<SearchResults> {
  const session = await requireSession();
  const query = rawQuery.trim();
  if (query.length < 2) return { hits: [], truncated: false };

  const boards = await prisma.board.findMany({
    where: accessibleBoardWhere(session),
    select: { id: true, name: true },
  });
  if (boards.length === 0) return { hits: [], truncated: false };

  // Board access is not enough here: a private group or item inside a board
  // the caller can open is still not theirs to read, and a search result is
  // exactly the leak that would announce it.
  const visibleItemIds = await visibleItemIdsForSession(
    boards.map((b) => b.id),
    session
  );
  const boardNameById = new Map(boards.map((b) => [b.id, b.name]));
  const boardIds = boards.map((b) => b.id);

  const contains = { contains: query, mode: "insensitive" as const };

  const [items, comments, attachments, risks] = await Promise.all([
    prisma.item.findMany({
      where: { boardId: { in: boardIds }, deletedAt: null, name: contains },
      select: { id: true, name: true, boardId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
    }),
    prisma.comment.findMany({
      where: { body: contains, item: { boardId: { in: boardIds }, deletedAt: null } },
      select: { id: true, body: true, createdAt: true, item: { select: { id: true, name: true, boardId: true } } },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
    }),
    prisma.attachment.findMany({
      where: { fileName: contains, item: { boardId: { in: boardIds }, deletedAt: null } },
      select: {
        id: true,
        fileName: true,
        createdAt: true,
        item: { select: { id: true, name: true, boardId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
    }),
    prisma.riskEntry.findMany({
      where: {
        boardId: { in: boardIds },
        OR: [{ title: contains }, { description: contains }, { mitigation: contains }],
      },
      select: { id: true, title: true, description: true, boardId: true, itemId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
    }),
  ]);

  const visible = <T extends { itemId: string | null }>(hit: T) => hit.itemId === null || visibleItemIds.has(hit.itemId);

  const hits: SearchHit[] = [
    ...items.map((item) => ({
      kind: "item" as const,
      boardId: item.boardId,
      boardName: boardNameById.get(item.boardId) ?? "",
      itemId: item.id,
      title: item.name,
      excerpt: "",
      at: item.createdAt.toISOString(),
    })),
    ...comments.map((comment) => ({
      kind: "comment" as const,
      boardId: comment.item.boardId,
      boardName: boardNameById.get(comment.item.boardId) ?? "",
      itemId: comment.item.id,
      title: comment.item.name,
      excerpt: excerptAround(comment.body, query),
      at: comment.createdAt.toISOString(),
    })),
    ...attachments.map((attachment) => ({
      kind: "attachment" as const,
      boardId: attachment.item.boardId,
      boardName: boardNameById.get(attachment.item.boardId) ?? "",
      itemId: attachment.item.id,
      title: attachment.item.name,
      excerpt: attachment.fileName,
      at: attachment.createdAt.toISOString(),
    })),
    ...risks.map((risk) => ({
      kind: "risk" as const,
      boardId: risk.boardId,
      boardName: boardNameById.get(risk.boardId) ?? "",
      itemId: risk.itemId,
      title: risk.title,
      excerpt: risk.description ?? "",
      at: risk.createdAt.toISOString(),
    })),
  ]
    .filter(visible)
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    hits,
    truncated: [items, comments, attachments, risks].some((list) => list.length === PER_KIND),
  };
}

/**
 * The items this session may read across a set of boards.
 *
 * Loaded in one pass rather than per hit: a search touches four tables and
 * the answer is the same for every one of them.
 */
async function visibleItemIdsForSession(boardIds: string[], session: SessionPayload): Promise<Set<string>> {
  const [items, groups, personColumns] = await Promise.all([
    prisma.item.findMany({
      where: { boardId: { in: boardIds }, deletedAt: null },
      select: {
        id: true,
        parentId: true,
        groupId: true,
        visibility: true,
        createdById: true,
        viewers: { select: { userId: true } },
        assignments: { select: { userId: true } },
        cellValues: { select: { columnId: true, value: true } },
      },
    }),
    prisma.group.findMany({
      where: { boardId: { in: boardIds } },
      select: { id: true, visibility: true, createdById: true, viewers: { select: { userId: true } } },
    }),
    prisma.column.findMany({ where: { boardId: { in: boardIds }, type: "PERSON" }, select: { id: true } }),
  ]);
  const personColumnIds = new Set(personColumns.map((c) => c.id));

  return computeVisibleItemIds(
    items.map((item) => ({
      id: item.id,
      visibility: item.visibility,
      viewerIds: item.viewers.map((v) => v.userId),
      createdById: item.createdById,
      parentId: item.parentId,
      groupId: item.groupId,
      assigneeIds: [
        ...item.assignments.map((a) => a.userId),
        ...item.cellValues
          .filter((cv) => personColumnIds.has(cv.columnId))
          .flatMap((cv) => getPersonIds(cv.value)),
      ],
    })),
    groups.map((group) => ({
      id: group.id,
      visibility: group.visibility,
      viewerIds: group.viewers.map((v) => v.userId),
      createdById: group.createdById,
    })),
    { userId: session.userId, isAdmin: session.role === "ADMIN" }
  );
}
