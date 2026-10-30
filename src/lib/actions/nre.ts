"use server";

import type { NreCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requireBoardAccess } from "@/lib/boardAccess";
import { hideBudgetOn } from "@/lib/budgetAccessServer";
import { logAudit } from "@/lib/activityLog";
import { canEditBudget } from "@/lib/actions/budget";
import { buildNreWorkbook, parseNreWorkbook } from "@/lib/export/nreWorkbook";
import { taipeiTodayIso } from "@/lib/timesheet";
import {
  MAX_NRE_LINES_PER_PHASE,
  NRE_LABELS,
  WHOLE_PROJECT_LABEL,
  describeNreChange,
  planNreImport,
  resolveNreAmount,
  summarizeNreByPhase,
  type NreProjectSummary,
  validateNreLine,
  type NreCategoryKey,
  type NreLineInput,
} from "@/lib/nre";

/**
 * NRE 報價單。
 *
 * 一般的列掛在預算階段上;委託開發那一類可以不掛階段(涵蓋整個專案)。看得到這個看板的人都看得到;
 * 編輯的權限跟預算一樣(管理者、看板擁有者、該看板任一分組的 Team Leader)。
 * 這裡的金額是估算與報價的依據,不會寫進核准預算。
 * 驗證不過、沒權限一律用回傳值帶回去(伺服器動作丟出的訊息在正式環境會被遮掉)。
 */

export type NreLineRow = {
  id: string;
  category: NreCategoryKey;
  /** 掛在哪個階段;null = 涵蓋整個專案。 */
  phaseId: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string;
  basis: string;
  vendor: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  note: string;
};

export type NrePhase = { id: string; name: string };

export type NreSheet = {
  boardId: string;
  phaseName: string;
  /** 這個看板的所有階段,委託開發的「範圍」下拉要用。 */
  phases: NrePhase[];
  /** 這個階段的列,加上涵蓋整個專案的委託開發。 */
  lines: NreLineRow[];
  canEdit: boolean;
};

export type NreProject = {
  boardId: string;
  phases: NrePhase[];
  summary: NreProjectSummary;
  /** 整個專案的委託開發(各個階段的與涵蓋整個專案的),唯讀的明細。 */
  commissioned: NreLineRow[];
};

function toRow(l: {
  id: string;
  category: NreCategory;
  phaseId: string | null;
  startDate: string | null;
  endDate: string | null;
  description: string;
  basis: string | null;
  vendor: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  note: string | null;
}): NreLineRow {
  return {
    id: l.id,
    category: l.category,
    phaseId: l.phaseId,
    startDate: l.startDate,
    endDate: l.endDate,
    description: l.description,
    basis: l.basis ?? "",
    vendor: l.vendor ?? "",
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    amount: l.amount,
    note: l.note ?? "",
  };
}

const LINE_ORDER = [{ category: "asc" as const }, { order: "asc" as const }, { createdAt: "asc" as const }];

/** 這個看板的編輯權(跟預算一樣):用它的任何一個階段問 canEditBudget——那條規則問的是看板,不是階段。 */
async function boardEditRight(boardId: string, session: Awaited<ReturnType<typeof requireSession>>): Promise<boolean> {
  const anyPhase = await prisma.budgetPhase.findFirst({ where: { boardId }, select: { id: true } });
  return anyPhase ? canEditBudget({ kind: "phase", id: anyPhase.id }, session) : false;
}

/**
 * 整個專案的 NRE(唯讀的合計,加上委託開發的明細)。看得到這個看板的人都看得到。
 * 一般的列要編輯、匯入、匯出請選單一階段。
 */
export async function getNreProject(boardId: string): Promise<NreProject | null> {
  const session = await requireSession();
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true } });
  if (!board) return null;
  await requireBoardAccess(boardId, session);
  if (await hideBudgetOn(boardId, session)) return null;
  const [phases, groups, commissioned] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.nreLine.groupBy({ by: ["phaseId", "category"], where: { boardId }, _sum: { amount: true } }),
    prisma.nreLine.findMany({ where: { boardId, category: "COMMISSIONED" }, orderBy: LINE_ORDER }),
  ]);
  return {
    boardId,
    phases,
    summary: summarizeNreByPhase(
      phases,
      groups.map((g) => ({ phaseId: g.phaseId, category: g.category, amount: g._sum.amount ?? 0 }))
    ),
    commissioned: commissioned.map(toRow),
  };
}

export async function getNreSheet(phaseId: string): Promise<NreSheet | null> {
  const session = await requireSession();
  const phase = await prisma.budgetPhase.findUnique({ where: { id: phaseId }, select: { name: true, boardId: true } });
  if (!phase) return null;
  await requireBoardAccess(phase.boardId, session);
  if (await hideBudgetOn(phase.boardId, session)) return null;
  const [phases, lines] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId: phase.boardId }, orderBy: { order: "asc" }, select: { id: true, name: true } }),
    prisma.nreLine.findMany({
      where: { OR: [{ phaseId }, { boardId: phase.boardId, phaseId: null, category: "COMMISSIONED" }] },
      orderBy: LINE_ORDER,
    }),
  ]);
  return {
    boardId: phase.boardId,
    phaseName: phase.name,
    phases,
    lines: lines.map(toRow),
    canEdit: await canEditBudget({ kind: "phase", id: phaseId }, session),
  };
}

/**
 * 匯出這個階段的報價單成 Excel(.xlsx)——這個階段的列,加上涵蓋整個專案的委託開發。
 * 看得到看板的人都能匯出;沒有任何項目就不產檔案,請使用者先填。
 */
export async function exportNreWorkbook(phaseId: string): Promise<{ filename: string; base64: string } | { error: string }> {
  const session = await requireSession();
  const phase = await prisma.budgetPhase.findUnique({
    where: { id: phaseId },
    select: { name: true, boardId: true, board: { select: { name: true } } },
  });
  if (!phase) return { error: "找不到這個階段" };
  await requireBoardAccess(phase.boardId, session);
  if (await hideBudgetOn(phase.boardId, session)) return { error: "你的角色看不到預算金額" };

  const lines = await prisma.nreLine.findMany({
    where: { OR: [{ phaseId }, { boardId: phase.boardId, phaseId: null, category: "COMMISSIONED" }] },
    orderBy: LINE_ORDER,
  });
  if (lines.length === 0) return { error: "報價單還沒有任何項目,沒有東西可以匯出。" };

  const buffer = await buildNreWorkbook({
    boardName: phase.board.name,
    phaseName: phase.name,
    exportedOn: taipeiTodayIso(),
    lines: lines.map((l) => ({ ...toRow(l), scope: l.phaseId === null ? WHOLE_PROJECT_LABEL : phase.name })),
  });
  await logAudit("COST", session.userId, `匯出「${phase.board.name}」${phase.name} 的 NRE 報價單 Excel`, phase.boardId);
  const safe = (name: string) => name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  return { filename: `${safe(phase.board.name)}-${safe(phase.name)}-NRE報價單.xlsx`, base64: buffer.toString("base64") };
}

/** 能編這個看板報價單的人;不能就回說明。 */
async function requireBoardEdit(boardId: string) {
  const session = await requireSession();
  const board = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true, name: true } });
  if (!board) return { error: "找不到這個看板" as const };
  await requireBoardAccess(boardId, session);
  if (!(await boardEditRight(boardId, session))) {
    return { error: "權限不足:只有管理者、專案建立者與該分組的 Team Leader 可以編輯預算與報價單" as const };
  }
  return { session, board };
}

/** 要寫進資料庫的欄位:數量與單價都有時,金額以相乘為準,存的是算好的金額。 */
function lineData(input: NreLineInput) {
  return {
    category: input.category,
    phaseId: input.phaseId,
    startDate: input.startDate,
    endDate: input.endDate,
    description: input.description.trim(),
    basis: input.basis.trim() || null,
    vendor: input.vendor.trim() || null,
    quantity: input.quantity,
    unitPrice: input.unitPrice === null ? null : Math.round(input.unitPrice),
    amount: resolveNreAmount(input),
    note: input.note.trim() || null,
  };
}

/** 範圍(階段或整個專案)寫成人看的字,稽核紀錄用。 */
async function scopeName(phaseId: string | null): Promise<string> {
  if (phaseId === null) return WHOLE_PROJECT_LABEL;
  return (await prisma.budgetPhase.findUnique({ where: { id: phaseId }, select: { name: true } }))?.name ?? "";
}

/** 新增(沒有 id)或修改(有 id)一列。數量與單價都有時,金額以相乘為準,存的是算好的金額。 */
export async function saveNreLine(
  boardId: string,
  input: NreLineInput & { id?: string }
): Promise<{ error?: string; id?: string }> {
  const guard = await requireBoardEdit(boardId);
  if ("error" in guard) return { error: guard.error };
  const { session } = guard;

  const invalid = validateNreLine(input);
  if (invalid) return { error: invalid };
  // 範圍只能是這個看板的階段(或整個專案)——不能把一列掛到別的看板上。
  if (input.phaseId !== null) {
    const phase = await prisma.budgetPhase.findUnique({ where: { id: input.phaseId }, select: { boardId: true } });
    if (!phase || phase.boardId !== boardId) return { error: "找不到這個階段" };
  }
  const data = lineData(input);
  const where = input.phaseId === null ? { boardId, phaseId: null } : { boardId, phaseId: input.phaseId };
  const scope = await scopeName(input.phaseId);

  if (input.id) {
    const existing = await prisma.nreLine.findUnique({ where: { id: input.id }, select: { boardId: true, amount: true, phaseId: true } });
    if (!existing || existing.boardId !== boardId) return { error: "找不到這一列" };
    // 換了範圍的話,排到新範圍這一類的最後面。
    const moved = existing.phaseId !== input.phaseId;
    const last = moved
      ? await prisma.nreLine.findFirst({ where: { ...where, category: input.category }, orderBy: { order: "desc" }, select: { order: true } })
      : null;
    await prisma.nreLine.update({ where: { id: input.id }, data: moved ? { ...data, order: (last?.order ?? -1) + 1 } : data });
    await logAudit("COST", session.userId, `${scope} 的 NRE 報價單「${data.description}」:${existing.amount} → ${data.amount} 元`, boardId);
    return { id: input.id };
  }

  const [count, last] = await Promise.all([
    prisma.nreLine.count({ where }),
    prisma.nreLine.findFirst({ where: { ...where, category: input.category }, orderBy: { order: "desc" }, select: { order: true } }),
  ]);
  if (count >= MAX_NRE_LINES_PER_PHASE) return { error: `一個階段(或整個專案)的報價單最多 ${MAX_NRE_LINES_PER_PHASE} 列` };
  const created = await prisma.nreLine.create({
    data: { ...data, boardId, order: (last?.order ?? -1) + 1, createdById: session.userId },
  });
  await logAudit("COST", session.userId, `${scope} 的 NRE 報價單新增「${data.description}」${data.amount} 元`, boardId);
  return { id: created.id };
}

export async function deleteNreLine(boardId: string, lineId: string): Promise<{ error?: string }> {
  const guard = await requireBoardEdit(boardId);
  if ("error" in guard) return { error: guard.error };
  const { session } = guard;
  const existing = await prisma.nreLine.findUnique({
    where: { id: lineId },
    select: { boardId: true, phaseId: true, description: true, amount: true },
  });
  if (!existing || existing.boardId !== boardId) return { error: "找不到這一列" };
  await prisma.nreLine.delete({ where: { id: lineId } });
  await logAudit(
    "COST",
    session.userId,
    `${await scopeName(existing.phaseId)} 的 NRE 報價單刪除「${existing.description}」${existing.amount} 元`,
    boardId
  );
  return {};
}

export type NreImportResult = {
  /** false = 只是預覽,什麼都還沒寫。 */
  applied: boolean;
  created: number;
  updated: number;
  unchanged: number;
  /** 報價單裡有、Excel 完全沒提到的列數(維持原樣,不刪)。 */
  untouched: number;
  /** 逐筆的變動說明(新增、更新改了什麼),給匯入前的確認用。 */
  changes: string[];
  /** 讀不進來的列(整列略過)與原因。 */
  warnings: string[];
  error?: string;
};

/** 20MB,跟其他匯入上限一致。 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

function importFailure(error: string, warnings: string[] = []): NreImportResult {
  return { applied: false, created: 0, updated: 0, unchanged: 0, untouched: 0, changes: [], warnings, error };
}

/**
 * 匯入報價單 Excel(匯出的版面)。比對規則:同一類別、同一個範圍(階段或整個專案)、同一個細項說明是同一列——
 * 內容一樣不動、不一樣就更新、Excel 才有的新增;報價單裡有、Excel 沒提到的列維持原樣,不刪。
 * 委託開發那一類的「範圍」欄寫這個階段的名字或「整個專案」;寫別的階段會略過那一列(請到那個階段匯入)。
 *
 * apply = false 只算出會變什麼(預覽),給畫面確認;確認之後再用 apply = true 真的寫入。
 * 只有能編預算的人可以匯入。
 */
export async function importNreWorkbook(phaseId: string, base64: string, apply: boolean): Promise<NreImportResult> {
  const phase = await prisma.budgetPhase.findUnique({ where: { id: phaseId }, select: { name: true, boardId: true } });
  if (!phase) return importFailure("找不到這個階段");
  const guard = await requireBoardEdit(phase.boardId);
  if ("error" in guard) return importFailure(guard.error ?? "無法匯入");
  const { session } = guard;

  if (base64.length * 0.75 > MAX_UPLOAD_BYTES) return importFailure("檔案太大了(上限 20MB)");
  const parsed = await parseNreWorkbook(Buffer.from(base64, "base64"));
  if (parsed.error) return importFailure(parsed.error);
  if (parsed.lines.length === 0) {
    return importFailure(
      "這份 Excel 裡找不到報價單的項目。請用「匯出 Excel」下載的檔案改好之後再匯入(每一類的區塊表頭,第一格要是類別名稱,例如「模具與治具」)。",
      parsed.warnings
    );
  }

  // 範圍欄位的字轉成階段:空白或這個階段的名字 = 這個階段,「整個專案」= null,其他略過。
  const warnings = [...parsed.warnings];
  const incoming: NreLineInput[] = [];
  for (const { row, scope, ...rest } of parsed.lines) {
    const name = (scope ?? "").trim();
    let linePhaseId: string | null;
    if (rest.category !== "COMMISSIONED" || name === "" || name === phase.name) linePhaseId = phaseId;
    else if (name === WHOLE_PROJECT_LABEL) linePhaseId = null;
    else {
      warnings.push(`第 ${row} 列「${rest.description}」的範圍「${name}」不是這個階段(${phase.name})或「${WHOLE_PROJECT_LABEL}」,略過(請到那個階段匯入)。`);
      continue;
    }
    incoming.push({ ...rest, phaseId: linePhaseId });
  }
  if (incoming.length === 0) return importFailure("這份 Excel 裡沒有可以匯入的列。", warnings);

  const rows = await prisma.nreLine.findMany({
    where: { OR: [{ phaseId }, { boardId: phase.boardId, phaseId: null, category: "COMMISSIONED" }] },
    orderBy: LINE_ORDER,
  });
  const existing = rows.map(toRow);
  const plan = planNreImport(existing, incoming);

  const currentCount = (id: string | null) => existing.filter((l) => l.phaseId === id).length;
  for (const id of new Set(plan.creates.map((c) => c.phaseId))) {
    const adding = plan.creates.filter((c) => c.phaseId === id).length;
    if (currentCount(id) + adding > MAX_NRE_LINES_PER_PHASE) {
      return importFailure(`匯入之後會超過上限(一個階段或整個專案的報價單最多 ${MAX_NRE_LINES_PER_PHASE} 列,現有 ${currentCount(id)} 列、要新增 ${adding} 列)`, warnings);
    }
  }

  const money = (n: number) => Math.round(n).toLocaleString("zh-TW");
  const nameOf = (id: string | null) => (id === null ? WHOLE_PROJECT_LABEL : phase.name);
  const changes = [
    ...plan.creates.map((c) => `新增:[${NRE_LABELS[c.category]}] ${c.description.trim()} — ${money(resolveNreAmount(c))} 元`),
    ...plan.updates.map((u) => `更新:[${NRE_LABELS[u.input.category]}] ${u.input.description.trim()}(${describeNreChange(u.before, u.input, nameOf)})`),
  ];
  const result: NreImportResult = {
    applied: false,
    created: plan.creates.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged,
    untouched: plan.untouched.length,
    changes,
    warnings,
  };
  if (!apply || (plan.creates.length === 0 && plan.updates.length === 0)) return result;

  // 新增的排在該範圍、該類別現有的最後面,維持 Excel 裡的先後。
  const nextOrder = new Map<string, number>();
  const orderKey = (id: string | null, category: string) => `${id ?? ""}\u0000${category}`;
  const maxOrder = await prisma.nreLine.groupBy({
    by: ["phaseId", "category"],
    where: { OR: [{ phaseId }, { boardId: phase.boardId, phaseId: null, category: "COMMISSIONED" }] },
    _max: { order: true },
  });
  for (const m of maxOrder) nextOrder.set(orderKey(m.phaseId, m.category), (m._max.order ?? -1) + 1);

  await prisma.$transaction([
    ...plan.updates.map((u) => prisma.nreLine.update({ where: { id: u.id }, data: lineData(u.input) })),
    ...plan.creates.map((input) => {
      const key = orderKey(input.phaseId, input.category);
      const order = nextOrder.get(key) ?? 0;
      nextOrder.set(key, order + 1);
      return prisma.nreLine.create({ data: { ...lineData(input), boardId: phase.boardId, order, createdById: session.userId } });
    }),
  ]);
  await logAudit(
    "COST",
    session.userId,
    `${phase.name} 匯入 NRE 報價單 Excel:新增 ${plan.creates.length} 列、更新 ${plan.updates.length} 列`,
    phase.boardId
  );
  return { ...result, applied: true };
}
