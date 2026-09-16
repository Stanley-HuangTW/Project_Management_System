import { prisma } from "@/lib/prisma";
import { DEFAULT_ORG_UNITS, type OrgUnit } from "@/lib/orgUnits";

/**
 * 目前設定的組織單位,照排序。
 *
 * 資料表是空的就回預設那六個 —— migration 會種進去,但如果有人把它清光了,
 * 整張人力表跟著變成沒有任何欄位,那比顯示一組預設值難懂得多。
 */
export async function loadOrgUnits(): Promise<OrgUnit[]> {
  const rows = await prisma.orgUnit.findMany({ orderBy: [{ order: "asc" }, { code: "asc" }] });
  return rows.length > 0 ? rows : DEFAULT_ORG_UNITS;
}
