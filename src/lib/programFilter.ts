import type { ProgramTask } from "@/lib/programView";

/**
 * 專案群組甘特圖的「欄位篩選」。
 *
 * 每塊看板的欄位 id 都不一樣(類型欄、狀態欄、優先級欄各有各的 id),所以
 * 這裡一律拿「選項的標籤」比 —— 「Milestone」在每塊看板都是同一個字。
 */
export type ProgramFilterField = "type" | "status" | "priority" | "assignee";

export type ProgramFilter = Record<ProgramFilterField, string[]>;

export const EMPTY_PROGRAM_FILTER: ProgramFilter = { type: [], status: [], priority: [], assignee: [] };

/** 欄位沒綁定、或這一列還沒選值 —— 讓使用者也找得到「還沒填」的項目。 */
export const NO_VALUE = "__none__";

export const PROGRAM_FILTER_FIELDS: { field: ProgramFilterField; label: string }[] = [
  { field: "type", label: "類型" },
  { field: "status", label: "狀態" },
  { field: "priority", label: "優先級" },
  { field: "assignee", label: "負責人" },
];

/** 這一列在某個欄位上的值;負責人可以有好幾個。 */
function valuesOf(task: ProgramTask, field: ProgramFilterField): string[] {
  switch (field) {
    case "type":
      return [task.type ?? NO_VALUE];
    case "status":
      return [task.status ?? NO_VALUE];
    case "priority":
      return [task.priority ?? NO_VALUE];
    case "assignee":
      return task.assigneeIds.length > 0 ? task.assigneeIds : [NO_VALUE];
  }
}

export function isProgramFilterActive(filter: ProgramFilter): boolean {
  return PROGRAM_FILTER_FIELDS.some(({ field }) => filter[field].length > 0);
}

/**
 * 篩選之後要留下哪些列。沒有任何篩選就回 null(全部顯示)。
 *
 * 欄位之間是「而且」,同一欄的多個值是「或者」。符合的項目會連它的上層
 * 一起留著 —— 跟看板甘特圖的篩選同一個規則,否則一個里程碑會失去它屬於
 * 哪個階段的線索。
 */
export function computeProgramVisibleIds(
  tasks: ProgramTask[],
  filter: ProgramFilter
): Set<string> | null {
  const active = PROGRAM_FILTER_FIELDS.filter(({ field }) => filter[field].length > 0);
  if (active.length === 0) return null;

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const visible = new Set<string>();
  for (const task of tasks) {
    const matches = active.every(({ field }) =>
      valuesOf(task, field).some((v) => filter[field].includes(v))
    );
    if (!matches) continue;
    visible.add(task.id);
    // 沿著 parentId 一路加到有人已經加過為止(同時也擋住壞資料造成的循環)。
    let cursor = task.parentId;
    while (cursor && !visible.has(cursor)) {
      visible.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
  }
  return visible;
}

/** 從 localStorage 讀回來的東西不能信 —— 只收四個已知欄位的字串陣列。 */
export function parseStoredProgramFilter(raw: string | null): ProgramFilter {
  if (!raw) return EMPTY_PROGRAM_FILTER;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<ProgramFilterField, unknown>>;
    const pick = (field: ProgramFilterField): string[] => {
      const value = parsed?.[field];
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    };
    return { type: pick("type"), status: pick("status"), priority: pick("priority"), assignee: pick("assignee") };
  } catch {
    return EMPTY_PROGRAM_FILTER;
  }
}
