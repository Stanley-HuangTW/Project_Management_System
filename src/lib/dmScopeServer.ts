import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { resolveDmRestriction, type DmRestriction, type DmScopeSettings } from "@/lib/dmScope";

/** 系統設定裡各職能 DM 的可見範圍。沒有那一列的職能 = 都不限。 */
export async function loadDmScopeSettings(): Promise<DmScopeSettings> {
  const rows = await prisma.dmScope.findMany();
  return Object.fromEntries(
    rows.map((r) => [r.discipline, { limitItems: r.limitItems, limitLabour: r.limitLabour, limitBudget: r.limitBudget }])
  );
}

function anyLimit(settings: DmScopeSettings): boolean {
  return Object.values(settings).some((f) => f && (f.limitItems || f.limitLabour || f.limitBudget));
}

/**
 * 這個人在這幾塊看板上被限制的範圍;不受限的看板不在結果裡。
 *
 * 系統設定裡沒有任何職能打開限制(預設就是這樣)時,第一個查詢就回去了,不多花任何查詢。
 */
export async function loadDmRestrictions(
  boardIds: string[],
  session: SessionPayload
): Promise<Map<string, DmRestriction>> {
  const result = new Map<string, DmRestriction>();
  if (boardIds.length === 0 || session.role === "ADMIN") return result;
  const settings = await loadDmScopeSettings();
  if (!anyLimit(settings)) return result;

  const boards = await prisma.board.findMany({
    where: { id: { in: boardIds } },
    select: {
      id: true,
      ownerId: true,
      groups: {
        select: {
          roleAssignments: { select: { userId: true, role: true } },
          members: { select: { userId: true, discipline: true } },
        },
      },
    },
  });
  for (const board of boards) {
    const restriction = resolveDmRestriction({
      userId: session.userId,
      isAdmin: false,
      isBoardOwner: board.ownerId === session.userId,
      roles: board.groups.flatMap((g) => g.roleAssignments).filter((a) => a.userId === session.userId),
      members: board.groups.flatMap((g) => g.members),
      settings,
    });
    if (restriction) result.set(board.id, restriction);
  }
  return result;
}

export async function loadDmRestriction(boardId: string, session: SessionPayload): Promise<DmRestriction | null> {
  return (await loadDmRestrictions([boardId], session)).get(boardId) ?? null;
}

/** 這個人在這塊看板上看不到預算金額(階段預算、NRE 報價單、樣機 BOM)嗎? */
export async function hideBudgetOn(boardId: string, session: SessionPayload): Promise<boolean> {
  return (await loadDmRestriction(boardId, session))?.hideBudget === true;
}
