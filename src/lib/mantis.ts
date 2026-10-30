/**
 * MantisBT 議題 → 風險與議題。純邏輯:不打 Mantis、不碰資料庫,同步程式、設定畫面與測試共用。
 *
 * 欄位名稱照 MantisBT REST API(/api/rest/issues)回傳的 JSON;每個欄位都當成可能沒有——
 * 不同版本、不同設定回來的欄位不完全一樣,缺了就用保守的預設值,不要整批同步失敗。
 */
import type { RiskStatus } from "@prisma/client";
import { toTaipei } from "./googleCalendar";
import type { MantisMapping } from "./mantisMapping";

export type MantisUserRef = { id?: number; name?: string; real_name?: string; email?: string };
export type MantisEnum = { id?: number; name?: string; label?: string };
export type MantisNote = { id?: number; reporter?: MantisUserRef; text?: string; created_at?: string };

export type MantisIssue = {
  id: number;
  summary?: string;
  description?: string;
  project?: { id?: number; name?: string };
  category?: { id?: number; name?: string };
  reporter?: MantisUserRef;
  handler?: MantisUserRef;
  status?: MantisEnum;
  severity?: MantisEnum;
  priority?: MantisEnum;
  created_at?: string;
  updated_at?: string;
  due_date?: string | null;
  notes?: MantisNote[];
};

export type MantisProject = { id: number; name: string };

/**
 * 管理者貼進來的 Mantis 網址整理成「網站根網址」:只留協定、主機與路徑,拿掉結尾的斜線、
 * /api/rest、貼成某一頁(view.php、my_view_page.php…)的檔名。不是 http(s) 就回錯誤。
 */
export function normalizeBaseUrl(input: string): { url: string } | { error: string } {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return { error: "請輸入有效的網址,例如 https://mantis.example.com" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { error: "網址要以 http:// 或 https:// 開頭" };
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.at(-1)?.endsWith(".php")) segments.pop();
  if (segments.length >= 2 && segments.at(-2) === "api" && segments.at(-1) === "rest") segments.splice(-2, 2);
  return { url: `${parsed.origin}${segments.length > 0 ? `/${segments.join("/")}` : ""}` };
}

export function issueUrl(baseUrl: string, id: number): string {
  return `${baseUrl}/view.php?id=${id}`;
}

/** 一個連結如果是這個 Mantis 網站的問題頁(view.php?id=123),回問題編號,不是就 null。 */
export function mantisIdFromUrl(url: string, baseUrl: string): number | null {
  let link: URL;
  let base: URL;
  try {
    link = new URL(url);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (link.origin !== base.origin) return null;
  const basePath = base.pathname.replace(/\/+$/, "");
  if (link.pathname !== `${basePath}/view.php`) return null;
  const id = Number(link.searchParams.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Mantis 的狀態編號:new 10、feedback 20、acknowledged 30、confirmed 40、assigned 50、resolved 80、closed 90。
 * 沒人處理(< 50)= 未處理;有人在處理(50–79)= 處理中;resolved 以後(≥ 80,Mantis 預設的「已解決」門檻)= 已結案。
 * 自訂的狀態也照編號歸類,不用逐個名稱對照。
 */
export function statusToRisk(statusId: number | undefined): RiskStatus {
  if (statusId === undefined) return "OPEN";
  if (statusId >= 80) return "CLOSED";
  if (statusId >= 50) return "MITIGATING";
  return "OPEN";
}

/** 嚴重度(feature 10、trivial 20、text 30、tweak 40、minor 50、major 60、crash 70、block 80)→ 衝擊 1–5。 */
export function severityToImpact(severityId: number | undefined): number {
  if (severityId === undefined) return 3;
  if (severityId >= 70) return 5;
  if (severityId >= 60) return 4;
  if (severityId >= 50) return 3;
  if (severityId >= 40) return 2;
  return 1;
}

/** 狀態編號 → 本系統狀態:設定過的對應表優先,沒列到的走上面的編號門檻。 */
export function statusWithMapping(statusIn: Record<string, RiskStatus> | undefined, statusId: number | undefined): RiskStatus {
  const explicit = statusId === undefined ? undefined : statusIn?.[String(statusId)];
  return explicit ?? statusToRisk(statusId);
}

/** 嚴重度編號 → 衝擊 1–5:設定過的對應表優先,沒列到的走上面的預設規則。 */
export function impactWithMapping(severityIn: Record<string, number> | undefined, severityId: number | undefined): number {
  const explicit = severityId === undefined ? undefined : severityIn?.[String(severityId)];
  return explicit ?? severityToImpact(severityId);
}

/** Mantis 的到期日(可能帶時間與時區)→ 台灣的 "YYYY-MM-DD";沒有或看不懂回 null。 */
export function formatDueDate(due: string | null | undefined): string | null {
  if (!due) return null;
  const ms = Date.parse(due);
  if (Number.isNaN(ms)) return null;
  return toTaipei(ms).date;
}

const MAX_NOTES = 5;
const MAX_NOTE_LENGTH = 300;
const MAX_DESCRIPTION = 6000;

const personName = (u: MantisUserRef | undefined) => u?.real_name?.trim() || u?.name?.trim() || "";

/** Mantis 的說明,後面接最近幾則備註(bugnote)——備註是 Mantis 上最常更新的資訊。 */
export function buildDescription(issue: MantisIssue): string {
  const parts = [(issue.description ?? "").trim()].filter(Boolean);
  const notes = (issue.notes ?? []).filter((n) => (n.text ?? "").trim());
  if (notes.length > 0) {
    const recent = notes.slice(-MAX_NOTES);
    const lines = recent.map((n) => {
      const ms = n.created_at ? Date.parse(n.created_at) : NaN;
      const date = Number.isNaN(ms) ? "" : `${toTaipei(ms).date} `;
      const flat = (n.text ?? "").replace(/\s+/g, " ").trim();
      const text = flat.length > MAX_NOTE_LENGTH ? `${flat.slice(0, MAX_NOTE_LENGTH)}…` : flat;
      return `[${date}${personName(n.reporter) || "—"}] ${text}`;
    });
    parts.push(`── Mantis 備註(最近 ${recent.length} 則,共 ${notes.length} 則)──\n${lines.join("\n")}`);
  }
  const text = parts.join("\n\n");
  return text.length > MAX_DESCRIPTION ? `${text.slice(0, MAX_DESCRIPTION)}…` : text;
}

/** 同步下來之後,風險與議題上的欄位。 */
export type MappedIssue = {
  mantisId: number;
  mantisUrl: string;
  mantisStatus: string | null;
  mantisHandler: string | null;
  mantisUpdatedAt: Date | null;
  mantisSeverity: string | null;
  mantisPriority: string | null;
  mantisCategory: string | null;
  mantisReporter: string | null;
  /** 列舉值與處理人的編號:比對有沒有被別人改過、寫回時用。 */
  mantisStatusId: number | null;
  mantisSeverityId: number | null;
  mantisPriorityId: number | null;
  mantisHandlerId: number | null;
  title: string;
  description: string;
  status: RiskStatus;
  /** 問題是已經發生的事,機率固定最高;排序靠衝擊(嚴重度)。 */
  probability: number;
  impact: number;
  /** 處理人的 Email,拿去對應本系統的使用者(對不到就沒有負責人)。 */
  handlerEmail: string | null;
  dueDate: string | null;
  createdAt: Date | null;
};

/** Mantis 的列舉值(狀態、嚴重度…):label 是依使用者語言翻過的顯示文字,沒有就用英文的 name。 */
const enumText = (e: MantisEnum | undefined) => e?.label?.trim() || e?.name?.trim() || null;

const toDate = (text: string | undefined) => {
  const ms = text ? Date.parse(text) : NaN;
  return Number.isNaN(ms) ? null : new Date(ms);
};

const positiveId = (v: number | undefined) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);

/** mapping 是這個連線設定的對應表;沒給就是預設規則(以前寫死的那一套)。 */
export function mapMantisIssue(
  issue: MantisIssue,
  baseUrl: string,
  mapping?: Pick<MantisMapping, "statusIn" | "severityIn">
): MappedIssue {
  const handlerName = personName(issue.handler);
  return {
    mantisId: issue.id,
    mantisUrl: issueUrl(baseUrl, issue.id),
    mantisStatus: enumText(issue.status),
    mantisHandler: handlerName || null,
    mantisUpdatedAt: toDate(issue.updated_at),
    mantisSeverity: enumText(issue.severity),
    mantisPriority: enumText(issue.priority),
    mantisCategory: issue.category?.name?.trim() || null,
    mantisReporter: personName(issue.reporter) || null,
    mantisStatusId: positiveId(issue.status?.id),
    mantisSeverityId: positiveId(issue.severity?.id),
    mantisPriorityId: positiveId(issue.priority?.id),
    mantisHandlerId: positiveId(issue.handler?.id),
    title: (issue.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || `Mantis #${issue.id}`,
    description: buildDescription(issue),
    status: statusWithMapping(mapping?.statusIn, issue.status?.id),
    probability: 5,
    impact: impactWithMapping(mapping?.severityIn, issue.severity?.id),
    handlerEmail: issue.handler?.email?.trim().toLowerCase() || null,
    dueDate: formatDueDate(issue.due_date),
    createdAt: toDate(issue.created_at),
  };
}

/** 同步時從問題上收集到的 Mantis 使用者:寫回「處理人」時,用 Email 對應本系統的使用者。 */
export type MantisUser = { id: number; name: string; realName: string; email: string };

/** 問題的處理人、回報人、備註作者裡,有編號的 Mantis 使用者(同一個編號只留一筆,後面的補前面缺的欄位)。 */
export function collectMantisUsers(issues: MantisIssue[]): MantisUser[] {
  const byId = new Map<number, MantisUser>();
  const add = (u: MantisUserRef | undefined) => {
    const id = positiveId(u?.id);
    if (id === null) return;
    const prev = byId.get(id);
    byId.set(id, {
      id,
      name: u?.name?.trim() || prev?.name || "",
      realName: u?.real_name?.trim() || prev?.realName || "",
      email: u?.email?.trim().toLowerCase() || prev?.email || "",
    });
  };
  for (const issue of issues) {
    add(issue.handler);
    add(issue.reporter);
    for (const note of issue.notes ?? []) add(note.reporter);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/** GET /issues 的回應:{ issues: [...] }。也容忍直接回陣列;沒有 id 的丟掉。 */
export function parseIssuesPage(json: unknown): MantisIssue[] {
  const list = Array.isArray(json) ? json : (json as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(list)) return [];
  return list.filter((i): i is MantisIssue => !!i && typeof i === "object" && Number.isInteger((i as MantisIssue).id));
}

/** GET /projects 的回應:{ projects: [...] }。 */
export function parseProjects(json: unknown): MantisProject[] {
  const list = Array.isArray(json) ? json : (json as { projects?: unknown } | null)?.projects;
  if (!Array.isArray(list)) return [];
  return list
    .filter((p): p is { id: number; name?: string } => !!p && typeof p === "object" && Number.isInteger((p as { id: number }).id))
    .map((p) => ({ id: p.id, name: p.name?.trim() || `專案 ${p.id}` }));
}
