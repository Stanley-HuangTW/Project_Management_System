import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { canAccessBoard } from "@/lib/boardAccess";
import { boardWithDataArgs, type BoardWithData, type ItemData } from "@/types/board";
import { applyVisibility } from "@/lib/applyVisibility";
import { computeRolledUpDateRange } from "@/lib/gantt";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { computeWbsCodes, compareWbsCodes } from "@/lib/wbs";
import { getStatusOptions } from "@/types/column";
import {
  buildWbsIndexFromItems,
  parsePredEntries,
  type RelationshipType,
} from "@/lib/predecessorLink";
import { computeCriticalPathAcross, type NetworkColumns } from "@/lib/criticalPath";
import { resolveStatusColumn } from "@/lib/dashboard";

/**
 * One row of a 專案群組's combined schedule, flattened and serialisable.
 *
 * Flat rather than a tree because the tree it came from is per board, and the
 * thing worth looking at here is the one timeline all of them share. Dates are
 * ISO strings for the same reason every other client payload is: a Date does
 * not survive the server/client boundary intact.
 */
export type ProgramTask = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  groupName: string;
  /** 排序用 —— 分組的排列順序不能靠名稱。 */
  groupId: string;
  /** Indent within its own board's tree, so the structure is still readable. */
  depth: number;
  /** 它的父項。收合整棵子樹要靠它 —— 用 WBS 前綴去猜會在代號重複時出錯。 */
  parentId: string | null;
  wbsCode: string;
  start: string | null;
  end: string | null;
  isSummary: boolean;
  isMilestone: boolean;
  assigneeNames: string[];
  /** 指派到誰。週報要靠 id 對上部門名冊 —— 名字會重複,而且會改。 */
  assigneeIds: string[];
  /** 狀態欄目前的選項標籤。週報拿它比出「這週狀態變了什麼」。 */
  status: string | null;
  /** Edges INTO this task, already resolved to ids — including the ones that
   *  cross to another board, which is the whole reason this view exists. */
  preds: { predId: string; relationship: RelationshipType | null; crossBoard: boolean }[];
  totalFloat: number | null;
  isCritical: boolean;
  /** Priority 欄目前的選項標籤(CRITICAL/HIGH/NORMAL)。沒綁定欄位或沒選值是 null。 */
  priority: string | null;
};

export type ProgramView = {
  id: string;
  name: string;
  boards: { id: string; name: string; taskCount: number }[];
  tasks: ProgramTask[];
  /** The group's single start and finish — the answer to "when is this
   *  project done?", which no individual board can give on its own. */
  startDate: string | null;
  finishDate: string | null;
  criticalCount: number;
  /** Edges whose two ends sit on different boards. Counted because it is the
   *  measure of whether grouping these boards was worth doing. */
  crossBoardEdgeCount: number;
  /** Boards in the group this session may not open. Named as a count only —
   *  the schedule below leaves them out, and a total that silently excludes
   *  work is worse than one that says so. */
  hiddenBoardCount: number;
};

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 這個項目的狀態標籤。沒有狀態欄、或還沒選,都回 null 而不是編一個字。 */
function statusLabelOf(board: BoardWithData, item: ItemData): string | null {
  const column = resolveStatusColumn(board);
  if (!column) return null;
  const value = item.cellValues.find((cv) => cv.columnId === column.id)?.value;
  if (typeof value !== "string") return null;
  // 選項是 JSON,要走 getStatusOptions 才拿得到形狀 —— 直接 .find 會踩到
  // Prisma 的 JsonValue 聯集。
  return getStatusOptions(column.options).find((o) => o.id === value)?.label ?? null;
}

function networkColumnsOf(board: BoardWithData): NetworkColumns {
  const linkColumn = board.columns.find((c) => c.id === board.linkColumnId);
  return {
    predColumnId: board.predColumnId,
    linkColumnId: board.linkColumnId,
    linkColumnOptions: linkColumn?.options,
    lagColumnId: board.lagColumnId,
    startColumnId: board.ganttStartColumnId,
    durationColumnId: board.ganttDurationColumnId,
    durationMode: board.ganttDurationMode,
  };
}

/**
 * The whole 專案群組 as one schedule.
 *
 * Every board is read through its own columns — a Pred, a Start and a Days
 * column all have different ids on each board — and the critical path is then
 * computed over the combined network, so a task's float is its float against
 * the group's finish rather than its own board's. That is the number that
 * changes: a week of slack inside one board is no slack at all if the next
 * board is waiting on it.
 *
 * Boards this session cannot open are left out entirely rather than partly:
 * a name withheld but a date shown is still a leak.
 */
export async function getProgramView(
  programId: string,
  session: SessionPayload
): Promise<ProgramView | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      id: true,
      name: true,
      boards: { where: { deletedAt: null }, select: { id: true }, orderBy: { name: "asc" } },
    },
  });
  if (!program) return null;

  const holidays = toHolidaySet(await listHolidays());

  const boards: BoardWithData[] = [];
  let hiddenBoardCount = 0;
  for (const { id } of program.boards) {
    if (!(await canAccessBoard(session, id))) {
      hiddenBoardCount += 1;
      continue;
    }
    const board = await prisma.board.findUnique({ where: { id }, ...boardWithDataArgs });
    if (board) boards.push(applyVisibility(board, session));
  }

  const allItems: ItemData[] = boards.flatMap((b) => b.items);
  const boardOf = new Map<string, BoardWithData>();
  for (const board of boards) {
    for (const item of board.items) boardOf.set(item.id, board);
  }

  const floats = computeCriticalPathAcross(
    allItems,
    (item) => {
      const board = boardOf.get(item.id);
      return board ? networkColumnsOf(board) : null;
    },
    holidays
  );

  // WBS codes stay per group — a code is a position in its own group's tree,
  // and a program does not renumber anything.
  const wbsByItemId = new Map<string, string>();
  const byGroup = new Map<string, ItemData[]>();
  for (const item of allItems) byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
  for (const groupItems of byGroup.values()) {
    for (const [id, code] of computeWbsCodes(groupItems)) wbsByItemId.set(id, code);
  }

  const wbsIndex = buildWbsIndexFromItems(allItems);
  const hasChildren = new Set(allItems.map((i) => i.parentId).filter((id): id is string => !!id));

  const depthOf = (item: ItemData): number => {
    let depth = 0;
    let parentId = item.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      depth += 1;
      parentId = allItems.find((i) => i.id === parentId)?.parentId ?? null;
    }
    return depth;
  };

  const tasks: ProgramTask[] = [];
  let crossBoardEdgeCount = 0;

  // 看板 → 分組 → WBS 的排序鍵。分組用它在看板上的排列序號,不是名稱。
  const groupOrderById = new Map<string, number>();
  const boardOrderById = new Map<string, number>();
  boards.forEach((board, index) => {
    boardOrderById.set(board.id, index);
    board.groups.forEach((group, groupIndex) => groupOrderById.set(group.id, groupIndex));
  });

  for (const board of boards) {
    const groupNameById = new Map(board.groups.map((g) => [g.id, g.name]));
    const typeOptions = getStatusOptions(board.columns.find((c) => c.id === board.typeColumnId)?.options);
    const linkOptions = getStatusOptions(board.columns.find((c) => c.id === board.linkColumnId)?.options);
    const priorityOptions = getStatusOptions(
      board.columns.find((c) => c.id === board.priorityColumnId)?.options
    );

    for (const item of board.items) {
      const range =
        board.ganttStartColumnId && board.ganttDurationColumnId
          ? computeRolledUpDateRange(
              item,
              board.items,
              board.ganttStartColumnId,
              board.ganttDurationColumnId,
              board.ganttDurationMode,
              holidays,
              { predColumnId: board.predColumnId }
            )
          : null;

      const typeValue = board.typeColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.typeColumnId)?.value
        : undefined;
      const isMilestone = typeOptions.find((o) => o.id === typeValue)?.label === "Milestone";

      const priorityValue = board.priorityColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.priorityColumnId)?.value
        : undefined;
      const priority = priorityOptions.find((o) => o.id === priorityValue)?.label ?? null;

      const fallbackRelationship = board.linkColumnId
        ? linkOptions.find(
            (o) => o.id === item.cellValues.find((cv) => cv.columnId === board.linkColumnId)?.value
          )?.label
        : undefined;
      const predValue = board.predColumnId
        ? item.cellValues.find((cv) => cv.columnId === board.predColumnId)?.value
        : undefined;
      const preds = parsePredEntries(wbsIndex, item.groupId, predValue)
        .filter((entry) => entry.itemId !== item.id)
        .map((entry) => {
          const label = entry.relationship ?? fallbackRelationship ?? null;
          const crossBoard = boardOf.get(entry.itemId)?.id !== board.id;
          if (crossBoard && boardOf.has(entry.itemId)) crossBoardEdgeCount += 1;
          return {
            predId: entry.itemId,
            relationship: (label as RelationshipType | null) ?? null,
            crossBoard,
          };
        });

      const float = floats.get(item.id);
      tasks.push({
        id: item.id,
        name: item.name,
        boardId: board.id,
        boardName: board.name,
        groupName: groupNameById.get(item.groupId) ?? "",
        groupId: item.groupId,
        depth: depthOf(item),
        parentId: item.parentId,
        wbsCode: wbsByItemId.get(item.id) ?? "",
        start: range ? iso(range.start) : null,
        end: range ? iso(isMilestone ? range.start : range.end) : null,
        isSummary: hasChildren.has(item.id),
        isMilestone,
        assigneeNames: item.assignments.map((a) => a.user.name),
        assigneeIds: item.assignments.map((a) => a.user.id),
        status: statusLabelOf(board, item),
        preds,
        totalFloat: float?.totalFloat ?? null,
        isCritical: float?.isCritical ?? false,
        priority,
      });
    }
  }

  tasks.sort((a, b) => {
    const board = (boardOrderById.get(a.boardId) ?? 0) - (boardOrderById.get(b.boardId) ?? 0);
    if (board !== 0) return board;
    const group = (groupOrderById.get(a.groupId) ?? 0) - (groupOrderById.get(b.groupId) ?? 0);
    if (group !== 0) return group;
    return compareWbsCodes(a.wbsCode, b.wbsCode);
  });

  const dated = tasks.filter((t) => t.start && t.end);
  const startDate = dated.reduce<string | null>(
    (min, t) => (min === null || t.start! < min ? t.start! : min),
    null
  );
  const finishDate = dated.reduce<string | null>(
    (max, t) => (max === null || t.end! > max ? t.end! : max),
    null
  );

  return {
    id: program.id,
    name: program.name,
    boards: boards.map((b) => ({ id: b.id, name: b.name, taskCount: b.items.length })),
    tasks,
    startDate,
    finishDate,
    criticalCount: tasks.filter((t) => t.isCritical && !t.isSummary).length,
    crossBoardEdgeCount,
    hiddenBoardCount,
  };
}
