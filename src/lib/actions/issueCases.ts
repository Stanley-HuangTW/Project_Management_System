"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/activityLog";
import { UserError } from "@/lib/userError";
import { requireIssueActor } from "@/lib/issueServer";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { taipeiTodayIso } from "@/lib/timesheet";
import {
  canAddLog,
  canClaimCase,
  canConfirmCase,
  canEditHandlingFields,
  canEditReportFields,
  canManageIssues,
  type IssueRole,
} from "@/lib/issueAccess";
import { casePeriod, formatCaseNo, isIsoDate, isResolvedStatus, ISSUE_STATUS_LABELS, openDays, processingDays, type IssueDayMode } from "@/lib/issueCase";
import { issueDayModeSetting } from "@/lib/issueSettingsServer";
import { notifyIssueAssigned } from "@/lib/issueNotify";
import {
  ISSUE_PAGE_SIZE,
  type IssueCaseDetail,
  type IssueCaseInput,
  type IssueCaseRow,
  type IssueFilters,
  type IssueLogKind,
  type IssueUserDto,
} from "@/lib/issueTypes";

type Tx = Prisma.TransactionClient;

/** 新增一個案件的流水號:每個月一列計數器,INSERT … ON CONFLICT DO UPDATE … RETURNING 在資料庫裡原子加一(列鎖),並發不會拿到同一號。 */
async function nextSequence(tx: Tx, period: string): Promise<number> {
  const rows = await tx.$queryRaw<{ last: number }[]>`
    INSERT INTO "IssueCaseCounter" ("period", "last") VALUES (${period}, 1)
    ON CONFLICT ("period") DO UPDATE SET "last" = "IssueCaseCounter"."last" + 1
    RETURNING "last"`;
  return Number(rows[0].last);
}

function factsOf(c: { reporterId: string | null; confirmedAt: Date | null; assignees: { userId: string }[] }) {
  return { reporterId: c.reporterId, assigneeIds: c.assignees.map((a) => a.userId), locked: c.confirmedAt !== null };
}

async function dayContext() {
  const [mode, holidays] = await Promise.all([issueDayModeSetting(), listHolidays()]);
  return { mode, holidays: toHolidaySet(holidays), today: taipeiTodayIso() };
}

function dayFields(c: { issueDate: string; closeDate: string | null; status: string }, ctx: { mode: IssueDayMode; holidays: Set<string>; today: string }) {
  const resolved = c.status === "TC" || c.status === "PC" || c.status === "NA";
  return {
    days: processingDays(c.issueDate, c.closeDate, ctx.mode, ctx.holidays),
    openDays: resolved ? null : openDays(c.issueDate, ctx.today, ctx.mode, ctx.holidays),
  };
}

/** 有 ISSUE TRACKER 權限的使用者(負責人下拉、篩選用)。 */
export async function listIssueUsers(): Promise<IssueUserDto[]> {
  await requireIssueActor();
  const users = await prisma.user.findMany({
    where: { OR: [{ role: "ADMIN" }, { issueRole: { not: null } }] },
    select: { id: true, name: true, role: true, issueRole: true },
    orderBy: { order: "asc" },
  });
  return users.map((u) => ({ id: u.id, name: u.name, issueRole: u.role === "ADMIN" ? "MANAGER" : u.issueRole }));
}

// ── 列表 ──────────────────────────────────────────────────────────────

function buildWhere(filters: IssueFilters, userId: string): Prisma.IssueCaseWhereInput {
  const and: Prisma.IssueCaseWhereInput[] = [{ deletedAt: null }];
  const q = filters.q?.trim();
  if (q) {
    and.push({
      OR: [
        { caseNo: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { behavior: { contains: q, mode: "insensitive" } },
        { qrCode: { contains: q, mode: "insensitive" } },
        { serialNo: { contains: q, mode: "insensitive" } },
        { repairOrderNo: { contains: q, mode: "insensitive" } },
        { customer: { name: { contains: q, mode: "insensitive" } } },
        { logs: { some: { content: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  if (filters.statuses?.length) and.push({ status: { in: filters.statuses } });
  if (filters.kind) and.push({ kind: filters.kind });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.productId) and.push({ productId: filters.productId });
  if (filters.customerId) and.push({ customerId: filters.customerId });
  if (filters.errorTypeId) and.push({ errorTypeId: filters.errorTypeId });
  if (filters.unitId) and.push({ units: { some: { optionId: filters.unitId } } });
  if (filters.assigneeId) and.push({ assignees: { some: { userId: filters.assigneeId } } });
  if (filters.unassigned) and.push({ assignees: { none: {} } });
  if (filters.mine) and.push({ OR: [{ reporterId: userId }, { assignees: { some: { userId } } }] });
  if (filters.from && isIsoDate(filters.from)) and.push({ issueDate: { gte: filters.from } });
  if (filters.to && isIsoDate(filters.to)) and.push({ issueDate: { lte: filters.to } });
  return { AND: and };
}

const ROW_INCLUDE = {
  customer: { select: { name: true } },
  product: { select: { name: true } },
  region: { select: { name: true } },
  errorType: { select: { name: true } },
  reporter: { select: { name: true } },
  assignees: { select: { user: { select: { id: true, name: true } } } },
  units: { select: { option: { select: { name: true } } } },
} satisfies Prisma.IssueCaseInclude;

type RowSource = Prisma.IssueCaseGetPayload<{ include: typeof ROW_INCLUDE }>;

function toRow(c: RowSource, ctx: { mode: IssueDayMode; holidays: Set<string>; today: string }): IssueCaseRow {
  return {
    id: c.id,
    caseNo: c.caseNo,
    kind: c.kind,
    priority: c.priority,
    issueDate: c.issueDate,
    closeDate: c.closeDate,
    status: c.status,
    customer: c.customer?.name ?? null,
    product: c.product?.name ?? null,
    region: c.region?.name ?? null,
    errorType: c.errorType?.name ?? null,
    assignees: c.assignees.map((a) => a.user),
    units: c.units.map((u) => u.option.name),
    ...dayFields(c, ctx),
    locked: c.confirmedAt !== null,
    rma: c.rma,
    reporterName: c.reporter?.name ?? null,
  };
}

export async function listIssueCases(filters: IssueFilters): Promise<{ rows: IssueCaseRow[]; total: number; page: number; pageSize: number }> {
  const { userId } = await requireIssueActor();
  const where = buildWhere(filters, userId);
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const [total, rows, ctx] = await Promise.all([
    prisma.issueCase.count({ where }),
    prisma.issueCase.findMany({
      where,
      include: ROW_INCLUDE,
      orderBy: [{ issueDate: "desc" }, { caseNo: "desc" }],
      skip: (page - 1) * ISSUE_PAGE_SIZE,
      take: ISSUE_PAGE_SIZE,
    }),
    dayContext(),
  ]);
  return { rows: rows.map((r) => toRow(r, ctx)), total, page, pageSize: ISSUE_PAGE_SIZE };
}

// ── 單一案件 ──────────────────────────────────────────────────────────

const DETAIL_INCLUDE = {
  assignees: { select: { userId: true } },
  units: { select: { optionId: true } },
  parts: { select: { partId: true }, orderBy: { order: "asc" } },
  reporter: { select: { name: true } },
  confirmedBy: { select: { name: true } },
  logs: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
  attachments: { orderBy: { createdAt: "asc" }, include: { uploader: { select: { name: true } } } },
} satisfies Prisma.IssueCaseInclude;

type DetailSource = Prisma.IssueCaseGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toDetail(c: DetailSource, role: IssueRole, userId: string, ctx: { mode: IssueDayMode; holidays: Set<string>; today: string }): IssueCaseDetail {
  const facts = factsOf(c);
  return {
    id: c.id,
    caseNo: c.caseNo,
    kind: c.kind,
    priority: c.priority,
    customerId: c.customerId,
    productId: c.productId,
    regionId: c.regionId,
    issueDate: c.issueDate,
    serialNo: c.serialNo,
    qrCode: c.qrCode,
    description: c.description,
    behavior: c.behavior,
    warrantyId: c.warrantyId,
    status: c.status,
    closeDate: c.closeDate,
    deckCount: c.deckCount,
    cutHours: c.cutHours === null ? null : Number(c.cutHours),
    wheelHours: c.wheelHours === null ? null : Number(c.wheelHours),
    errorTypeId: c.errorTypeId,
    rma: c.rma,
    rmaCuttingDisk: c.rmaCuttingDisk,
    repairOrderNo: c.repairOrderNo,
    assigneeIds: facts.assigneeIds,
    unitIds: c.units.map((u) => u.optionId),
    partIds: c.parts.map((p) => p.partId),
    reporterId: c.reporterId,
    reporterName: c.reporter?.name ?? null,
    confirmedAt: c.confirmedAt?.toISOString() ?? null,
    confirmedByName: c.confirmedBy?.name ?? null,
    createdAt: c.createdAt.toISOString(),
    firstResponseAt: c.firstResponseAt?.toISOString() ?? null,
    ...dayFields(c, ctx),
    dayMode: ctx.mode,
    logs: c.logs.map((l) => ({
      id: l.id,
      kind: l.kind,
      content: l.content,
      authorId: l.authorId,
      authorName: l.author?.name ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
    attachments: c.attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      url: a.isLink ? a.url : `/api/issue-attachments/${a.id}`,
      size: a.size,
      isLink: a.isLink,
      uploaderName: a.uploader?.name ?? null,
      createdAt: a.createdAt.toISOString(),
    })),
    can: {
      editReport: canEditReportFields(role, userId, facts),
      editHandling: canEditHandlingFields(role, userId, facts),
      addLog: canAddLog(role, userId, facts),
      confirm: canConfirmCase(role, userId, { ...facts, status: c.status }),
      claim: canClaimCase(role, facts),
      manage: canManageIssues(role),
    },
  };
}

export async function getIssueCase(id: string): Promise<IssueCaseDetail | null> {
  const { role, userId } = await requireIssueActor();
  const [c, ctx] = await Promise.all([
    prisma.issueCase.findFirst({ where: { id, deletedAt: null }, include: DETAIL_INCLUDE }),
    dayContext(),
  ]);
  return c ? toDetail(c, role, userId, ctx) : null;
}

async function loadCaseForWrite(id: string) {
  const c = await prisma.issueCase.findFirst({
    where: { id, deletedAt: null },
    include: { assignees: { select: { userId: true } }, units: { select: { optionId: true } }, parts: { select: { partId: true }, orderBy: { order: "asc" } } },
  });
  if (!c) throw new UserError("找不到這個案件(可能已經被刪除)");
  return c;
}

// ── 欄位驗證 ──────────────────────────────────────────────────────────

const KINDS = ["REPAIR", "ISSUE"];
const STATUSES = ["OPEN", "TC", "PC", "NA"];
const PRIORITIES = ["P0", "P1", "P2", "P3"];

function trimText(v: unknown, max: number, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max) throw new UserError(`${label}太長了(上限 ${max} 字)`);
  return s;
}

function numOrNull(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 99_999_999) throw new UserError(`${label}不正確`);
  return n;
}

/**
 * 整理並驗證送來的欄位。智慧必填:共同必填客戶、機型、發生日期;維修(Repair)再加機器的 QR code 或序號,
 * 問題(Issue)必須有描述。選項代號是畫面傳來的,逐一確認存在、類別正確、(新增時)仍是啟用中。
 */
async function cleanCaseInput(input: IssueCaseInput, existing: { optionIds: Set<string> } | null) {
  if (!KINDS.includes(input.kind)) throw new UserError("類型不正確");
  if (!STATUSES.includes(input.status)) throw new UserError("狀態不正確");
  if (!PRIORITIES.includes(input.priority)) throw new UserError("優先級不正確");
  if (!isIsoDate(input.issueDate)) throw new UserError("請輸入正確的發生日期");
  if (input.closeDate && !isIsoDate(input.closeDate)) throw new UserError("結案日期不正確");
  if (input.closeDate && input.closeDate < input.issueDate) throw new UserError("結案日期不能早於發生日期");

  const description = trimText(input.description, 20000, "問題描述");
  const behavior = trimText(input.behavior, 20000, "規格與行為");
  const serialNo = trimText(input.serialNo, 100, "機器序號");
  const qrCode = trimText(input.qrCode, 100, "QR code");
  const repairOrderNo = trimText(input.repairOrderNo, 100, "維修單號");

  if (!input.customerId) throw new UserError("請選擇客戶");
  if (!input.productId) throw new UserError("請選擇產品型號");
  if (input.kind === "REPAIR" && !qrCode && !serialNo) throw new UserError("維修案件請填機器的 QR code 或序號");
  if (input.kind === "ISSUE" && !description) throw new UserError("問題案件請填問題描述");

  // 一次查出所有被引用的選項,驗證類別。
  const ids = [
    input.customerId,
    input.productId,
    input.regionId,
    input.warrantyId,
    input.errorTypeId,
    ...input.unitIds,
    ...input.partIds,
  ].filter((x): x is string => !!x);
  const found = await prisma.issueOption.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true, active: true, name: true } });
  const byId = new Map(found.map((o) => [o.id, o]));
  const expect = (id: string | null, kind: string, label: string) => {
    if (!id) return;
    const o = byId.get(id);
    if (!o || o.kind !== kind) throw new UserError(`${label}選項不正確`);
    // 停用的選項:舊案件原本選的可以保留,不能新選。
    if (!o.active && !existing?.optionIds.has(id)) throw new UserError(`「${o.name}」已停用,請改選其他${label}`);
  };
  expect(input.customerId, "CUSTOMER", "客戶");
  expect(input.productId, "PRODUCT", "產品型號");
  expect(input.regionId, "REGION", "地區");
  expect(input.warrantyId, "WARRANTY", "保固狀態");
  expect(input.errorTypeId, "ERROR_TYPE", "問題類型");
  for (const id of input.unitIds) expect(id, "HANDLER_UNIT", "處理單位");
  for (const id of input.partIds) expect(id, "PART", "更換零件");

  const assigneeIds = [...new Set(input.assigneeIds)];
  if (assigneeIds.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: assigneeIds }, OR: [{ role: "ADMIN" }, { issueRole: { not: null } }] },
      select: { id: true },
    });
    if (users.length !== assigneeIds.length) throw new UserError("負責人必須是有 ISSUE TRACKER 權限的使用者");
  }

  // 解決(TC/PC)就要有結案日期:沒填就用今天;重新打開(OPEN)就清掉。
  let closeDate = input.closeDate || null;
  if (isResolvedStatus(input.status) && !closeDate) closeDate = taipeiTodayIso();
  if (input.status === "OPEN") closeDate = null;

  const deckCount = numOrNull(input.deckCount, "刀盤升降次數");

  return {
    kind: input.kind,
    priority: input.priority,
    customerId: input.customerId,
    productId: input.productId,
    regionId: input.regionId || null,
    issueDate: input.issueDate,
    serialNo: serialNo || null,
    qrCode: qrCode || null,
    description,
    behavior,
    warrantyId: input.warrantyId || null,
    status: input.status,
    closeDate,
    deckCount: deckCount === null ? null : Math.round(deckCount),
    cutHours: numOrNull(input.cutHours, "割草時數"),
    wheelHours: numOrNull(input.wheelHours, "行走時數"),
    errorTypeId: input.errorTypeId || null,
    rma: !!input.rma,
    rmaCuttingDisk: !!input.rmaCuttingDisk,
    repairOrderNo: repairOrderNo || null,
    unitIds: [...new Set(input.unitIds)],
    partIds: input.partIds,
    assigneeIds,
  };
}

// ── 新增 ──────────────────────────────────────────────────────────────

/**
 * 回報一個新案件。Case No 自動產生(CS + 發生日期 + 當月流水號),在同一個交易裡取號與寫入:
 * 寫入失敗連計數器一起退回,不會留下空號;caseNo 還有資料庫唯一索引當最後一道保險,萬一撞號就重取。
 * 回報人沒有「處理」的權限,處理欄位(狀態、零件、RMA…)一律用預設值,由處理人之後補。
 */
export async function createIssueCase(input: IssueCaseInput): Promise<{ id: string; caseNo: string }> {
  const { role, userId } = await requireIssueActor();
  const data = await cleanCaseInput(input, null);
  const handling = role === "MANAGER" || role === "HANDLER";
  const canAssign = role === "MANAGER";
  const handlingData = handling
    ? { status: data.status, closeDate: data.closeDate, deckCount: data.deckCount, cutHours: data.cutHours, wheelHours: data.wheelHours, errorTypeId: data.errorTypeId, rma: data.rma, rmaCuttingDisk: data.rmaCuttingDisk, repairOrderNo: data.repairOrderNo }
    : { status: "OPEN" as const, closeDate: null, deckCount: null, cutHours: null, wheelHours: null, errorTypeId: null, rma: false, rmaCuttingDisk: false, repairOrderNo: null };
  const unitIds = handling ? data.unitIds : [];
  const partIds = handling ? data.partIds : [];
  // 處理人自己新增的案件,預設就是自己負責(不然沒人負責的案件別人也能接手,有點怪)。
  const assigneeIds = canAssign ? data.assigneeIds : role === "HANDLER" ? [userId] : [];

  for (let attempt = 0; ; attempt++) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const seq = await nextSequence(tx, casePeriod(data.issueDate));
        const caseNo = formatCaseNo(data.issueDate, seq);
        return tx.issueCase.create({
          data: {
            caseNo,
            kind: data.kind,
            priority: data.priority,
            customerId: data.customerId,
            productId: data.productId,
            regionId: data.regionId,
            issueDate: data.issueDate,
            serialNo: data.serialNo,
            qrCode: data.qrCode,
            description: data.description,
            behavior: data.behavior,
            warrantyId: data.warrantyId,
            ...handlingData,
            reporterId: userId,
            assignees: { create: assigneeIds.map((id) => ({ userId: id })) },
            units: { create: unitIds.map((optionId) => ({ optionId })) },
            parts: { create: partIds.map((partId, order) => ({ partId, order })) },
          },
          select: { id: true, caseNo: true, description: true },
        });
      });
      await logAudit("SETTINGS", userId, `ISSUE TRACKER 新增案件 ${created.caseNo}`);
      await notifyIssueAssigned(created, assigneeIds, userId);
      revalidatePath("/issues", "layout");
      return { id: created.id, caseNo: created.caseNo };
    } catch (err) {
      const unique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (unique && attempt < 4) continue; // 號碼被別的來源(匯入)佔了:交易已退回,重新取下一號。
      throw err;
    }
  }
}

// ── 修改 ──────────────────────────────────────────────────────────────

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export async function updateIssueCase(id: string, input: IssueCaseInput): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const existing = await loadCaseForWrite(id);
  const facts = factsOf(existing);
  const optionIds = new Set(
    [existing.customerId, existing.productId, existing.regionId, existing.warrantyId, existing.errorTypeId, ...existing.units.map((u) => u.optionId), ...existing.parts.map((p) => p.partId)].filter((x): x is string => !!x)
  );
  const data = await cleanCaseInput(input, { optionIds });

  const reportChanged =
    data.kind !== existing.kind ||
    data.priority !== existing.priority ||
    data.customerId !== existing.customerId ||
    data.productId !== existing.productId ||
    data.regionId !== existing.regionId ||
    data.issueDate !== existing.issueDate ||
    data.serialNo !== existing.serialNo ||
    data.qrCode !== existing.qrCode ||
    data.description !== existing.description ||
    data.behavior !== existing.behavior ||
    data.warrantyId !== existing.warrantyId;
  const handlingChanged =
    data.status !== existing.status ||
    data.closeDate !== existing.closeDate ||
    data.deckCount !== existing.deckCount ||
    data.cutHours !== (existing.cutHours === null ? null : Number(existing.cutHours)) ||
    data.wheelHours !== (existing.wheelHours === null ? null : Number(existing.wheelHours)) ||
    data.errorTypeId !== existing.errorTypeId ||
    data.rma !== existing.rma ||
    data.rmaCuttingDisk !== existing.rmaCuttingDisk ||
    data.repairOrderNo !== existing.repairOrderNo ||
    !sameSet(data.unitIds, existing.units.map((u) => u.optionId)) ||
    data.partIds.join() !== existing.parts.map((p) => p.partId).join();
  const assigneesChanged = !sameSet(data.assigneeIds, facts.assigneeIds);

  if (existing.confirmedAt && role !== "MANAGER") throw new UserError("這個案件已經確認完成並鎖定,只有管理者可以修改");
  if (reportChanged && !canEditReportFields(role, userId, facts)) throw new UserError("權限不足:你不能修改這個案件的回報內容");
  if (handlingChanged && !canEditHandlingFields(role, userId, facts)) throw new UserError("權限不足:你不能修改這個案件的處理內容");
  if (assigneesChanged && !canManageIssues(role)) throw new UserError("權限不足:只有管理者可以改負責人");

  const logs: string[] = [];
  if (data.status !== existing.status) logs.push(`狀態:${ISSUE_STATUS_LABELS[existing.status]} → ${ISSUE_STATUS_LABELS[data.status]}`);
  if (data.priority !== existing.priority) logs.push(`優先級:${existing.priority} → ${data.priority}`);
  if (data.closeDate !== existing.closeDate && data.status === existing.status) logs.push(`結案日期:${existing.closeDate ?? "(無)"} → ${data.closeDate ?? "(無)"}`);

  await prisma.$transaction(async (tx) => {
    await tx.issueCase.update({
      where: { id },
      data: {
        kind: data.kind,
        priority: data.priority,
        customerId: data.customerId,
        productId: data.productId,
        regionId: data.regionId,
        issueDate: data.issueDate,
        serialNo: data.serialNo,
        qrCode: data.qrCode,
        description: data.description,
        behavior: data.behavior,
        warrantyId: data.warrantyId,
        status: data.status,
        closeDate: data.closeDate,
        deckCount: data.deckCount,
        cutHours: data.cutHours,
        wheelHours: data.wheelHours,
        errorTypeId: data.errorTypeId,
        rma: data.rma,
        rmaCuttingDisk: data.rmaCuttingDisk,
        repairOrderNo: data.repairOrderNo,
      },
    });
    if (handlingChanged) {
      await tx.issueCaseUnit.deleteMany({ where: { caseId: id } });
      await tx.issueCaseUnit.createMany({ data: data.unitIds.map((optionId) => ({ caseId: id, optionId })) });
      await tx.issueCasePart.deleteMany({ where: { caseId: id } });
      await tx.issueCasePart.createMany({ data: data.partIds.map((partId, order) => ({ caseId: id, partId, order })) });
    }
    if (assigneesChanged) {
      await tx.issueAssignee.deleteMany({ where: { caseId: id } });
      await tx.issueAssignee.createMany({ data: data.assigneeIds.map((uid) => ({ caseId: id, userId: uid })) });
    }
    for (const content of logs) await tx.issueLog.create({ data: { caseId: id, kind: "NOTE", content, authorId: userId } });
  });

  if (assigneesChanged) {
    const added = data.assigneeIds.filter((uid) => !facts.assigneeIds.includes(uid));
    await notifyIssueAssigned({ id, caseNo: existing.caseNo, description: data.description }, added, userId);
  }
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 修改案件 ${existing.caseNo}`);
  revalidatePath("/issues", "layout");
}

// ── 時間軸 ────────────────────────────────────────────────────────────

const LOG_KINDS: IssueLogKind[] = ["RESPONSE", "ARRANGEMENT", "SOLUTION", "NOTE"];

export async function addIssueLog(caseId: string, kind: IssueLogKind, content: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const c = await loadCaseForWrite(caseId);
  if (!canAddLog(role, userId, factsOf(c))) throw new UserError("權限不足:這個案件已經鎖定,你不能再留言");
  if (!LOG_KINDS.includes(kind)) throw new UserError("類型不正確");
  const text = trimText(content, 20000, "內容");
  if (!text) throw new UserError("請輸入內容");
  await prisma.$transaction(async (tx) => {
    await tx.issueLog.create({ data: { caseId, kind, content: text, authorId: userId } });
    // 第一筆回應 / 安排 / 解決方案就是「首次回覆」。
    if (!c.firstResponseAt && kind !== "NOTE") await tx.issueCase.update({ where: { id: caseId }, data: { firstResponseAt: new Date() } });
    await tx.issueCase.update({ where: { id: caseId }, data: { updatedAt: new Date() } });
  });
  revalidatePath("/issues", "layout");
}

export async function deleteIssueLog(logId: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const log = await prisma.issueLog.findUnique({ where: { id: logId }, include: { case: { include: { assignees: { select: { userId: true } } } } } });
  if (!log || log.case.deletedAt) throw new UserError("找不到這則留言(可能已經被刪除)");
  const isOwn = log.authorId === userId;
  if (role !== "MANAGER" && !(isOwn && !log.case.confirmedAt)) throw new UserError("權限不足:只有管理者或留言的人(案件未鎖定時)可以刪除");
  await prisma.issueLog.delete({ where: { id: logId } });
  revalidatePath("/issues", "layout");
}

// ── 指派 / 確認 / 刪除 ────────────────────────────────────────────────

/** 處理人接手還沒人負責的案件。 */
export async function claimIssueCase(caseId: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const c = await loadCaseForWrite(caseId);
  if (!canClaimCase(role, factsOf(c))) throw new UserError("這個案件已經有人負責,或你不能接手");
  await prisma.$transaction([
    prisma.issueAssignee.create({ data: { caseId, userId } }),
    prisma.issueLog.create({ data: { caseId, kind: "NOTE", content: "接手負責這個案件", authorId: userId } }),
  ]);
  revalidatePath("/issues", "layout");
}

/**
 * 確認案件完成並鎖定。案件要已經是「暫時解決」或「永久解決」;由管理者或原回報人確認。
 * 鎖定後回報人不能改,負責的處理人還能補時間軸,管理者可以改全部或解除鎖定。
 */
export async function confirmIssueCase(caseId: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  const c = await loadCaseForWrite(caseId);
  if (!canConfirmCase(role, userId, { ...factsOf(c), status: c.status })) {
    throw new UserError(c.status === "OPEN" || c.status === "NA" ? "案件要先標為「暫時解決」或「永久解決」才能確認完成" : "權限不足:只有管理者或回報人可以確認完成");
  }
  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: caseId }, data: { confirmedAt: new Date(), confirmedById: userId } }),
    prisma.issueLog.create({ data: { caseId, kind: "NOTE", content: "確認完成,案件已鎖定", authorId: userId } }),
  ]);
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 確認案件完成 ${c.caseNo}`);
  revalidatePath("/issues", "layout");
}

/** 解除鎖定(只有管理者):案件回到可編輯,狀態維持不變,由管理者自行調整。 */
export async function unlockIssueCase(caseId: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  if (!canManageIssues(role)) throw new UserError("權限不足:只有管理者可以解除鎖定");
  const c = await loadCaseForWrite(caseId);
  if (!c.confirmedAt) throw new UserError("這個案件沒有鎖定");
  await prisma.$transaction([
    prisma.issueCase.update({ where: { id: caseId }, data: { confirmedAt: null, confirmedById: null } }),
    prisma.issueLog.create({ data: { caseId, kind: "NOTE", content: "解除鎖定", authorId: userId } }),
  ]);
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 解除案件鎖定 ${c.caseNo}`);
  revalidatePath("/issues", "layout");
}

/** 刪除案件(軟刪除,Case No 保留不再使用):只有管理者。 */
export async function deleteIssueCase(caseId: string): Promise<void> {
  const { role, userId } = await requireIssueActor();
  if (!canManageIssues(role)) throw new UserError("權限不足:只有管理者可以刪除案件");
  const c = await loadCaseForWrite(caseId);
  await prisma.issueCase.update({ where: { id: caseId }, data: { deletedAt: new Date() } });
  await logAudit("SETTINGS", userId, `ISSUE TRACKER 刪除案件 ${c.caseNo}`);
  revalidatePath("/issues", "layout");
}
