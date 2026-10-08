/**
 * NRE(一次性工程費用)報價單 — 純邏輯。
 *
 * 報價單是估算與報價的依據,逐列填:類別、細項說明、估算基礎、數量、單價、金額、備註。
 * 它跟預算的「核准預算」是兩件事:這裡的合計不會寫進核准預算,兩邊各自獨立。
 */

export const NRE_CATEGORIES = ["LABOUR", "TOOLING", "PROTOTYPE", "CERTIFICATION"] as const;
export type NreCategoryKey = (typeof NRE_CATEGORIES)[number];

export const NRE_LABELS: Record<NreCategoryKey, string> = {
  LABOUR: "研發人力工時",
  TOOLING: "模具與治具",
  PROTOTYPE: "打樣與樣品",
  CERTIFICATION: "驗證與認證",
};

/** 每一類的說明與欄位名稱——研發人力是外部單位的工時,數量放工時、單價放時薪。 */
export const NRE_CATEGORY_GUIDE: Record<
  NreCategoryKey,
  { hint: string; vendorLabel: string; quantityLabel: string; unitPriceLabel: string; descriptionExample: string; basisExample: string }
> = {
  LABOUR: {
    hint: "外部單位或外部人員投入的研發工時(電路、機構、韌體、軟體設計等)。填工時與時薪,金額自動相乘。",
    vendorLabel: "外部單位 / 人員",
    quantityLabel: "工時(小時)",
    unitPriceLabel: "時薪(元)",
    descriptionExample: "機構 / 電路設計、軟韌體客製化",
    basisExample: "3 位工程師 × 3 個月",
  },
  TOOLING: {
    hint: "外殼鋼模、生產組裝治具、電測夾具——通常是 NRE 裡佔比最高的一塊。",
    vendorLabel: "廠商",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "外殼塑膠射出鋼模(全套主體 + 按鍵)",
    basisExample: "1 套,壽命約 30 萬模次",
  },
  PROTOTYPE: {
    hint: "量產前各階段的打樣與測試樣品:PCB 打樣、3D 列印、CNC 外觀樣品、小批量試產。",
    vendorLabel: "廠商",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "PCB 電路板快速打樣(PCBA)",
    basisExample: "5 片(功能驗證用)",
  },
  CERTIFICATION: {
    hint: "環境、壽命等信賴度測試,以及法規認證(CE、FCC、BSMI)的實驗室費用與規費。",
    vendorLabel: "實驗室 / 代辦",
    quantityLabel: "數量",
    unitPriceLabel: "單價(元)",
    descriptionExample: "法規安規認證(CE / FCC 規費與代辦)",
    basisExample: "專案打包",
  },
};

export type NreLineInput = {
  category: NreCategoryKey;
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
  if (input.description.trim() === "") return "請填細項說明";
  if (input.description.length > 200) return "細項說明太長了(上限 200 字)";
  if (input.basis.length > 200) return "估算基礎太長了(上限 200 字)";
  if (input.vendor.length > 100) return "廠商 / 人員太長了(上限 100 字)";
  if (input.note.length > 500) return "備註太長了(上限 500 字)";
  if (input.quantity !== null && (!Number.isFinite(input.quantity) || input.quantity < 0)) return "數量必須是 0 或正數";
  if (input.unitPrice !== null && (!Number.isFinite(input.unitPrice) || input.unitPrice < 0)) return "單價必須是 0 或正數";
  if (!Number.isFinite(input.amount) || input.amount < 0) return "金額必須是 0 或正數";
  if (resolveNreAmount(input) > MAX_NRE_AMOUNT) return "金額太大了";
  return null;
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

/** 輸入框的文字轉數字:空白是 null;逗號、空白可以有;不是數字回 NaN。 */
export function parseNumberField(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "");
  if (cleaned === "") return null;
  return Number(cleaned);
}
