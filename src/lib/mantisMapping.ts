/**
 * Mantis ↔ 本系統的欄位對應與寫回設定(每個連線各自一份,存在 MantisConnection.mapping)。純邏輯:
 * 不打 Mantis、不碰資料庫,同步程式、寫回程式、設定畫面與測試共用。
 *
 * 預設值 = 以前寫死在 mantis.ts 的規則(狀態看編號門檻、嚴重度換成衝擊 1–5),而且不寫回——
 * 沒設定過的連線行為跟以前完全一樣。
 */
import type { RiskStatus } from "@prisma/client";
import { impactWithMapping, statusWithMapping } from "./mantis";

export type MantisEnumEntry = { id: number; name: string; label?: string };
export type MantisEnums = {
  status: MantisEnumEntry[];
  severity: MantisEnumEntry[];
  priority: MantisEnumEntry[];
  resolution: MantisEnumEntry[];
};

/** Mantis 內建的列舉值;管理者的 Mantis 有改過的話,以設定畫面讀到的為準。 */
export const DEFAULT_ENUMS: MantisEnums = {
  status: [
    { id: 10, name: "new" },
    { id: 20, name: "feedback" },
    { id: 30, name: "acknowledged" },
    { id: 40, name: "confirmed" },
    { id: 50, name: "assigned" },
    { id: 80, name: "resolved" },
    { id: 90, name: "closed" },
  ],
  severity: [
    { id: 10, name: "feature" },
    { id: 20, name: "trivial" },
    { id: 30, name: "text" },
    { id: 40, name: "tweak" },
    { id: 50, name: "minor" },
    { id: 60, name: "major" },
    { id: 70, name: "crash" },
    { id: 80, name: "block" },
  ],
  priority: [
    { id: 10, name: "none" },
    { id: 20, name: "low" },
    { id: 30, name: "normal" },
    { id: 40, name: "high" },
    { id: 50, name: "urgent" },
    { id: 60, name: "immediate" },
  ],
  resolution: [
    { id: 10, name: "open" },
    { id: 20, name: "fixed" },
    { id: 30, name: "reopened" },
    { id: 40, name: "unable to reproduce" },
    { id: 50, name: "not fixable" },
    { id: 60, name: "duplicate" },
    { id: 70, name: "no change required" },
    { id: 80, name: "suspended" },
    { id: 90, name: "won't fix" },
  ],
};

/** 可以寫回 Mantis 的欄位類別。 */
export const WRITE_FIELDS = ["status", "handler", "severity", "content"] as const;
export type WriteField = (typeof WRITE_FIELDS)[number];
export const WRITE_FIELD_LABELS: Record<WriteField, string> = {
  status: "狀態",
  handler: "處理人(負責人)",
  severity: "嚴重度與優先權",
  content: "摘要、說明與到期日",
};

export type MantisRef = { id: number; name: string };

export type MantisMapping = {
  /** Mantis 狀態編號 → 本系統狀態(只有未處理 / 處理中 / 已結案);沒列到的編號走預設的編號門檻。 */
  statusIn: Record<string, RiskStatus>;
  /** 本系統狀態 → 寫回 Mantis 的狀態;沒設(例如待審核)就是這個狀態不寫回。 */
  statusOut: Partial<Record<RiskStatus, MantisRef>>;
  /** 寫回的狀態是 resolved / closed(編號 ≥ 80)時一併帶的 resolution。 */
  resolutionOut: MantisRef | null;
  /** Mantis 嚴重度編號 → 衝擊 1–5;沒列到的編號走預設規則。 */
  severityIn: Record<string, number>;
  /** 衝擊 1–5 → 寫回 Mantis 的嚴重度(key 是 "1"–"5")。 */
  severityOut: Record<string, MantisRef>;
  /** 本系統使用者 id → Mantis 使用者 id:Email 對不上時手動指定的對應。 */
  handlerOverrides: Record<string, number>;
  writeBack: { enabled: boolean; fields: WriteField[] };
  /** 這個 Mantis 的列舉值(設定畫面的下拉選單、寫回時查名稱用)。 */
  enums: MantisEnums;
};

const STATUS_IN_CHOICES: RiskStatus[] = ["OPEN", "MITIGATING", "CLOSED"];
const OUT_STATUSES: RiskStatus[] = ["OPEN", "MITIGATING", "PENDING_REVIEW", "CLOSED"];

const refOf = (list: MantisEnumEntry[], id: number): MantisRef => {
  const found = list.find((e) => e.id === id);
  return { id, name: found?.name ?? String(id) };
};

export function defaultMapping(): MantisMapping {
  const e = DEFAULT_ENUMS;
  return {
    statusIn: {},
    statusOut: {
      OPEN: refOf(e.status, 10),
      MITIGATING: refOf(e.status, 50),
      CLOSED: refOf(e.status, 80),
    },
    resolutionOut: refOf(e.resolution, 20),
    severityIn: {},
    severityOut: {
      "1": refOf(e.severity, 20),
      "2": refOf(e.severity, 40),
      "3": refOf(e.severity, 50),
      "4": refOf(e.severity, 60),
      "5": refOf(e.severity, 70),
    },
    handlerOverrides: {},
    writeBack: { enabled: false, fields: [...WRITE_FIELDS] },
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

/**
 * 讀資料庫裡存的設定:缺的、壞的地方都用預設值補,絕不丟例外——同步不能因為一份壞掉的設定整批失敗。
 */
export function parseMapping(json: unknown): MantisMapping {
  const out = defaultMapping();
  if (!isObj(json)) return out;

  if (isObj(json.enums)) {
    for (const key of ["status", "severity", "priority", "resolution"] as const) {
      const list = parseEnumList(json.enums[key]);
      if (list) out.enums[key] = list;
    }
  }
  if (isObj(json.statusIn)) {
    for (const [id, status] of Object.entries(json.statusIn)) {
      if (isPosInt(Number(id)) && STATUS_IN_CHOICES.includes(status as RiskStatus)) out.statusIn[id] = status as RiskStatus;
    }
  }
  if (isObj(json.statusOut)) {
    const next: MantisMapping["statusOut"] = {};
    for (const status of OUT_STATUSES) {
      const ref = parseRef(json.statusOut[status]);
      if (ref) next[status] = ref;
    }
    out.statusOut = next;
  }
  if ("resolutionOut" in json) out.resolutionOut = parseRef(json.resolutionOut);
  if (isObj(json.severityIn)) {
    for (const [id, impact] of Object.entries(json.severityIn)) {
      if (isPosInt(Number(id)) && typeof impact === "number" && Number.isInteger(impact) && impact >= 1 && impact <= 5) {
        out.severityIn[id] = impact;
      }
    }
  }
  if (isObj(json.severityOut)) {
    const next: MantisMapping["severityOut"] = {};
    for (const impact of ["1", "2", "3", "4", "5"]) {
      const ref = parseRef(json.severityOut[impact]);
      if (ref) next[impact] = ref;
    }
    out.severityOut = next;
  }
  if (isObj(json.handlerOverrides)) {
    for (const [userId, mantisId] of Object.entries(json.handlerOverrides)) {
      if (userId && isPosInt(mantisId)) out.handlerOverrides[userId] = mantisId;
    }
  }
  if (isObj(json.writeBack)) {
    const fields = Array.isArray(json.writeBack.fields)
      ? WRITE_FIELDS.filter((f) => (json.writeBack as { fields: unknown[] }).fields.includes(f))
      : [...WRITE_FIELDS];
    out.writeBack = { enabled: json.writeBack.enabled === true, fields };
  }
  return out;
}

/** 設定畫面送來的設定:驗證過才存。跟 parseMapping 不同,有問題就回說明,不默默補預設。 */
export function validateMapping(input: unknown): { mapping: MantisMapping } | { error: string } {
  if (!isObj(input)) return { error: "設定的格式不對" };
  const parsed = parseMapping(input);

  // 狀態、嚴重度、衝擊的對應表有東西被丟掉,代表送來的值不合法。
  const dropped = (label: string, sent: unknown, kept: Record<string, unknown>) =>
    isObj(sent) && Object.keys(sent).length !== Object.keys(kept).length ? `${label}有不合法的項目` : null;
  const problem =
    dropped("「Mantis 狀態 → 本系統狀態」", input.statusIn, parsed.statusIn) ??
    dropped("「Mantis 嚴重度 → 衝擊」", input.severityIn, parsed.severityIn) ??
    dropped("「處理人對應」", input.handlerOverrides, parsed.handlerOverrides);
  if (problem) return { error: problem };

  if (parsed.writeBack.enabled && parsed.writeBack.fields.length === 0) return { error: "開啟寫回時,至少要勾一類要寫回的欄位" };
  if (parsed.writeBack.enabled && parsed.writeBack.fields.includes("status") && !parsed.statusOut.CLOSED) {
    return { error: "要寫回狀態的話,「已結案」要指定寫回 Mantis 的哪個狀態" };
  }
  return { mapping: parsed };
}

export function isWriteEnabled(mapping: MantisMapping, field: WriteField): boolean {
  return mapping.writeBack.enabled && mapping.writeBack.fields.includes(field);
}

/** Mantis 狀態編號 → 本系統狀態:對應表有就用,沒有走預設的編號門檻。 */
export function statusFromMantis(mapping: MantisMapping, statusId: number | undefined): RiskStatus {
  return statusWithMapping(mapping.statusIn, statusId);
}

/** Mantis 嚴重度編號 → 衝擊 1–5。 */
export function impactFromMantis(mapping: MantisMapping, severityId: number | undefined): number {
  return impactWithMapping(mapping.severityIn, severityId);
}

/** 本系統狀態 → 要寫回 Mantis 的狀態;這個狀態不寫回就是 null。 */
export function statusToMantis(mapping: MantisMapping, status: RiskStatus): MantisRef | null {
  return mapping.statusOut[status] ?? null;
}

/** 衝擊 1–5 → 要寫回 Mantis 的嚴重度。 */
export function severityToMantis(mapping: MantisMapping, impact: number): MantisRef | null {
  return mapping.severityOut[String(impact)] ?? null;
}

/** 設定畫面「Mantis → 本系統」那兩張表的每一列:每個 Mantis 列舉值,以及目前會對應成什麼。 */
export function effectiveStatusRows(mapping: MantisMapping): { entry: MantisEnumEntry; status: RiskStatus; explicit: boolean }[] {
  return mapping.enums.status.map((entry) => ({
    entry,
    status: statusFromMantis(mapping, entry.id),
    explicit: mapping.statusIn[String(entry.id)] !== undefined,
  }));
}
export function effectiveSeverityRows(mapping: MantisMapping): { entry: MantisEnumEntry; impact: number; explicit: boolean }[] {
  return mapping.enums.severity.map((entry) => ({
    entry,
    impact: impactFromMantis(mapping, entry.id),
    explicit: mapping.severityIn[String(entry.id)] !== undefined,
  }));
}

/** Mantis 設定值 "10:new,20:feedback,…" → 列舉清單。看不懂的片段丟掉。 */
export function parseEnumString(value: string): MantisEnumEntry[] {
  const out: MantisEnumEntry[] = [];
  for (const part of value.split(",")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const id = Number(part.slice(0, i).trim());
    const name = part.slice(i + 1).trim();
    if (isPosInt(id) && name) out.push({ id, name });
  }
  return out;
}

const CONFIG_OPTIONS = {
  status: "status_enum_string",
  severity: "severity_enum_string",
  priority: "priority_enum_string",
  resolution: "resolution_enum_string",
} as const;
export const ENUM_CONFIG_OPTIONS = Object.values(CONFIG_OPTIONS);

/**
 * GET /config 的回應({ configs: [{ option, value }] })與 GET /lang 的回應({ strings: [{ name, localized }] })
 * 組成列舉清單。config 給編號與英文名稱(寫回用這個),lang 給依使用者語言翻過的顯示文字(沒有就不放)。
 * 某一類讀不到就用 Mantis 內建的。
 */
export function enumsFromMantis(configJson: unknown, langJson?: unknown): MantisEnums {
  const out: MantisEnums = structuredClone(DEFAULT_ENUMS);
  const configs = isObj(configJson) && Array.isArray(configJson.configs) ? configJson.configs : [];
  const strings = isObj(langJson) && Array.isArray(langJson.strings) ? langJson.strings : [];
  for (const key of Object.keys(CONFIG_OPTIONS) as (keyof typeof CONFIG_OPTIONS)[]) {
    const option = CONFIG_OPTIONS[key];
    const cfg = configs.find((c) => isObj(c) && c.option === option) as { value?: unknown } | undefined;
    const names = typeof cfg?.value === "string" ? parseEnumString(cfg.value) : [];
    if (names.length === 0) continue;
    const lang = strings.find((s) => isObj(s) && s.name === option) as { localized?: unknown } | undefined;
    const labels = new Map((typeof lang?.localized === "string" ? parseEnumString(lang.localized) : []).map((e) => [e.id, e.name]));
    out[key] = names.map((e) => {
      const label = labels.get(e.id);
      return label && label !== e.name ? { ...e, label } : e;
    });
  }
  return out;
}
