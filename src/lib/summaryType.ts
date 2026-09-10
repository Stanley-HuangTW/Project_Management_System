import { prisma } from "@/lib/prisma";
import { getStatusOptions } from "@/types/column";

/**
 * Resolves the Task/Summary option ids of the board's Type column (if
 * configured), so a newly created item can default to Task and a newly
 * childed parent can flip to Summary — matching the Type values already
 * used by the Gantt's Milestone/Summary rollup logic.
 */
export async function loadTypeOptionIds(typeColumnId: string | null) {
  if (!typeColumnId) return null;
  const column = await prisma.column.findUnique({ where: { id: typeColumnId }, select: { options: true } });
  if (!column) return null;
  const options = getStatusOptions(column.options);
  return {
    taskId: options.find((o) => o.label === "Task")?.id,
    summaryId: options.find((o) => o.label === "Summary")?.id,
  };
}

/**
 * Forces a parent to Summary now that it has a child, remembering what its
 * Type was first. A parent that was a Milestone, or had no Type at all, would
 * otherwise lose that for good — there is nothing left to read it back from
 * once the cell has been overwritten.
 *
 * Only the first flip is recorded: flipping an already-remembered parent again
 * (a second child) must not overwrite the original value with "Summary".
 */
export async function flipParentToSummary(parentId: string, typeColumnId: string, summaryOptionId: string) {
  const [parent, current] = await Promise.all([
    prisma.item.findUnique({ where: { id: parentId }, select: { typeBeforeSummary: true } }),
    prisma.cellValue.findUnique({
      where: { itemId_columnId: { itemId: parentId, columnId: typeColumnId } },
    }),
  ]);
  const previous = typeof current?.value === "string" ? current.value : null;
  if (parent && parent.typeBeforeSummary === null && previous !== summaryOptionId) {
    // "" records "had no Type", which restore has to be able to tell apart
    // from "never flipped" (null).
    await prisma.item.update({
      where: { id: parentId },
      data: { typeBeforeSummary: previous ?? "" },
    });
  }
  await prisma.cellValue.upsert({
    where: { itemId_columnId: { itemId: parentId, columnId: typeColumnId } },
    create: { itemId: parentId, columnId: typeColumnId, value: summaryOptionId },
    update: { value: summaryOptionId },
  });
}

/** Puts a parent's own Type back once its last child is gone. A parent we
 *  never flipped (imported as a Summary, say) is left exactly as it is —
 *  there is nothing recorded to restore. */
export async function restoreParentTypeIfChildless(parentId: string, typeColumnId: string) {
  const [childCount, parent] = await Promise.all([
    // A trashed child does not keep its parent a Summary.
    prisma.item.count({ where: { parentId, deletedAt: null } }),
    prisma.item.findUnique({ where: { id: parentId }, select: { typeBeforeSummary: true } }),
  ]);
  if (childCount > 0 || !parent || parent.typeBeforeSummary === null) return;

  if (parent.typeBeforeSummary === "") {
    await prisma.cellValue.deleteMany({ where: { itemId: parentId, columnId: typeColumnId } });
  } else {
    await prisma.cellValue.upsert({
      where: { itemId_columnId: { itemId: parentId, columnId: typeColumnId } },
      create: { itemId: parentId, columnId: typeColumnId, value: parent.typeBeforeSummary },
      update: { value: parent.typeBeforeSummary },
    });
  }
  await prisma.item.update({ where: { id: parentId }, data: { typeBeforeSummary: null } });
}
