import { prisma } from "@/lib/prisma";
import { filterInAppRecipients, notifyEmailIfNeeded } from "@/lib/notify";
import { getPersonIds } from "@/types/column";
import { buildWbsIndexFromItems, resolvePredValues } from "@/lib/predecessorLink";

type CompletionColumns = {
  progressColumnId: string | null;
  reportStatusColumnId: string | null;
  reportDoneOptionIds: string[];
  statusColumnId: string | null;
};

/**
 * Whether these cell values read as complete, by the same three rules
 * isItemComplete uses: the progress column at 100%, the report status column
 * on one of its 完成 options, or the Status column on "done".
 *
 * Deliberately looks only at the item's OWN cells — isItemComplete also rolls
 * a parent's progress up from its children, but this exists to catch the
 * moment someone marks a task finished, and a rollup does not change on that
 * item's own edit.
 */
function readsAsComplete(
  cellValues: { columnId: string; value: unknown }[],
  columns: CompletionColumns
): boolean {
  if (columns.progressColumnId) {
    const value = cellValues.find((cv) => cv.columnId === columns.progressColumnId)?.value;
    // Stored as the 0-1 fraction computeItemProgress reads, not 0-100.
    if (typeof value === "number" && value >= 1) return true;
  }
  if (columns.reportStatusColumnId && columns.reportDoneOptionIds.length > 0) {
    const value = cellValues.find((cv) => cv.columnId === columns.reportStatusColumnId)?.value;
    if (typeof value === "string" && columns.reportDoneOptionIds.includes(value)) return true;
  }
  if (columns.statusColumnId) {
    const value = cellValues.find((cv) => cv.columnId === columns.statusColumnId)?.value;
    if (value === "done") return true;
  }
  return false;
}

/**
 * When an item is marked complete, tells whoever is on the items that were
 * waiting for it that they can start. The Pred lamp turns green at the same
 * moment, but nobody is looking at a field on someone else's row — the point
 * of the dependency is that the next person finds out.
 *
 * Does nothing unless this edit is what flipped the item to complete, so
 * re-saving an already-done item does not notify again.
 */
export async function notifyDependentsWhenDone(
  boardId: string,
  itemId: string,
  actorId: string,
  previousCellValues: { columnId: string; value: unknown }[],
  editedColumnId: string,
  newValue: unknown
): Promise<void> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: {
      progressColumnId: true,
      reportStatusColumnId: true,
      reportDoneOptionIds: true,
      predColumnId: true,
      columns: { where: { type: "STATUS" }, select: { id: true, name: true } },
    },
  });
  if (!board?.predColumnId) return;

  const statusColumn =
    board.columns.find((c) => c.name === "Status") ?? board.columns[0] ?? null;
  const columns: CompletionColumns = {
    progressColumnId: board.progressColumnId,
    reportStatusColumnId: board.reportStatusColumnId,
    reportDoneOptionIds: board.reportDoneOptionIds,
    statusColumnId: statusColumn?.id ?? null,
  };
  if (
    editedColumnId !== columns.progressColumnId &&
    editedColumnId !== columns.reportStatusColumnId &&
    editedColumnId !== columns.statusColumnId
  ) {
    return;
  }

  const nextCellValues = [
    ...previousCellValues.filter((cv) => cv.columnId !== editedColumnId),
    { columnId: editedColumnId, value: newValue },
  ];
  if (readsAsComplete(previousCellValues, columns)) return;
  if (!readsAsComplete(nextCellValues, columns)) return;

  const finished = await prisma.item.findUnique({
    where: { id: itemId },
    select: { name: true, groupId: true, boardId: true },
  });
  if (!finished) return;

  const groupItems = await prisma.item.findMany({
    where: { boardId: finished.boardId, deletedAt: null },
    select: { id: true, name: true, parentId: true, order: true, groupId: true, cellValues: true },
  });
  const index = buildWbsIndexFromItems(groupItems);
  const dependents = groupItems.filter((candidate) => {
    if (candidate.id === itemId) return false;
    const value = candidate.cellValues.find((cv) => cv.columnId === board.predColumnId)?.value;
    return resolvePredValues(index, candidate.groupId, value).includes(itemId);
  });
  if (dependents.length === 0) return;

  const personColumns = await prisma.column.findMany({
    where: { boardId, type: "PERSON" },
    select: { id: true },
  });
  const personColumnIds = new Set(personColumns.map((c) => c.id));

  for (const dependent of dependents) {
    const recipients = new Set<string>();
    for (const cv of dependent.cellValues) {
      if (personColumnIds.has(cv.columnId)) {
        for (const userId of getPersonIds(cv.value)) recipients.add(userId);
      }
    }
    const assignments = await prisma.assignment.findMany({
      where: { itemId: dependent.id },
      select: { userId: true },
    });
    for (const a of assignments) recipients.add(a.userId);
    recipients.delete(actorId);
    if (recipients.size === 0) continue;

    const message = `前置「${finished.name}」已完成,「${dependent.name}」可以開始執行`;
    const notifiableIds = new Set(
      await filterInAppRecipients(prisma, "UPDATED", Array.from(recipients))
    );
    for (const userId of recipients) {
      // A PERSON cell can name a Resource (a tool or vendor), which has no
      // account to notify — the FK would reject it.
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) continue;
      if (notifiableIds.has(userId)) {
        await prisma.notification.create({
          data: { userId, actorId, type: "UPDATED", itemId: dependent.id, message },
        });
      }
      await notifyEmailIfNeeded(userId, "UPDATED", message);
    }
  }
}
