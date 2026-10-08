import { isValidIsoDate } from "@/lib/timesheet";

/**
 * NRE(一次性工程費用)報價單 — 純邏輯。
 *
 * 報價單是估算與報價的依據,逐列填:類別、細項說明、估算基礎、數量、單價、金額、備註。
 * 它跟預算的「核准預算」是兩件事:這裡的合計不會寫進核准預算,兩邊各自獨立。
 *
 * 「委託開發」這一類比較特別:委託外部單位開發的項目,有委託單位、委託項目、時間範圍,
 * 而且可以指定是哪一個階段、或是涵蓋整個專案(不屬於任何一個階段)。
 */

export const NRE_CATEGORIES = ["LABOUR", "COMMISSIONED", "TOOLING", "PROTOTYPE", "CERTIFICATION"] as const;
export type NreCategoryKey = (typeof NRE_CATEGORIES)[number];

export const NRE_LABELS: Record<NreCategoryKey, string> = {
  LABOUR: "研發人力工時",
  COMMISSIONED: "委託開發",
  TOOLING: "模具與治具",
  PROTOTYPE: "打樣與樣品",
  CERTIFICATION: "驗證與認證",
};

/** 每一類的說明與欄位名稱——研發人力是外部單位的工時,數量放工時、單價放時薪。 */
export const NRE_CATEGORY_GUIDE: Record<
  NreCategoryKey,
  {
    hint: string;
    vendorLabel: string;
    quantityLabel: string;
    unitPriceLabel: string;
    descriptionExample: string;
    basisExample: string;
    /** 第一個欄位的名稱:大多是「細項說明」,委託開發是「委託項目」。 */
    descriptionLabel: string;
  }
> = {
  LABOUR: {
    hint: "外部單位或外部人員投入的研發工時(電路、機構、韌體、軟體設計等)。填工時與時薪,金額自動相乘。",
    vendorLabel: "外部單位 / 人員",
    quantityLabel: "工時(小時)",
    unitPriceLabel: "時薪(元)",
    descriptionExample: "機構 / 電路設計、軟韌體客製化",
    basisExample: "3 位工程師 × 3 個月",
    descriptionLabel: "細項說明",
  },
  COMMISSIONED: {
    hint: "委託外部單位開發的項目(例如委外設計、委託開發軟體或模組):填委託單位、委託項目、時間範圍,以及範圍——哪一個階段、或涵蓋整個專案(涵蓋整個專案的每個階段都看得到,整個專案的合計只算一次)。",
    vendorLabel: "委託單位",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "主控板硬體設計與打樣",
    basisExample: "依合約,分三期付款",
    descriptionLabel: "委託項目",
  },
  TOOLING: {
    hint: "外殼鋼模、生產組裝治具、電測夾具——通常是 NRE 裡佔比最高的一塊。",
    vendorLabel: "廠商",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "外殼塑膠射出鋼模(全套主體 + 按鍵)",
    basisExample: "1 套,壽命約 30 萬模次",
    descriptionLabel: "細項說明",
  },
  PROTOTYPE: {
    hint: "量產前各階段的打樣與測試樣品:PCB 打樣、3D 列印、CNC 外觀樣品、小批量試產。",
    vendorLabel: "廠商",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "PCB 電路板快速打樣(PCBA)",
    basisExample: "5 片(功能驗證用)",
    descriptionLabel: "細項說明",
  },
  CERTIFICATION: {
    hint: "環境、壽命等信賴度測試,以及法規認證(CE、FCC、BSMI)的實驗室費用與規費。",
    vendorLabel: "實驗室 / 代辦",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "法規安規認證(CE / FCC 規費與代辦)",
    basisExample: "專案打包",
    descriptionLabel: "細項說明",
  },
};

/** 「涵蓋整個專案」在範圍欄位裡的名字(存的是 phaseId = null)。 */
export const WHOLE_PROJECT_LABEL = "整個專案";

/** 時間範圍的顯示:"2026-10-08 ~ 2026-12-31";沒填是空字串。 */
export function formatDateRange(start: string | null, end: string | null): string {
  return start && end ? `${start} ~ ${end}` : "";
}

export type NreLineInput = {
  category: NreCategoryKey;
  /** 這一列掛在哪個階段;null = 涵蓋整個專案(只有委託開發可以)。 */
  phaseId: string | null;
  /** 時間範圍,"YYYY-MM-DD"(只有委託開發有;起訖要一起填或一起空白)。 */
  startDate: string | null;
  endDate: string | null;
  description: string;
  basis: string;
  vendor: string;
  quantity: number | null;
  unitPrice: number | null;
  /** 直接填的金額;數量與單價都有時以相乘為準。 */
  amount: number;
  note: string;
};

export const MAX_NRE_LINES_PER_PHASE = 200;
export const MAX_NRE_AMOUNT = 2_000_000_000;

/** 有數量(大於 0)也有單價(0 以上)就是兩者相乘,四捨五入到元;否則用直接填的金額。 */
export function resolveNreAmount(input: Pick<NreLineInput, "quantity" | "unitPrice" | "amount">): number {
  const { quantity, unitPrice } = input;
  if (quantity !== null && unitPrice !== null && quantity > 0 && unitPrice >= 0) return Math.round(quantity * unitPrice);
  return Math.round(input.amount);
}

/** 存之前的檢查——回傳錯誤訊息,沒問題回 null。 */
export function validateNreLine(input: NreLineInput): string | null {
  if (!NRE_CATEGORIES.includes(input.category)) return "不認得這個類別";
  const label = NRE_CATEGORY_GUIDE[input.category].descriptionLabel;
  if (input.description.trim() === "") return `請填${label}`;
  if (input.description.length > 200) return `${label}太長了(上限 200 字)`;
  if (input.category !== "COMMISSIONED") {
    if (input.phaseId === null) return "只有委託開發可以涵蓋整個專案,其他類別要屬於一個階段";
    if (input.startDate !== null || input.endDate !== null) return "只有委託開發有時間範圍";
  } else if (input.startDate !== null || input.endDate !== null) {
    if (input.startDate === null || input.endDate === null) return "時間範圍要填起訖兩個日期,或兩個都不填";
    if (!isValidIsoDate(input.startDate) || !isValidIsoDate(input.endDate)) return "時間範圍的日期格式不對(請用 2026-10-08)";
    if (input.endDate < input.startDate) return "時間範圍的結束日不能早於開始日";
  }
  if (input.basis.length > 200) return "估算基礎太長了(上限 200 字)";
  if (input.vendor.length > 100) return "廠商 / 人員太長了(上限 100 字)";
  if (input.note.length > 500) return "備註太長了(上限 500 字)";
  if (input.quantity !== null && (!Number.isFinite(input.quantity) || input.quantity < 0)) return "數量必須是 0 或正數";
  if (input.unitPrice !== null && (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)) return "單價必須是 0 或正數";
  if (!Number.isFinite(input.amount) || input.amount < 0) return "金額必須是 0 或正數";
  if (resolveNreAmount(input) > MAX_NRE_AMOUNT) return "金額太大了";
  return null;
}

export type NreProjectSummary = {
  /** 每個階段一列(照階段的順序,沒填報價單的階段也在,金額是 0)。 */
  rows: { phaseId: string; phaseName: string; byCategory: Record<NreCategoryKey, number>; total: number }[];
  /** 涵蓋整個專案(不屬於任何階段)的委託開發。 */
  projectWide: { byCategory: Record<NreCategoryKey, number>; total: number };
  /** 全部加起來:各階段加上涵蓋整個專案的。 */
  byCategory: Record<NreCategoryKey, number>;
  total: number;
};

/** 整個專案的 NRE:各階段報價單的每一類小計與合計、涵蓋整個專案的委託開發,以及全部加起來。 */
export function summarizeNreByPhase(
  phases: { id: string; name: string }[],
  lines: { phaseId: string | null; category: NreCategoryKey; amount: number }[]
): NreProjectSummary {
  const zero = () => Object.fromEntries(NRE_CATEGORIES.map((c) => [c, 0])) as Record<NreCategoryKey, number>;
  const rows = phases.map((p) => ({ phaseId: p.id, phaseName: p.name, byCategory: zero(), total: 0 }));
  const byPhase = new Map(rows.map((r) => [r.phaseId, r]));
  const projectWide = { byCategory: zero(), total: 0 };
  const byCategory = zero();
  let total = 0;
  for (const line of lines) {
    const target = line.phaseId === null ? projectWide : byPhase.get(line.phaseId);
    if (!target) continue;
    target.byCategory[line.category] += line.amount;
    target.total += line.amount;
    byCategory[line.category] += line.amount;
    total += line.amount;
  }
  return { rows, projectWide, byCategory, total };
}

export type NreSummary = {
  byCategory: Record<NreCategoryKey, { count: number; total: number }>;
  count: number;
  total: number;
};

export function summarizeNre(lines: { category: NreCategoryKey; amount: number }[]): NreSummary {
  const byCategory = Object.fromEntries(NRE_CATEGORIES.map((c) => [c, { count: 0, total: 0 }])) as NreSummary["byCategory"];
  let total = 0;
  for (const line of lines) {
    byCategory[line.category].count += 1;
    byCategory[line.category].total += line.amount;
    total += line.amount;
  }
  return { byCategory, count: lines.length, total };
}

/** 資料庫裡已經存在的一列(匯入比對用)。 */
export type NreExistingLine = {
  id: string;
  category: NreCategoryKey;
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

/** 兩邊的內容(算好的金額、去掉頭尾空白之後)是不是完全一樣。 */
export function sameNreContent(input: NreLineInput, line: NreExistingLine): boolean {
  return (
    input.description.trim() === line.description &&
    input.basis.trim() === line.basis &&
    input.vendor.trim() === line.vendor &&
    input.quantity === line.quantity &&
    (input.unitPrice === null ? null : Math.round(input.unitPrice)) === line.unitPrice &&
    resolveNreAmount(input) === line.amount &&
    input.note.trim() === line.note &&
    input.phaseId === line.phaseId &&
    input.startDate === line.startDate &&
    input.endDate === line.endDate
  );
}

/** 這一列改了哪些欄位,寫成一句話,給匯入前的確認用。 */
export function describeNreChange(
  before: NreExistingLine,
  input: NreLineInput,
  /** 階段的名字(範圍欄位用);沒給就不說範圍改了什麼名字。 */
  phaseName: (phaseId: string | null) => string = (id) => (id === null ? WHOLE_PROJECT_LABEL : id)
): string {
  const money = (n: number) => Math.round(n).toLocaleString("zh-TW");
  const text = (s: string) => (s === "" ? "(空白)" : s);
  const num = (n: number | null) => (n === null ? "(空白)" : String(n));
  const parts: string[] = [];
  if (input.phaseId !== before.phaseId) parts.push(`範圍 ${phaseName(before.phaseId)} → ${phaseName(input.phaseId)}`);
  if (input.startDate !== before.startDate || input.endDate !== before.endDate) {
    const range = (a: string | null, b: string | null) => formatDateRange(a, b) || "(空白)";
    parts.push(`時間範圍 ${range(before.startDate, before.endDate)} → ${range(input.startDate, input.endDate)}`);
  }
  if (input.basis.trim() !== before.basis) parts.push(`估算基礎 ${text(before.basis)} → ${text(input.basis.trim())}`);
  if (input.vendor.trim() !== before.vendor) parts.push(`廠商 / 人員 ${text(before.vendor)} → ${text(input.vendor.trim())}`);
  if (input.quantity !== before.quantity) parts.push(`數量 ${num(before.quantity)} → ${num(input.quantity)}`);
  const price = input.unitPrice === null ? null : Math.round(input.unitPrice);
  if (price !== before.unitPrice) parts.push(`單價 ${num(before.unitPrice)} → ${num(price)}`);
  const amount = resolveNreAmount(input);
  if (amount !== before.amount) parts.push(`金額 ${money(before.amount)} → ${money(amount)}`);
  if (input.note.trim() !== before.note) parts.push(`備註 ${text(before.note)} → ${text(input.note.trim())}`);
  return parts.join("、");
}

export type NreImportPlan = {
  creates: NreLineInput[];
  updates: { id: string; before: NreExistingLine; input: NreLineInput }[];
  /** 內容跟現有的完全一樣,不用動。 */
  unchanged: number;
  /** 報價單裡有、但這份 Excel 完全沒提到的——刻意不刪(Excel 裡隱藏或漏掉一列,不該把談好的數字沖掉)。 */
  untouched: NreExistingLine[];
};

/**
 * 匯入的比對:同一類別、同一個範圍、同一個細項說明就是同一列——在 Excel 裡改金額、備註之後匯回來,是更新那一列,不是多一列。
 * 同一類別裡有好幾列細項說明一樣時,依先後順序一對一對應;對不到的 Excel 列是新增,
 * 報價單裡沒被對到的列維持原樣。
 */
export function planNreImport(existing: NreExistingLine[], incoming: NreLineInput[]): NreImportPlan {
  // 同一類別、同一個範圍(階段或整個專案)、同一個細項說明才是同一列——同名的委託項目掛在不同階段是兩筆。
  const keyOf = (category: string, phaseId: string | null, description: string) =>
    `${category}\u0000${phaseId ?? ""}\u0000${description.trim()}`;
  const pool = new Map<string, NreExistingLine[]>();
  for (const line of existing) {
    const key = keyOf(line.category, line.phaseId, line.description);
    pool.set(key, [...(pool.get(key) ?? []), line]);
  }
  const matched = new Set<string>();
  const creates: NreLineInput[] = [];
  const updates: NreImportPlan["updates"] = [];
  let unchanged = 0;
  for (const input of incoming) {
    const candidates = pool.get(keyOf(input.category, input.phaseId, input.description));
    const hit = candidates?.shift();
    if (!hit) {
      creates.push(input);
      continue;
    }
    matched.add(hit.id);
    if (sameNreContent(input, hit)) unchanged++;
    else updates.push({ id: hit.id, before: hit, input });
  }
  return { creates, updates, unchanged, untouched: existing.filter((l) => !matched.has(l.id)) };
}

/** 輸入框的文字轉數字:空白是 null;逗號、空白可以有;不是數字回 NaN。 */
export function parseNumberField(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  return Number(cleaned);
}
