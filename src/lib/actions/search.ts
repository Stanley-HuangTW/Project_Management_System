"use server";

import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { accessibleBoardWhere } from "@/lib/boardAccess";

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
  ].sort((a, b) => (a.at < b.at ? 1 : -1));

  return {
    hits,
    truncated: [items, comments, attachments, risks].some((list) => list.length === PER_KIND),
  };
}
