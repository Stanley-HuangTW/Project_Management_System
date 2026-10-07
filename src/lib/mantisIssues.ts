/**
 * 看板「問題」分頁(同步自 MantisBT 的問題)的排序、篩選、依處理人分組。純邏輯。
 */
import type { RiskStatus } from "@prisma/client";

export type MantisIssueRow = {
  riskId: string;
  mantisId: number;
  url: string | null;
  title: string;
  /** 對應到風險與議題的狀態:未處理 / 處理中 / 已結案。 */
  status: RiskStatus;
  /** Mantis 上的狀態文字。 */
  mantisStatus: string | null;
  severity: string | null;
  priority: string | null;
  category: string | null;
  reporter: string | null;
  /** Mantis 上的處理人(顯示名稱)。 */
  handlerName: string | null;
  /** 處理人用 Email 對應到的本系統使用者;對不到就是 null。 */
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  /** 說明開頭的一段(完整內容在 Mantis)。 */
  descriptionPreview: string;
  impact: number;
  /** ISO 字串 */
  createdAt: string;
  updatedAt: string | null;
};

export const UNASSIGNED_KEY = "none";

/** 同一個處理人的 key:對得到本系統使用者用 userId,對不到用 Mantis 上的名字,沒有處理人是 none。 */
export function handlerKeyOf(r: Pick<MantisIssueRow, "ownerId" | "handlerName">): string {
  if (r.ownerId) return r.ownerId;
  return r.handlerName ? `mantis:${r.handlerName}` : UNASSIGNED_KEY;
}

/** 畫面上顯示的處理人:優先用本系統的名字。 */
export function handlerNameOf(r: Pick<MantisIssueRow, "ownerName" | "handlerName">): string {
  return r.ownerName ?? r.handlerName ?? "未指派";
}

const STATUS_RANK: Record<RiskStatus, number> = { OPEN: 0, MITIGATING: 1, PENDING_REVIEW: 2, CLOSED: 3 };

/** 未結案的在前;同一狀態內嚴重的(衝擊高)在前,再依最近更新、編號。 */
export function sortIssues<T extends Pick<MantisIssueRow, "status" | "impact" | "updatedAt" | "mantisId">>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.impact - a.impact ||
      (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") ||
      b.mantisId - a.mantisId
  );
}

export type IssueFilter = {
  query: string;
  /** all = 全部;其他 = 只看那個狀態。 */
  status: "all" | RiskStatus;
  /** all = 全部處理人;否則是 handlerKeyOf 的結果。 */
  handler: "all" | string;
  showClosed: boolean;
};

/** 搜尋:標題、Mantis 編號(#123 或 123)、處理人、回報人、分類、嚴重度。多個關鍵字用空白隔開,每個都要符合。 */
export function filterIssues(rows: MantisIssueRow[], f: IssueFilter): MantisIssueRow[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (!f.showClosed && f.status === "all" && r.status === "CLOSED") return false;
    if (f.status !== "all" && r.status !== f.status) return false;
    if (f.handler !== "all" && handlerKeyOf(r) !== f.handler) return false;
    if (words.length === 0) return true;
    const haystack = [
      r.title,
      `#${r.mantisId}`,
      String(r.mantisId),
      handlerNameOf(r),
      r.handlerName,
      r.reporter,
      r.category,
      r.severity,
      r.priority,
      r.mantisStatus,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return words.every((w) => haystack.includes(w.replace(/^#/, "")) || haystack.includes(w));
  });
}

export type StatusCounts = { total: number; open: number; working: number; closed: number };

export function countByStatus(rows: Pick<MantisIssueRow, "status">[]): StatusCounts {
  return {
    total: rows.length,
    open: rows.filter((r) => r.status === "OPEN").length,
    working: rows.filter((r) => r.status === "MITIGATING").length,
    closed: rows.filter((r) => r.status === "CLOSED").length,
  };
}

export type HandlerGroup = StatusCounts & {
  key: string;
  name: string;
  /** 對得到本系統的使用者;不是就是 Mantis 上才有的人(或沒有處理人)。 */
  userId: string | null;
  issues: MantisIssueRow[];
};

/**
 * 依處理人分組:誰手上有哪些問題。未結案多的在前,沒有處理人的放最後;組內照 sortIssues。
 */
export function groupByHandler(rows: MantisIssueRow[]): HandlerGroup[] {
  const groups = new Map<string, HandlerGroup>();
  for (const r of sortIssues(rows)) {
    const key = handlerKeyOf(r);
    const group =
      groups.get(key) ??
      ({ key, name: handlerNameOf(r), userId: r.ownerId, issues: [], total: 0, open: 0, working: 0, closed: 0 } satisfies HandlerGroup);
    group.issues.push(r);
    groups.set(key, group);
  }
  const out = [...groups.values()].map((g) => ({ ...g, ...countByStatus(g.issues) }));
  return out.sort(
    (a, b) =>
      Number(a.key === UNASSIGNED_KEY) - Number(b.key === UNASSIGNED_KEY) ||
      b.open + b.working - (a.open + a.working) ||
      // 同樣多時,本系統的同仁排在 Mantis 上才有的人前面。
      Number(a.userId === null) - Number(b.userId === null) ||
      a.name.localeCompare(b.name, "zh-TW")
  );
}
