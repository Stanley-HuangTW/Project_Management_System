import { Prisma } from "@prisma/client";

export const boardWithDataArgs = Prisma.validator<Prisma.BoardDefaultArgs>()({
  include: {
    groups: {
      orderBy: { order: "asc" },
      include: {
        viewers: { select: { userId: true } },
        roleAssignments: { include: { user: { select: { id: true, name: true } } } },
        members: { include: { user: { select: { id: true, name: true } } } },
        resourceMembers: { include: { resource: { select: { id: true, name: true } } } },
      },
    },
    columns: { orderBy: { order: "asc" } },
    items: {
      // Trashed items are off the board entirely — see listTrashedItems.
      where: { deletedAt: null },
      orderBy: { order: "asc" },
      include: {
        cellValues: true,
        viewers: { select: { userId: true } },
        _count: { select: { comments: true } },
        assignments: { include: { user: { select: { id: true, name: true } } } },
      },
    },
  },
});

export type BoardWithData = Prisma.BoardGetPayload<typeof boardWithDataArgs>;
export type GroupData = BoardWithData["groups"][number];
export type ColumnData = BoardWithData["columns"][number];
export type ItemData = BoardWithData["items"][number];
export type CellValueData = ItemData["cellValues"][number];

/** Pred 選單裡的一個選項。code 冠了分組(必要時還有看板)名,因為 WBS
 *  只在它自己的分組樹裡唯一。 */
export type PredOption = { id: string; code: string; name: string };

/** 位在同群組其他看板上的前置。看板甘特圖為它畫一列唯讀的長條,
 *  跨看板那條藍色虛線才有地方接。 */
export type ExternalPredecessor = {
  id: string;
  name: string;
  boardId: string;
  boardName: string;
  groupName: string;
  wbsCode: string;
  /** "YYYY-MM-DD"。對面還沒排日期時是 null —— 那一列仍然要在。 */
  start: string | null;
  end: string | null;
};
export type AssignmentData = ItemData["assignments"][number];

export type UserOption = {
  id: string;
  name: string;
  supervisorId?: string | null;
  avatarUrl?: string | null;
  // Set for entries backed by a Resource (tool/vendor) rather than a real
  // User — they can be a PERSON-column 負責人, but have no account, so
  // anything with a real FK to User (e.g. Gantt Assignments) must exclude them.
  isResource?: boolean;
};
