/**
 * ISSUE TRACKER ↔ MantisBT 的欄位對應與寫回內容。純邏輯:不打 Mantis、不碰資料庫,同步程式、寫回程式、設定畫面與測試共用。
 *
 * 跟專案管理系統(mantisMapping.ts / mantisPatch.ts)同一套做法,只是本系統這一端是「案件」:
 *   Mantis 摘要 → 問題描述;說明(+最近備註)→ 規格與行為;狀態 → 狀態(已解決 TC、已關閉 PC);
 *   處理人 → 負責人;嚴重度 → 優先級 P0–P3;建立時間 → 發生日期。
 * Mantis 沒有的欄位(客戶、產品型號、問題類型、零件、工時…)只在 ISSUE TRACKER 填,同步不會動。
 */
import { toTaipei } from "./googleCalendar";
import { buildDescription, splitMantisDescription, type MantisIssue, type MantisUser } from "./mantis";
import { DEFAULT_ENUMS, type MantisEnumEntry, type MantisEnums, type MantisRef } from "./mantisMapping";
import { matchMantisPerson } from "./mantisPeople";

export type CaseStatus = "OPEN" | "TC" | "PC" | "NA";
export type CasePriority = "P0" | "P1" | "P2" | "P3";

export const ISSUE_WRITE_FIELDS = ["status", "handler", "priority", "content"] as const;
export type IssueWriteField = (typeof ISSUE_WRITE_FIELDS)[number];
export const ISSUE_WRITE_FIELD_LABELS: Record<IssueWriteField, string> = {
  status: "狀態",
  handler: "負責人",
  priority: "優先級(Mantis 嚴重度)",
  content: "問題描述與規格與行為",
};

export type IssueMantisMapping = {
  /** Mantis 狀態編號 → 案件狀態;沒列到的走預設(≥90 已關閉 → PC、≥80 已解決 → TC、其他處理中)。 */
  statusIn: Record<string, CaseStatus>;
  /** 案件狀態 → 寫回 Mantis 的狀態;沒設(例如不適用 NA)就是這個狀態不寫回。 */
  statusOut: Partial<Record<CaseStatus, MantisRef>>;
  /** 寫回的狀態是 resolved / closed(編號 ≥ 80)時一併帶的 resolution。 */
  resolutionOut: MantisRef | null;
  /** Mantis 嚴重度編號 → 優先級;沒列到的走預設(當機 / 阻擋 P0、重大 P1、次要 P2、其餘 P3)。 */
  priorityIn: Record<string, CasePriority>;
  /** 優先級 → 寫回 Mantis 的嚴重度。 */
  priorityOut: Partial<Record<CasePriority, MantisRef>>;
  /** 本系統使用者 id → Mantis 使用者 id:Email 與名稱都對不上時手動指定。 */
  handlerOverrides: Record<string, number>;
  /** 建立到 Mantis 時用的分類(Mantis 必填):預設分類,與「產品型號選項 id → 分類」的對應。 */
  categoryDefault: string | null;
  categoryByProduct: Record<string, string>;
  writeBack: { enabled: boolean; fields: IssueWriteField[] };
  /** 這個 Mantis 的列舉值(設定畫面的下拉選單、寫回時查名稱用)。 */
  enums: MantisEnums;
};

const STATUSES: CaseStatus[] = ["OPEN", "TC", "PC", "NA"];
const PRIORITIES: CasePriority[] = ["P0", "P1", "P2", "P3"];

const refOf = (list: MantisEnumEntry[], id: number): MantisRef => {
  const found = list.find((e) => e.id === id);
  return { id, name: found?.name ?? String(id) };
};

export function defaultIssueMapping(): IssueMantisMapping {
  const e = DEFAULT_ENUMS;
  return {
    statusIn: {},
    statusOut: { OPEN: refOf(e.status, 50), TC: refOf(e.status, 80), PC: refOf(e.status, 90) },
    resolutionOut: refOf(e.resolution, 20),
    priorityIn: {},
    priorityOut: { P0: refOf(e.severity, 70), P1: refOf(e.severity, 60), P2: refOf(e.severity, 50), P3: refOf(e.severity, 20) },
    handlerOverrides: {},
    categoryDefault: null,
    categoryByProduct: {},
    writeBack: { enabled: false, fields: [...ISSUE_WRITE_FIELDS] },
    enums: structuredClone(e),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;

function parseRef(v: unknown): MantisRef | null {
  if (!isObj(v) || !isPosInt(v.id)) return null;
  const name = typeof v.name === "string" ? v.name.trim() : "";
  return name ? { id: v.id, name } : null;
}

function parseEnumList(v: unknown): MantisEnumEntry[] | null {
  if (!Array.isArray(v)) return null;
  const out: MantisEnumEntry[] = [];
  for (const item of v) {
    if (!isObj(item) || !isPosInt(item.id) || typeof item.name !== "string" || !item.name.trim()) continue;
    const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined;
    out.push({ id: item.id, name: item.name.trim(), ...(label ? { label } : {}) });
  }
  return out.length > 0 ? out : null;
}

const cleanCategory = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 100) : null);

/** 讀資料庫裡存的設定:缺的、壞的地方都用預設值補,絕不丟例外——同步不能因為一份壞掉的設定整批失敗。 */
export function parseIssueMapping(json: unknown): IssueMantisMapping {
  const out = defaultIssueMapping();
  if (!isObj(json)) return out;
  if (isObj(json.enums)) {
    for (const key of ["status", "severity", "priority", "resolution"] as const) {
      const list = parseEnumList(json.enums[key]);
      if (list) out.enums[key] = list;
    }
  }
  if (isObj(json.statusIn)) {
    for (const [id, status] of Object.entries(json.statusIn)) {
      if (isPosInt(Number(id)) && STATUSES.includes(status as CaseStatus)) out.statusIn[id] = status as CaseStatus;
    }
  }
  if (isObj(json.statusOut)) {
    const next: IssueMantisMapping["statusOut"] = {};
    for (const status of STATUSES) {
      const ref = parseRef(json.statusOut[status]);
      if (ref) next[status] = ref;
    }
    out.statusOut = next;
  }
  if ("resolutionOut" in json) out.resolutionOut = parseRef(json.resolutionOut);
  if (isObj(json.priorityIn)) {
    for (const [id, p] of Object.entries(json.priorityIn)) {
      if (isPosInt(Number(id)) && PRIORITIES.includes(p as CasePriority)) out.priorityIn[id] = p as CasePriority;
    }
  }
  if (isObj(json.priorityOut)) {
    const next: IssueMantisMapping["priorityOut"] = {};
    for (const p of PRIORITIES) {
      const ref = parseRef(json.priorityOut[p]);
      if (ref) next[p] = ref;
    }
    out.priorityOut = next;
  }
  if (isObj(json.handlerOverrides)) {
    for (const [userId, mantisId] of Object.entries(json.handlerOverrides)) {
      if (userId && isPosInt(mantisId)) out.handlerOverrides[userId] = mantisId;
    }
  }
  out.categoryDefault = cleanCategory(json.categoryDefault);
  if (isObj(json.categoryByProduct)) {
    for (const [productId, name] of Object.entries(json.categoryByProduct)) {
      const c = cleanCategory(name);
      if (productId && c) out.categoryByProduct[productId] = c;
    }
  }
  if (isObj(json.writeBack)) {
    const fields = Array.isArray(json.writeBack.fields)
      ? ISSUE_WRITE_FIELDS.filter((f) => (json.writeBack as { fields: unknown[] }).fields.includes(f))
      : [...ISSUE_WRITE_FIELDS];
    out.writeBack = { enabled: json.writeBack.enabled === true, fields };
  }
  return out;
}

/** 設定畫面送來的設定:驗證過才存。跟 parseIssueMapping 不同,有問題就回說明,不默默補預設。 */
export function validateIssueMapping(input: unknown): { mapping: IssueMantisMapping } | { error: string } {
  if (!isObj(input)) return { error: "設定的格式不對" };
  const parsed = parseIssueMapping(input);
  const dropped = (label: string, sent: unknown, kept: Record<string, unknown>) =>
    isObj(sent) && Object.keys(sent).length !== Object.keys(kept).length ? `${label}有不合法的項目` : null;
  const problem =
    dropped("「Mantis 狀態 → 案件狀態」", input.statusIn, parsed.statusIn) ??
    dropped("「Mantis 嚴重度 → 優先級」", input.priorityIn, parsed.priorityIn) ??
    dropped("「負責人對應」", input.handlerOverrides, parsed.handlerOverrides);
  if (problem) return { error: problem };
  if (parsed.writeBack.enabled && parsed.writeBack.fields.length === 0) return { error: "開啟寫回時,至少要勾一類要寫回的欄位" };
  if (parsed.writeBack.enabled && parsed.writeBack.fields.includes("status") && !parsed.statusOut.PC) {
    return { error: "要寫回狀態的話,「永久解決」要指定寫回 Mantis 的哪個狀態" };
  }
  return { mapping: parsed };
}

export function isWriteEnabled(mapping: IssueMantisMapping, field: IssueWriteField): boolean {
  return mapping.writeBack.enabled && mapping.writeBack.fields.includes(field);
}

/** Mantis 狀態編號 → 案件狀態:對應表有就用,沒有走預設的編號門檻。 */
export function statusFromMantis(mapping: IssueMantisMapping, statusId: number | undefined): CaseStatus {
  if (statusId !== undefined && mapping.statusIn[String(statusId)]) return mapping.statusIn[String(statusId)];
  if (statusId === undefined) return "OPEN";
  if (statusId >= 90) return "PC";
  if (statusId >= 80) return "TC";
  return "OPEN";
}

/** Mantis 嚴重度編號 → 優先級:對應表有就用,沒有走預設(當機 / 阻擋 P0、重大 P1、次要 P2、其餘 P3)。 */
export function priorityFromMantis(mapping: IssueMantisMapping, severityId: number | undefined): CasePriority {
  if (severityId !== undefined && mapping.priorityIn[String(severityId)]) return mapping.priorityIn[String(severityId)];
  if (severityId === undefined) return "P2";
  if (severityId >= 70) return "P0";
  if (severityId >= 60) return "P1";
  if (severityId >= 50) return "P2";
  return "P3";
}

export const statusToMantis = (mapping: IssueMantisMapping, status: CaseStatus): MantisRef | null => mapping.statusOut[status] ?? null;
export const priorityToMantis = (mapping: IssueMantisMapping, priority: CasePriority): MantisRef | null => mapping.priorityOut[priority] ?? null;

/** 建立到 Mantis 用的分類:產品型號有對應就用它,沒有用預設分類;都沒有回 null。 */
export function categoryFor(mapping: IssueMantisMapping, productId: string | null): string | null {
  return (productId ? mapping.categoryByProduct[productId] : undefined) ?? mapping.categoryDefault;
}

// ── 文字內容 ──────────────────────────────────────────────

const SUMMARY_MAX = 128;
const norm = (s: string | null | undefined) => (s ?? "").replace(/\r\n/g, "\n").trim();
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * 案件的文字 → Mantis 的摘要與說明。摘要是問題描述的第一行(Mantis 限 128 字);
 * 說明是「規格與行為」(不含接在後面的 Mantis 備註區塊),沒有的話用完整的問題描述;兩個都空就用摘要。
 */
export function contentToMantis(c: { description: string; behavior: string }): { summary: string; description: string } {
  const body = splitMantisDescription(c.behavior).description;
  const firstLine = norm(c.description).split("\n").find((l) => l.trim()) ?? norm(body).split("\n").find((l) => l.trim()) ?? "";
  const summary = oneLine(firstLine).slice(0, SUMMARY_MAX);
  const description = norm(body) || norm(c.description) || summary;
  return { summary, description };
}

/** Mantis 的問題 → 案件的問題描述(摘要)與規格與行為(說明 + 最近備註)。 */
export function textFromMantis(issue: MantisIssue): { description: string; behavior: string } {
  return { description: oneLine(issue.summary ?? "") || `Mantis #${issue.id}`, behavior: buildDescription(issue) };
}

/** 案件目前的文字,送去 Mantis 的話跟 Mantis 上現在的內容一樣嗎?一樣就不用用 Mantis 的蓋回來(也就不會把使用者多寫的字吃掉)。 */
export function mantisTextMatchesCase(issue: MantisIssue, c: { description: string; behavior: string }): boolean {
  const mine = contentToMantis(c);
  return norm(issue.summary) === norm(mine.summary) && norm(issue.description) === norm(mine.description);
}

export type MantisCaseFields = {
  mantisId: number;
  mantisUpdatedAt: Date | null;
  status: CaseStatus;
  priority: CasePriority;
  description: string;
  behavior: string;
  /** Mantis 建立時間的台灣日期(新案件的發生日期用)。 */
  issueDate: string | null;
  /** Mantis 最後更新的台灣日期(案件變成已解決時,沒有結案日期就用這個)。 */
  updatedDate: string | null;
  handler: { id: number | null; name: string | null; realName: string | null; email: string | null } | null;
  reporter: { id: number | null; name: string | null; realName: string | null; email: string | null } | null;
};

const toMs = (text: string | undefined) => {
  const ms = text ? Date.parse(text) : NaN;
  return Number.isNaN(ms) ? null : ms;
};
const person = (u: MantisIssue["handler"]) =>
  u && (u.id || u.name || u.email)
    ? { id: Number.isInteger(u.id) && (u.id as number) > 0 ? (u.id as number) : null, name: u.name?.trim() || null, realName: u.real_name?.trim() || null, email: u.email?.trim().toLowerCase() || null }
    : null;

/** Mantis 的問題 → 要放進案件的欄位(同步用)。 */
export function mantisToCaseFields(issue: MantisIssue, mapping: IssueMantisMapping): MantisCaseFields {
  const created = toMs(issue.created_at);
  const updated = toMs(issue.updated_at);
  return {
    mantisId: issue.id,
    mantisUpdatedAt: updated === null ? null : new Date(updated),
    status: statusFromMantis(mapping, issue.status?.id),
    priority: priorityFromMantis(mapping, issue.severity?.id),
    ...textFromMantis(issue),
    issueDate: created === null ? null : toTaipei(created).date,
    updatedDate: updated === null ? null : toTaipei(updated).date,
    handler: person(issue.handler),
    reporter: person(issue.reporter),
  };
}

// ── 寫回(PATCH)與建立(POST)的內容 ──────────────────────────

/** 這一次要改的欄位;沒給的就是沒改。 */
export type IssueMantisChange = {
  status?: CaseStatus;
  /** 新的負責人(本系統使用者);null = 取消指派。 */
  owner?: { id: string; name: string; email: string } | null;
  priority?: CasePriority;
  /** 兩個一起給才比對文字(摘要與說明是從這兩欄一起算出來的)。 */
  text?: { description: string; behavior: string };
};

export type IssueMantisPatch = { payload: Record<string, unknown>; summary: string[] };

const refText = (e: { id?: number; name?: string; label?: string } | undefined) => e?.label || e?.name || "—";

/** 本系統的負責人 → Mantis 使用者編號:先看手動對應,再用 Email / 名稱比對同步時收集到的 Mantis 使用者。 */
export function resolveMantisHandler(
  owner: { id: string; name: string; email: string },
  mapping: IssueMantisMapping,
  users: MantisUser[]
): { id: number } | { error: string } {
  const found = matchMantisPerson(owner, users, mapping.handlerOverrides);
  if (found) return { id: found.user.id };
  return { error: `找不到「${owner.name}」對應的 Mantis 帳號(Email、姓名、帳號名稱都比對不到)。請管理者到 ISSUE TRACKER 設定的 Mantis 卡片「負責人對應」手動指定。` };
}

export function buildIssuePatch(
  change: IssueMantisChange,
  ctx: { mapping: IssueMantisMapping; issue: MantisIssue; mantisUsers: MantisUser[] }
): IssueMantisPatch | { error: string } {
  const { mapping, issue } = ctx;
  const payload: Record<string, unknown> = {};
  const summary: string[] = [];
  const locked = (field: IssueWriteField) => ({ error: `這個連線沒有開啟寫回「${ISSUE_WRITE_FIELD_LABELS[field]}」,這個欄位請到 Mantis 修改。` });

  if (change.status !== undefined) {
    const target = statusToMantis(mapping, change.status);
    if (target && statusFromMantis(mapping, issue.status?.id) !== change.status) {
      if (!isWriteEnabled(mapping, "status")) return locked("status");
      payload.status = { id: target.id, name: target.name };
      if (target.id >= 80 && mapping.resolutionOut) payload.resolution = { id: mapping.resolutionOut.id, name: mapping.resolutionOut.name };
      summary.push(`狀態:${refText(issue.status)} → ${target.name}`);
    }
  }

  if (change.owner !== undefined) {
    const currentId = issue.handler?.id ?? null;
    if (change.owner === null) {
      if (currentId !== null) return { error: "Mantis 的 API 不能清掉處理人,要取消指派請到 Mantis 上操作。" };
    } else {
      const target = resolveMantisHandler(change.owner, mapping, ctx.mantisUsers);
      if ("error" in target) return target;
      if (target.id !== currentId) {
        if (!isWriteEnabled(mapping, "handler")) return locked("handler");
        payload.handler = { id: target.id };
        summary.push(`處理人:${issue.handler?.real_name || issue.handler?.name || "未指派"} → ${change.owner.name}`);
      }
    }
  }

  if (change.priority !== undefined) {
    const target = priorityToMantis(mapping, change.priority);
    if (target && priorityFromMantis(mapping, issue.severity?.id) !== change.priority) {
      if (!isWriteEnabled(mapping, "priority")) return locked("priority");
      payload.severity = { id: target.id, name: target.name };
      summary.push(`嚴重度:${refText(issue.severity)} → ${target.name}`);
    }
  }

  if (change.text !== undefined) {
    const next = contentToMantis(change.text);
    if (norm(next.summary) !== norm(issue.summary) || norm(next.description) !== norm(issue.description)) {
      if (!isWriteEnabled(mapping, "content")) return locked("content");
      if (!next.summary) return { error: "Mantis 的摘要不能留空(問題描述要有內容)。" };
      if (norm(next.summary) !== norm(issue.summary)) {
        payload.summary = next.summary;
        summary.push("摘要");
      }
      if (norm(next.description) !== norm(issue.description)) {
        payload.description = next.description;
        summary.push("說明");
      }
    }
  }
  return { payload, summary };
}

/** 建立到 Mantis(POST /issues)的內容;分類是 Mantis 必填,沒有設定回錯誤說明。 */
export function buildIssueCreate(
  c: { description: string; behavior: string; productId: string | null; priority: CasePriority },
  ctx: { mapping: IssueMantisMapping; projectId: number }
): { payload: Record<string, unknown> } | { error: string } {
  const category = categoryFor(ctx.mapping, c.productId);
  if (!category) return { error: "Mantis 建立問題單一定要有分類:請管理者到 ISSUE TRACKER 設定的 Mantis 卡片設定「預設分類」。" };
  const text = contentToMantis(c);
  if (!text.summary) return { error: "問題描述是空的,Mantis 的摘要不能留空。" };
  const severity = priorityToMantis(ctx.mapping, c.priority);
  return {
    payload: {
      summary: text.summary,
      description: text.description,
      project: { id: ctx.projectId },
      category: { name: category },
      ...(severity ? { severity: { id: severity.id, name: severity.name } } : {}),
    },
  };
}

/** 建立後要補的欄位(狀態、負責人):用「全開」的寫回設定算,因為這是使用者明確要求建立,不看「允許寫回」的開關。 */
export function forcedWriteMapping(mapping: IssueMantisMapping): IssueMantisMapping {
  return { ...mapping, writeBack: { enabled: true, fields: [...ISSUE_WRITE_FIELDS] } };
}
