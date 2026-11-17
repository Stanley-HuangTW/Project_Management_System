"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { requireIssueActor, requireIssueManager } from "@/lib/issueServer";
import { ISSUE_OPTION_KINDS, type IssueOptionDto, type IssueOptionKind } from "@/lib/issueOptions";

const KINDS = ISSUE_OPTION_KINDS.map((k) => k.kind);

type OptionRow = Prisma.IssueOptionGetPayload<{
  include: {
    _count: {
      select: {
        customerCases: true;
        productCases: true;
        regionCases: true;
        warrantyCases: true;
        errorTypeCases: true;
        partUses: true;
        unitUses: true;
        regionOf: true;
        customerTypeOf: true;
      };
    };
  };
}>;

const COUNT_SELECT = {
  customerCases: true,
  productCases: true,
  regionCases: true,
  warrantyCases: true,
  errorTypeCases: true,
  partUses: true,
  unitUses: true,
  regionOf: true,
  customerTypeOf: true,
} as const;

function toDto(o: OptionRow): IssueOptionDto {
  const c = o._count;
  return {
    id: o.id,
    kind: o.kind,
    name: o.name,
    shortName: o.shortName,
    defaultRegionId: o.defaultRegionId,
    customerTypeId: o.customerTypeId,
    active: o.active,
    // 被案件用到、或被客戶當預設地區/型態用到,都不能刪。
    usage:
      c.customerCases + c.productCases + c.regionCases + c.warrantyCases + c.errorTypeCases + c.partUses + c.unitUses + c.regionOf + c.customerTypeOf,
  };
}

/** 案件表單與篩選的下拉:任何有 ISSUE TRACKER 權限的人都能讀。含停用的(舊案件選過的要能顯示),畫面自己決定新選時只列啟用中的。 */
export async function listIssueOptions(): Promise<IssueOptionDto[]> {
  await requireIssueActor();
  const rows = await prisma.issueOption.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: { _count: { select: COUNT_SELECT } },
  });
  return rows.map(toDto);
}

/** 選項管理頁:全部(含停用),只有管理者。 */
export async function listAllIssueOptions(): Promise<IssueOptionDto[]> {
  await requireIssueManager();
  const rows = await prisma.issueOption.findMany({
    orderBy: [{ kind: "asc" }, { order: "asc" }, { name: "asc" }],
    include: { _count: { select: COUNT_SELECT } },
  });
  return rows.map(toDto);
}

export type IssueOptionInput = {
  kind: IssueOptionKind;
  name: string;
  shortName?: string | null;
  defaultRegionId?: string | null;
  customerTypeId?: string | null;
};

async function cleanInput(input: IssueOptionInput) {
  if (!KINDS.includes(input.kind)) throw new UserError("選項類別不正確");
  const name = (input.name ?? "").trim();
  if (!name) throw new UserError("請輸入名稱");
  if (name.length > 200) throw new UserError("名稱太長了(上限 200 字)");
  const shortName = input.kind === "PART" ? (input.shortName ?? "").trim() || null : null;
  let defaultRegionId: string | null = null;
  let customerTypeId: string | null = null;
  if (input.kind === "CUSTOMER") {
    defaultRegionId = input.defaultRegionId || null;
    customerTypeId = input.customerTypeId || null;
    if (defaultRegionId) {
      const r = await prisma.issueOption.findUnique({ where: { id: defaultRegionId }, select: { kind: true } });
      if (r?.kind !== "REGION") throw new UserError("預設地區不正確");
    }
    if (customerTypeId) {
      const t = await prisma.issueOption.findUnique({ where: { id: customerTypeId }, select: { kind: true } });
      if (t?.kind !== "CUSTOMER_TYPE") throw new UserError("客戶型態不正確");
    }
  }
  return { name, shortName, defaultRegionId, customerTypeId };
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function createIssueOption(input: IssueOptionInput): Promise<{ id: string }> {
  const actor = await requireIssueManager();
  const data = await cleanInput(input);
  const max = await prisma.issueOption.aggregate({ where: { kind: input.kind }, _max: { order: true } });
  try {
    const created = await prisma.issueOption.create({ data: { kind: input.kind, ...data, order: (max._max.order ?? 0) + 1 } });
    await logAudit("SETTINGS", actor.userId, `ISSUE TRACKER 新增選項:${input.kind} / ${data.name}`);
    revalidatePath("/issues", "layout");
    return { id: created.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`已經有同名的選項「${data.name}」`);
    throw err;
  }
}

export async function updateIssueOption(id: string, input: IssueOptionInput): Promise<void> {
  const actor = await requireIssueManager();
  const existing = await prisma.issueOption.findUnique({ where: { id }, select: { kind: true, name: true } });
  if (!existing) throw new UserError("找不到這個選項(可能已經被刪除)");
  const data = await cleanInput({ ...input, kind: existing.kind });
  try {
    await prisma.issueOption.update({ where: { id }, data });
    await logAudit("SETTINGS", actor.userId, `ISSUE TRACKER 修改選項:${existing.kind} / ${existing.name}${existing.name !== data.name ? ` → ${data.name}` : ""}`);
    revalidatePath("/issues", "layout");
  } catch (err) {
    if (isUniqueViolation(err)) throw new UserError(`已經有同名的選項「${data.name}」`);
    throw err;
  }
}

/** 停用 / 重新啟用:用過的選項只能停用。停用後新案件的下拉看不到,舊案件照常顯示。 */
export async function setIssueOptionActive(id: string, active: boolean): Promise<void> {
  const actor = await requireIssueManager();
  const existing = await prisma.issueOption.findUnique({ where: { id }, select: { kind: true, name: true } });
  if (!existing) throw new UserError("找不到這個選項(可能已經被刪除)");
  await prisma.issueOption.update({ where: { id }, data: { active } });
  await logAudit("SETTINGS", actor.userId, `ISSUE TRACKER ${active ? "啟用" : "停用"}選項:${existing.kind} / ${existing.name}`);
  revalidatePath("/issues", "layout");
}

/** 刪除:沒有被任何案件(或客戶預設值)用到才能刪;用過的請改用停用。 */
export async function deleteIssueOption(id: string): Promise<void> {
  const actor = await requireIssueManager();
  const row = await prisma.issueOption.findUnique({ where: { id }, include: { _count: { select: COUNT_SELECT } } });
  if (!row) throw new UserError("找不到這個選項(可能已經被刪除)");
  const dto = toDto(row);
  if (dto.usage > 0) throw new UserError(`「${row.name}」已經被 ${dto.usage} 處用到,不能刪除,請改用停用`);
  try {
    await prisma.issueOption.delete({ where: { id } });
  } catch (err) {
    // 檢查之後、刪除之前剛好有人用了它:資料庫的 Restrict 會擋下來。
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new UserError(`「${row.name}」剛剛被用到了,不能刪除,請改用停用`);
    }
    throw err;
  }
  await logAudit("SETTINGS", actor.userId, `ISSUE TRACKER 刪除選項:${row.kind} / ${row.name}`);
  revalidatePath("/issues", "layout");
}
