import { describe, it, expect } from "vitest";
import { accessibleBoardWhere } from "./boardAccess";
import type { SessionPayload } from "./jwt";

const session = (role: SessionPayload["role"]): SessionPayload =>
  ({ userId: "u1", role }) as SessionPayload;

/**
 * 看板垃圾桶 rests on one thing: no board list may show a trashed board. This
 * fragment is what every list uses, so it is the place a regression would
 * show up first — an admin branch that returns {} again would quietly put
 * deleted boards back in the sidebar for exactly the people who delete them.
 */
describe("accessibleBoardWhere", () => {
  it("excludes trashed boards for an admin", () => {
    expect(accessibleBoardWhere(session("ADMIN"))).toEqual({ deletedAt: null });
  });

  it("excludes trashed boards for everyone else too", () => {
    const where = accessibleBoardWhere(session("MEMBER"));
    expect(where.deletedAt).toBeNull();
    // ...and still narrows by visibility, which is the other half of its job.
    expect(where.OR).toEqual([
      { visibility: "PUBLIC" },
      { ownerId: "u1" },
      { members: { some: { userId: "u1" } } },
      { groups: { some: { roleAssignments: { some: { userId: "u1" } } } } },
      { groups: { some: { members: { some: { userId: "u1" } } } } },
    ]);
  });
});
