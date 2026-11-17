"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { assertSafeXlsx } from "@/lib/xlsxGuard";
import { requireIssueManager } from "@/lib/issueServer";
import { casePeriod, formatCaseNo } from "@/lib/issueCase";
import { parseIssueSheet, usableCaseNo, type ImportedCase, type ImportRowError, type ParsedSheet } from "@/lib/issueImport";
import type { IssueOptionKind } from "@/lib/issueOptions";

/** 20MB,跟其他 Excel 匯入上限一致。 */
const MAX_UPLOAD = 20 * 1024 * 1024;

export type IssueImportPreview = {
  sheets: { sheet: string; recognized: boolean; rows: number; errors: number }[];
  total: number;
  /** 檔案裡的 Case No 已經在系統裡 → 這一列略過(重複匯入同一份檔案不會產生重複案件)。 */
  duplicates: number;
  importable: number;
  errors: ImportRowError[];
  newOptions: { kind: IssueOptionKind; names: string[] }[];
};

export type IssueImportResult = { imported: number; skipped: number; createdOptions: number; errors: ImportRowError[] };

async function readSheets(base64: string): Promise<ParsedSheet[]> {
  const buffer = Buffer.from(base64, "base64");
  if (buffer.length === 0) throw new UserError("檔案是空的");
  if (buffer.length > MAX_UPLOAD) throw new UserError("檔案太大了(上限 20 MB)");
  try {
    await assertSafeXlsx(buffer);
    const wb = new ExcelJS.Workbook();
    // @ts-expect-error - exceljs 的 Buffer 型別衝突
    await wb.xlsx.load(buffer);
    return wb.worksheets.map((ws) => {
      const rows: unknown[][] = [];
      ws.eachRow({ includeEmpty: false }, (row, n) => {
        rows[n - 1] = (row.values as unknown[]).slice(1);
      });
      return parseIssueSheet(ws.name, rows);
    });
  } catch (err) {
    if (err instanceof UserError) throw err;
    throw new UserError("無法讀取這個檔案,請確認是 Excel(.xlsx)檔");
  }
}

type OptionPlan = Map<IssueOptionKind, Set<string>>;

/** 檔案裡用到的選項名稱(各類別)。 */
function collectOptionNames(records: ImportedCase[]): OptionPlan {
  const plan: OptionPlan = new Map();
  const add = (kind: IssueOptionKind, name: string | null | undefined) => {
    if (!name) return;
    if (!plan.has(kind)) plan.set(kind, new Set());
    plan.get(kind)!.add(name);
  };
  for (const r of records) {
    add("CUSTOMER", r.customer);
    add("PRODUCT", r.product);
    add("REGION", r.region);
    add("CUSTOMER_TYPE", r.customerType);
    add("WARRANTY", r.warranty);
    add("ERROR_TYPE", r.errorType);
    for (const u of r.units) add("HANDLER_UNIT", u);
    for (const p of r.parts) add("PART", p);
  }
  return plan;
}

async function existingCaseNos(candidates: string[]): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const rows = await prisma.issueCase.findMany({ where: { caseNo: { in: candidates } }, select: { caseNo: true } });
  return new Set(rows.map((r) => r.caseNo));
}

/** 預覽:不寫入任何資料,告訴使用者會匯入幾筆、哪些列有問題、會新增哪些選項。 */
export async function previewIssueImport(base64: string): Promise<IssueImportPreview> {
  await requireIssueManager();
  const sheets = await readSheets(base64);
  const records = sheets.flatMap((s) => s.records);
  const errors = sheets.flatMap((s) => s.errors);
  const claimed = records.map((r) => usableCaseNo(r.caseNo, r.issueDate)?.caseNo).filter((x): x is string => !!x);
  const dbHas = await existingCaseNos(claimed);
  const seen = new Set<string>();
  let duplicates = 0;
  for (const r of records) {
    const c = usableCaseNo(r.caseNo, r.issueDate)?.caseNo;
    if (!c) continue;
    if (dbHas.has(c) || seen.has(c)) duplicates++;
    seen.add(c);
  }

  const plan = collectOptionNames(records);
  const newOptions: IssueImportPreview["newOptions"] = [];
  for (const [kind, names] of plan) {
    const have = await prisma.issueOption.findMany({ where: { kind, name: { in: [...names] } }, select: { name: true } });
    const haveSet = new Set(have.map((h) => h.name));
    const missing = [...names].filter((n) => !haveSet.has(n));
    if (missing.length) newOptions.push({ kind, names: missing });
  }
  return {
    sheets: sheets.map((s) => ({ sheet: s.sheet, recognized: s.recognized, rows: s.records.length, errors: s.errors.length })),
    total: records.length,
    duplicates,
    importable: records.length - duplicates,
    errors: errors.slice(0, 100),
    newOptions,
  };
}

/** 實際匯入:找不到的選項自動新增,Case No 沿用檔案裡的(已存在的略過),沒有的重新產生。整批在一個交易裡,失敗就全部退回。 */
export async function runIssueImport(base64: string): Promise<IssueImportResult> {
  const { userId } = await requireIssueManager();
  const sheets = await readSheets(base64);
  const records = sheets.flatMap((s) => s.records);
  const errors = sheets.flatMap((s) => s.errors);
  if (records.length === 0) throw new UserError(errors.length ? `沒有可以匯入的資料(${errors[0].where}:${errors[0].message})` : "沒有找到可以匯入的案件資料(要有「Customer」與「issue Date」標題的工作表)");

  const plan = collectOptionNames(records);
  let createdOptions = 0;
  let imported = 0;
  let skipped = 0;

  await prisma.$transaction(
    async (tx) => {
      // 選項:一次補齊,之後用名稱查代號。
      const idOf = new Map<string, string>();
      const key = (kind: IssueOptionKind, name: string) => `${kind}\u0000${name}`;
      for (const [kind, names] of plan) {
        const have = await tx.issueOption.findMany({ where: { kind, name: { in: [...names] } }, select: { id: true, name: true } });
        for (const h of have) idOf.set(key(kind, h.name), h.id);
        const max = await tx.issueOption.aggregate({ where: { kind }, _max: { order: true } });
        let order = (max._max.order ?? 0) + 1;
        for (const name of names) {
          if (idOf.has(key(kind, name))) continue;
          const created = await tx.issueOption.create({ data: { kind, name, order: order++ }, select: { id: true } });
          idOf.set(key(kind, name), created.id);
          createdOptions++;
        }
      }
      // 新建的客戶:順便帶上檔案裡的地區與客戶型態當預設。
      for (const r of records) {
        if (!r.customer) continue;
        const cid = idOf.get(key("CUSTOMER", r.customer))!;
        const c = await tx.issueOption.findUnique({ where: { id: cid }, select: { defaultRegionId: true, customerTypeId: true } });
        const data: { defaultRegionId?: string; customerTypeId?: string } = {};
        if (!c?.defaultRegionId && r.region) data.defaultRegionId = idOf.get(key("REGION", r.region));
        if (!c?.customerTypeId && r.customerType) data.customerTypeId = idOf.get(key("CUSTOMER_TYPE", r.customerType));
        if (Object.keys(data).length) await tx.issueOption.update({ where: { id: cid }, data });
      }

      const claimed = records.map((r) => usableCaseNo(r.caseNo, r.issueDate)?.caseNo).filter((x): x is string => !!x);
      const dbHas = new Set((await tx.issueCase.findMany({ where: { caseNo: { in: claimed } }, select: { caseNo: true } })).map((x) => x.caseNo));
      const used = new Set<string>();
      const bump = new Map<string, number>();

      for (const r of records) {
        const claim = usableCaseNo(r.caseNo, r.issueDate);
        if (claim && (dbHas.has(claim.caseNo) || used.has(claim.caseNo))) {
          skipped++;
          continue;
        }
        let caseNo: string;
        if (claim) {
          caseNo = claim.caseNo;
          const period = casePeriod(r.issueDate);
          bump.set(period, Math.max(bump.get(period) ?? 0, claim.seq));
        } else {
          const period = casePeriod(r.issueDate);
          const rows = await tx.$queryRaw<{ last: number }[]>`
            INSERT INTO "IssueCaseCounter" ("period", "last") VALUES (${period}, 1)
            ON CONFLICT ("period") DO UPDATE SET "last" = "IssueCaseCounter"."last" + 1
            RETURNING "last"`;
          caseNo = formatCaseNo(r.issueDate, Number(rows[0].last));
        }
        used.add(caseNo);
        const logAt = new Date(`${r.issueDate}T00:00:00.000Z`);
        await tx.issueCase.create({
          data: {
            caseNo,
            kind: r.kind,
            customerId: r.customer ? idOf.get(key("CUSTOMER", r.customer)) : null,
            productId: r.product ? idOf.get(key("PRODUCT", r.product)) : null,
            regionId: r.region ? idOf.get(key("REGION", r.region)) : null,
            issueDate: r.issueDate,
            serialNo: r.serialNo,
            qrCode: r.qrCode,
            description: r.description,
            behavior: r.behavior,
            warrantyId: r.warranty ? idOf.get(key("WARRANTY", r.warranty)) : null,
            status: r.status,
            closeDate: r.closeDate,
            deckCount: r.deckCount === null ? null : Math.round(r.deckCount),
            cutHours: r.cutHours,
            wheelHours: r.wheelHours,
            errorTypeId: r.errorType ? idOf.get(key("ERROR_TYPE", r.errorType)) : null,
            rma: r.rma,
            rmaCuttingDisk: r.rmaCuttingDisk,
            repairOrderNo: r.repairOrderNo,
            units: { create: r.units.map((u) => ({ optionId: idOf.get(key("HANDLER_UNIT", u))! })) },
            parts: { create: r.parts.map((p, order) => ({ partId: idOf.get(key("PART", p))!, order })) },
            logs: {
              create: [
                ...(r.response ? [{ kind: "RESPONSE" as const, content: r.response, createdAt: logAt }] : []),
                ...(r.arrangement ? [{ kind: "ARRANGEMENT" as const, content: r.arrangement, createdAt: logAt }] : []),
              ],
            },
          },
        });
        imported++;
      }

      // 沿用檔案裡的 Case No 之後,各月流水號至少要到匯入的最大號,新增案件才不會撞號。
      for (const [period, seq] of bump) {
        await tx.$executeRaw`
          INSERT INTO "IssueCaseCounter" ("period", "last") VALUES (${period}, ${seq})
          ON CONFLICT ("period") DO UPDATE SET "last" = GREATEST("IssueCaseCounter"."last", ${seq})`;
      }
    },
    { timeout: 300_000, maxWait: 30_000 }
  );

  await logAudit("SETTINGS", userId, `ISSUE TRACKER 匯入 Excel:${imported} 筆案件(略過 ${skipped} 筆重複、${errors.length} 列有問題)`);
  revalidatePath("/issues", "layout");
  return { imported, skipped, createdOptions, errors: errors.slice(0, 100) };
}
