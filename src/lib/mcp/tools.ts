import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/lib/jwt";
import { accessibleBoardWhere, canAccessBoard } from "@/lib/boardAccess";
import { boardWithDataArgs } from "@/types/board";
import { listHolidays, toHolidaySet } from "@/lib/holidays";
import { computeWbsCodes, compareWbsCodes } from "@/lib/wbs";
import { getItemDateRange } from "@/lib/gantt";
import { computeOverdueUpcoming, resolveStatusColumn } from "@/lib/dashboard";
import { resolveWorkloadScope } from "@/lib/dashboardScope";
import { computeMemberTaskBreakdown } from "@/lib/workload";
import { gatherDelayInputs } from "@/lib/delayInputs";
import { analyzeDelays } from "@/lib/delayAnalysis";
import { computeCriticalPathAcross } from "@/lib/criticalPath";
import { summarizeBudget, CATEGORY_LABELS } from "@/lib/budget";
import { buildLabourSheet, type PhaseRow, type SlotRow } from "@/lib/labourSheet";
import { summariseProtoPlan } from "@/lib/protoPlan";
import { unitLabel } from "@/lib/orgUnits";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { subordinateIds, orgDepth } from "@/lib/orgChart";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { logAudit } from "@/lib/activityLog";
import { checkReadOnlySql, withRowLimit, MAX_ROWS } from "./sqlGuard";

/**
 * MCP 的工具集。
 *
 * 每一支都拿 API 金鑰換來的 session,所以既有的看板篩選原封不動套用 ——
 * 金鑰永遠不會比發它的人看得更多。唯一的例外是 run_sql,它刻意繞過這一
 * 層,所以另外限制成管理者金鑰而且每次都寫稽核。
 *
 * 計算一律重用畫面在用的那些函式,不另外寫一套:報表上的數字跟這裡問到的
 * 數字必須是同一個,否則兩邊對不起來的時候沒人知道該信誰。
 */

export type ToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type Json = Record<string, unknown>;

const str = (description: string) => ({ type: "string", description });
const optionalStr = str;

/** 解析出這個 session 看得到、而且符合條件的看板。 */
async function accessibleBoards(session: SessionPayload, boardId?: string) {
  if (boardId) {
    if (!(await canAccessBoard(session, boardId))) return [];
    return prisma.board.findMany({ where: { id: boardId }, ...boardWithDataArgs });
  }
  return prisma.board.findMany({ where: accessibleBoardWhere(session), ...boardWithDataArgs });
}

/** 一個看板的 WBS:代號是項目在自己分組樹裡的位置,所以一個分組算一次。 */
function wbsOf(board: {
  groups: { id: string }[];
  items: { id: string; groupId: string; parentId: string | null; order: number }[];
}) {
  const codes = new Map<string, string>();
  for (const group of board.groups) {
    const groupItems = board.items.filter((i) => i.groupId === group.id);
    for (const [id, code] of computeWbsCodes(groupItems)) codes.set(id, code);
  }
  return codes;
}

export const TOOLS: ToolDef[] = [
  {
    name: "list_boards",
    description:
      "列出這把金鑰看得到的所有看板,含所屬專案群組、分組與欄位。要先知道 boardId 才能用其他工具時從這裡開始。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_items",
    description:
      "列出一個看板的工作項:WBS 代號、名稱、階層、負責人、起訖日、天數、狀態、進度。照看板上的順序(分組 → WBS)。",
    inputSchema: {
      type: "object",
      properties: {
        boardId: str("看板 id,用 list_boards 取得"),
        groupId: optionalStr("只看某一個分組"),
        limit: { type: "number", description: "最多幾筆,預設 500" },
      },
      required: ["boardId"],
    },
  },
  {
    name: "search_items",
    description: "跨所有看得到的看板搜尋工作項名稱。",
    inputSchema: {
      type: "object",
      properties: {
        query: str("要搜尋的字"),
        limit: { type: "number", description: "最多幾筆,預設 50" },
      },
      required: ["query"],
    },
  },
  {
    name: "list_overdue",
    description:
      "逾期、七天內即將到期、以及已完成的工作項。不給 boardId 就是所有看得到的看板。",
    inputSchema: {
      type: "object",
      properties: { boardId: optionalStr("只看某一個看板") },
    },
  },
  {
    name: "get_critical_path",
    description:
      "要徑:哪些工作項的浮時是零,晚一天就會推遲整個專案。同一個專案群組的看板會一起算。",
    inputSchema: {
      type: "object",
      properties: { boardId: str("看板 id") },
      required: ["boardId"],
    },
  },
  {
    name: "get_delay_analysis",
    description:
      "延遲追因:跟基準線比,整體晚了幾天,以及哪些工作項是「自己延誤」的(扣掉前置推給它的部分之後仍然晚)。",
    inputSchema: {
      type: "object",
      properties: { boardId: str("看板 id") },
      required: ["boardId"],
    },
  },
  {
    name: "get_budget",
    description:
      "一個階段的預算管控:各費用類別的核准、已花費、已下單未入帳、剩餘可用,以及是否超支。",
    inputSchema: {
      type: "object",
      properties: { itemId: str("階段那一列工作項的 id(最上層的項目)") },
      required: ["itemId"],
    },
  },
  {
    name: "get_labour_sheet",
    description:
      "人力表:每個名額逐月的投入、各單位人月與金額、階段 × 單位的交叉表,以及預算階段跟看板實際時程的差異。",
    inputSchema: {
      type: "object",
      properties: { boardId: str("看板 id") },
      required: ["boardId"],
    },
  },
  {
    name: "get_proto_plan",
    description: "樣機使用計畫:產品 × 用途單位 × 階段各要幾台,含小計。",
    inputSchema: {
      type: "object",
      properties: { boardId: str("看板 id") },
      required: ["boardId"],
    },
  },
  {
    name: "get_workload",
    description:
      "成員工作量:每個人被指派了哪些工作項、各佔多少百分比、合計負載。範圍依這把金鑰擁有者的角色而定。",
    inputSchema: {
      type: "object",
      properties: { userId: optionalStr("只看某一個人") },
    },
  },
  {
    name: "get_org_chart",
    description: "組織:每個人的角色、所屬單位、所屬主管、在第幾階、下轄幾個人。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_sql",
    description:
      "唯讀 SQL。只允許單一句 SELECT 或 WITH,最多回 " +
      MAX_ROWS +
      " 列。這支工具繞過應用層的權限檢查,所以只有管理者的金鑰能用,而且每一次查詢都會寫進稽核軌跡。資料表名稱是大寫開頭且要加雙引號,例如 \"Board\"、\"Item\"、\"CellValue\"。",
    inputSchema: {
      type: "object",
      properties: { sql: str("要執行的 SELECT 查詢") },
      required: ["sql"],
    },
  },
];

export async function callTool(
  name: string,
  args: Json,
  session: SessionPayload
): Promise<unknown> {
  switch (name) {
    case "list_boards":
      return listBoards(session);
    case "list_items":
      return listItems(session, args);
    case "search_items":
      return searchItems(session, args);
    case "list_overdue":
      return listOverdue(session, args);
    case "get_critical_path":
      return getCriticalPath(session, args);
    case "get_delay_analysis":
      return getDelayAnalysisTool(session, args);
    case "get_budget":
      return getBudgetTool(session, args);
    case "get_labour_sheet":
      return getLabourSheetTool(session, args);
    case "get_proto_plan":
      return getProtoPlanTool(session, args);
    case "get_workload":
      return getWorkload(session, args);
    case "get_org_chart":
      return getOrgChart(session);
    case "run_sql":
      return runSql(session, args);
    default:
      throw new Error(`未知的工具:${name}`);
  }
}

// ---- 看板 / 工作項 / 時程 ----

async function listBoards(session: SessionPayload) {
  const boards = await prisma.board.findMany({
    where: accessibleBoardWhere(session),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      program: { select: { id: true, name: true } },
      groups: { orderBy: { order: "asc" }, select: { id: true, name: true } },
      columns: { orderBy: { order: "asc" }, select: { id: true, name: true, type: true } },
      _count: { select: { items: true } },
    },
  });
  return {
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      program: b.program,
      itemCount: b._count.items,
      groups: b.groups,
      columns: b.columns,
    })),
  };
}

async function listItems(session: SessionPayload, args: Json) {
  const boardId = String(args.boardId ?? "");
  const [board] = await accessibleBoards(session, boardId);
  if (!board) throw new Error("找不到這個看板,或這把金鑰沒有權限");

  const codes = wbsOf(board);
  const holidays = toHolidaySet(await listHolidays());
  const statusColumn = resolveStatusColumn(board);
  const groupName = new Map(board.groups.map((g) => [g.id, g.name]));
  const limit = Number(args.limit ?? 500);

  const rows = board.items
    .filter((i) => !args.groupId || i.groupId === args.groupId)
    .map((item) => {
      const range =
        board.ganttStartColumnId && board.ganttDurationColumnId
          ? getItemDateRange(
              item,
              board.ganttStartColumnId,
              board.ganttDurationColumnId,
              board.ganttDurationMode,
              holidays
            )
          : null;
      const statusValue = statusColumn
        ? item.cellValues.find((cv) => cv.columnId === statusColumn.id)?.value
        : null;
      return {
        id: item.id,
        wbsCode: codes.get(item.id) ?? "",
        name: item.name,
        groupName: groupName.get(item.groupId) ?? "",
        parentId: item.parentId,
        start: range ? range.start.toISOString().slice(0, 10) : null,
        end: range ? range.end.toISOString().slice(0, 10) : null,
        status: typeof statusValue === "string" ? statusValue : null,
        assignees: item.assignments.map((a) => ({
          name: a.user.name,
          allocationPct: a.allocationPct,
        })),
      };
    })
    .sort((a, b) => compareWbsCodes(a.wbsCode, b.wbsCode))
    .slice(0, limit);

  return { boardName: board.name, itemCount: rows.length, items: rows };
}

async function searchItems(session: SessionPayload, args: Json) {
  const query = String(args.query ?? "").trim();
  if (!query) throw new Error("query 不可為空");
  const limit = Number(args.limit ?? 50);

  const boards = await prisma.board.findMany({
    where: accessibleBoardWhere(session),
    select: { id: true, name: true },
  });
  const items = await prisma.item.findMany({
    where: {
      boardId: { in: boards.map((b) => b.id) },
      deletedAt: null,
      name: { contains: query, mode: "insensitive" },
    },
    take: limit,
    select: { id: true, name: true, boardId: true, group: { select: { name: true } } },
  });
  const boardName = new Map(boards.map((b) => [b.id, b.name]));

  return {
    hits: items.map((i) => ({
      id: i.id,
      name: i.name,
      boardId: i.boardId,
      boardName: boardName.get(i.boardId) ?? "",
      groupName: i.group.name,
    })),
  };
}

// ---- 進度 / 逾期 / 延遲追因 ----

async function listOverdue(session: SessionPayload, args: Json) {
  const boardId = args.boardId ? String(args.boardId) : undefined;
  const boards = await accessibleBoards(session, boardId);
  const holidays = toHolidaySet(await listHolidays());
  const { overdue, upcoming, completed } = computeOverdueUpcoming(boards, undefined, holidays);

  const shape = (list: typeof overdue) =>
    list.map((e) => ({
      id: e.itemId,
      wbsCode: e.wbsCode,
      name: e.itemName,
      boardName: e.boardName,
      groupName: e.groupName,
      end: e.end.toISOString().slice(0, 10),
    }));

  return {
    overdue: shape(overdue),
    upcomingWithin7Days: shape(upcoming),
    completed: shape(completed),
  };
}

async function getCriticalPath(session: SessionPayload, args: Json) {
  const boardId = String(args.boardId ?? "");
  const [board] = await accessibleBoards(session, boardId);
  if (!board) throw new Error("找不到這個看板,或這把金鑰沒有權限");

  // 同一個專案群組的看板一起算 —— 要徑會跨看板。
  const siblings = board.programId
    ? await prisma.board.findMany({
        where: { programId: board.programId, deletedAt: null },
        ...boardWithDataArgs,
      })
    : [board];
  const visible = [];
  for (const b of siblings) if (await canAccessBoard(session, b.id)) visible.push(b);

  const holidays = toHolidaySet(await listHolidays());
  const allItems = visible.flatMap((b) => b.items);
  const boardOf = new Map(visible.flatMap((b) => b.items.map((i) => [i.id, b])));
  const floats = computeCriticalPathAcross(
    allItems,
    (item) => {
      const b = boardOf.get(item.id);
      return b
        ? {
            startColumnId: b.ganttStartColumnId,
            durationColumnId: b.ganttDurationColumnId,
            predColumnId: b.predColumnId,
            linkColumnId: b.linkColumnId,
            lagColumnId: b.lagColumnId,
            durationMode: b.ganttDurationMode,
            linkColumnOptions: b.columns.find((c) => c.id === b.linkColumnId)?.options,
          }
        : null;
    },
    holidays
  );

  const codes = new Map<string, string>();
  for (const b of visible) for (const [id, code] of wbsOf(b)) codes.set(id, code);

  const critical = allItems
    .filter((i) => floats.get(i.id)?.isCritical)
    .map((i) => ({
      id: i.id,
      wbsCode: codes.get(i.id) ?? "",
      name: i.name,
      boardName: boardOf.get(i.id)?.name ?? "",
      totalFloat: floats.get(i.id)?.totalFloat ?? null,
    }))
    .sort((a, b) => compareWbsCodes(a.wbsCode, b.wbsCode));

  return { boardsInScope: visible.map((b) => b.name), criticalCount: critical.length, critical };
}

async function getDelayAnalysisTool(session: SessionPayload, args: Json) {
  const boardId = String(args.boardId ?? "");
  if (!(await canAccessBoard(session, boardId))) {
    throw new Error("找不到這個看板,或這把金鑰沒有權限");
  }
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { programId: true },
  });
  const boardIds = board?.programId
    ? (
        await prisma.board.findMany({
          where: { programId: board.programId, deletedAt: null },
          select: { id: true },
        })
      ).map((b) => b.id)
    : [boardId];

  const { inputs, visibleIds } = await gatherDelayInputs(boardIds, session);
  const analysis = analyzeDelays(inputs, visibleIds);
  return {
    noBaseline: analysis.noBaseline,
    projectDelayDays: analysis.projectDelay,
    culprits: analysis.culprits.map((c) => ({
      id: c.id,
      wbsCode: c.wbsCode,
      name: c.name,
      boardId: c.boardId,
      ownDelayDays: c.ownDelay,
      inheritedDelayDays: c.inheritedDelay,
      downstreamCount: c.downstreamCount,
    })),
  };
}

// ---- 預算 / 成本 / 人力 ----

async function getBudgetTool(session: SessionPayload, args: Json) {
  const itemId = String(args.itemId ?? "");
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { name: true, boardId: true },
  });
  if (!item || !(await canAccessBoard(session, item.boardId))) {
    throw new Error("找不到這個階段,或這把金鑰沒有權限");
  }

  // 預算涵蓋這一列底下整棵子樹。
  const all = await prisma.item.findMany({
    where: { boardId: item.boardId, deletedAt: null },
    select: { id: true, parentId: true },
  });
  const subtree = new Set([itemId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const i of all) {
      if (i.parentId && subtree.has(i.parentId) && !subtree.has(i.id)) {
        subtree.add(i.id);
        grew = true;
      }
    }
  }
  const itemIds = [...subtree];

  const [budgets, expenses, commitments] = await Promise.all([
    // 預算現在可能掛在預算階段上,而階段對應到這一列 —— 只問 itemId 的話,
    // 用人力表編預算的看板在這裡會一片空白。
    prisma.budget.findMany({ where: { OR: [{ itemId }, { phase: { itemId } }] } }),
    prisma.expense.findMany({ where: { itemId: { in: itemIds } } }),
    prisma.commitment.findMany({ where: { itemId: { in: itemIds }, settled: false } }),
  ]);

  const summary = summarizeBudget({
    budgets: budgets.map((b) => ({ category: b.category, amount: b.amount })),
    actuals: expenses.map((e) => ({ category: e.category, amount: Number(e.amount) })),
    commitments: commitments.map((c) => ({ category: c.category, amount: Number(c.amount) })),
  });

  return {
    phaseName: item.name,
    categories: summary.lines.map((l) => ({
      category: CATEGORY_LABELS[l.category],
      budget: l.budget,
      actual: l.actual,
      committed: l.committed,
      remaining: l.budget - l.actual - l.committed,
      isOver: l.isOver,
    })),
    total: summary.total,
  };
}

async function getLabourSheetTool(session: SessionPayload, args: Json) {
  const boardId = String(args.boardId ?? "");
  if (!(await canAccessBoard(session, boardId))) {
    throw new Error("找不到這個看板,或這把金鑰沒有權限");
  }

  const [phaseRows, slotRows, rateRows] = await Promise.all([
    prisma.budgetPhase.findMany({ where: { boardId }, orderBy: { order: "asc" } }),
    prisma.labourSlot.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      include: { months: true, user: { select: { name: true } } },
    }),
    prisma.disciplineRate.findMany(),
  ]);
  const rates = Object.fromEntries(rateRows.map((r) => [r.discipline, r.monthlySalary]));

  const phases: PhaseRow[] = phaseRows.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    itemId: p.itemId,
  }));
  const slots: SlotRow[] = slotRows.map((s) => ({
    id: s.id,
    discipline: s.discipline,
    label: s.label,
    func: s.func,
    userId: s.userId,
    ownerName: s.user?.name ?? s.ownerLabel,
    description: s.description,
    months: Object.fromEntries(s.months.map((m) => [m.month, Number(m.fte)])),
  }));

  const units = await loadOrgUnits();
  const sheet = buildLabourSheet(phases, slots, rates, units);
  const totalOf = new Map(sheet.slotTotals.map((t) => [t.slotId, t]));

  return {
    months: sheet.months,
    slots: slots.map((s) => ({
      label: s.label,
      discipline: unitLabel(units, s.discipline),
      func: s.func,
      owner: s.ownerName,
      personMonths: totalOf.get(s.id)?.personMonths ?? 0,
      amount: totalOf.get(s.id)?.amount ?? 0,
      months: s.months,
    })),
    byDiscipline: sheet.byDiscipline.map((d) => ({
      discipline: unitLabel(units, d.discipline),
      personMonths: d.personMonths,
      amount: d.amount,
    })),
    byPhase: sheet.byPhase.map((p) => ({
      phase: p.phaseName,
      personMonths: p.personMonths,
      amount: p.amount,
    })),
    totalPersonMonths: sheet.totalPersonMonths,
    totalAmount: sheet.totalAmount,
    unpricedDisciplines: sheet.unpricedDisciplines.map((d) => unitLabel(units, d)),
  };
}

async function getProtoPlanTool(session: SessionPayload, args: Json) {
  const boardId = String(args.boardId ?? "");
  if (!(await canAccessBoard(session, boardId))) {
    throw new Error("找不到這個看板,或這把金鑰沒有權限");
  }
  const [phases, cells] = await Promise.all([
    prisma.budgetPhase.findMany({
      where: { boardId },
      orderBy: { order: "asc" },
      select: { id: true, name: true },
    }),
    prisma.protoPlan.findMany({
      where: { boardId },
      orderBy: { createdAt: "asc" },
      select: { product: true, unit: true, phaseId: true, qty: true, note: true },
    }),
  ]);
  const summary = summariseProtoPlan(
    phases.map((p) => p.id),
    cells
  );
  const phaseName = new Map(phases.map((p) => [p.id, p.name]));
  const named = (list: { phaseId: string; qty: number }[]) =>
    list.map((c) => ({ phase: phaseName.get(c.phaseId) ?? "", qty: c.qty }));

  return {
    phases: phases.map((p) => p.name),
    products: summary.products.map((p) => ({
      product: p.product,
      rows: p.rows.map((r) => ({ unit: r.unit, byPhase: named(r.cells), total: r.total })),
      byPhase: named(p.byPhase),
      total: p.total,
    })),
    byPhase: named(summary.byPhase),
    total: summary.total,
  };
}

// ---- 人力負載 / 組織 ----

async function getWorkload(session: SessionPayload, args: Json) {
  const { boards, workloadScope } = await resolveWorkloadScope(session);
  const holidays = toHolidaySet(await listHolidays());
  const scope = args.userId
    ? workloadScope.filter((u) => u.id === String(args.userId))
    : workloadScope;
  const byUser = computeMemberTaskBreakdown(
    boards,
    scope.map((u) => u.id),
    holidays,
    (await getSystemSettings()).ownerDefaultAllocationPct
  );

  return {
    members: scope.map((u) => {
      const tasks = byUser.get(u.id) ?? [];
      return {
        userId: u.id,
        name: u.name,
        taskCount: tasks.length,
        totalAllocationPct: tasks.reduce((t, task) => t + task.allocationPct, 0),
        tasks: tasks.map((t) => ({
          name: t.itemName,
          boardName: t.boardName,
          groupName: t.groupName,
          allocationPct: t.allocationPct,
          start: t.startDate ? t.startDate.toISOString().slice(0, 10) : null,
          end: t.endDate ? t.endDate.toISOString().slice(0, 10) : null,
        })),
      };
    }),
  };
}

async function getOrgChart(session: SessionPayload) {
  if (session.role !== "ADMIN" && session.role !== "SUPERVISOR") {
    throw new Error("權限不足:只有管理者與主管可以查詢組織");
  }
  const users = await prisma.user.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      discipline: true,
      supervisorId: true,
      supervisor: { select: { name: true } },
    },
  });
  return {
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      discipline: u.discipline,
      supervisor: u.supervisor?.name ?? null,
      level: orgDepth(users, u.id),
      subordinateCount: subordinateIds(users, u.id).size,
    })),
  };
}

// ---- 唯讀 SQL ----

async function runSql(session: SessionPayload, args: Json) {
  // 這支繞過所有應用層的權限檢查,所以把門檻拉到只有管理者的金鑰。
  if (session.role !== "ADMIN") {
    throw new Error("權限不足:run_sql 只接受管理者的金鑰");
  }
  const checked = checkReadOnlySql(String(args.sql ?? ""));
  if (!checked.ok) throw new Error(checked.reason);

  // 先記錄再執行:查詢失敗也要留下「有人問過什麼」。
  await logAudit("SETTINGS", session.userId, `MCP run_sql:${checked.sql.slice(0, 400)}`);

  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(withRowLimit(checked.sql));
  // BigInt 與 Decimal 不能直接 JSON 序列化 —— COUNT(*) 回的就是 BigInt。
  const plain = rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => [
        k,
        typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v,
      ])
    )
  );
  return { rowCount: plain.length, truncatedAt: MAX_ROWS, rows: plain };
}

export async function settingsHoursPerDay() {
  return (await getSystemSettings()).hoursPerDay;
}
