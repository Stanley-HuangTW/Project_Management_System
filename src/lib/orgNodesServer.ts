import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrgNodeLite } from "@/lib/orgTree";

/** 所有部門(含各自對應的人力單位代號,可以好幾個),照畫面上的順序。 */
export async function loadOrgNodes(db: Prisma.TransactionClient = prisma): Promise<OrgNodeLite[]> {
  const rows = await db.orgNode.findMany({
    select: { id: true, name: true, parentId: true, headId: true, order: true, units: { select: { unitCode: true } } },
    orderBy: [{ order: "asc" }, { name: "asc" }],
  });
  return rows.map(({ units, ...node }) => ({ ...node, unitCodes: units.map((u) => u.unitCode).sort() }));
}
