/**
 * 幣別換算。
 *
 * 台幣是基準幣別。每一筆外幣紀錄都存下「原始金額」「當下匯率」「換算後的
 * 台幣」三樣,而加總永遠只看最後一樣——匯率天天在動,若總額跟著今天的匯率
 * 浮動,上個月結的帳下個月就會變成另一個數字,而且沒有人動過它。
 */

export const BASE_CURRENCY = "TWD";

/** 一筆記錄在換算上的三個面向。 */
export type Money = {
  currency: string;
  /** 報價單上寫的那個數字。 */
  originalAmount: number;
  /** 1 單位外幣 = 多少台幣,記帳當下的值。 */
  fxRate: number;
  /** 換算後的台幣,所有加總都用這個。 */
  amount: number;
};

export function isBaseCurrency(code: string): boolean {
  return code.trim().toUpperCase() === BASE_CURRENCY;
}

/**
 * 把一筆輸入換算成要存進資料庫的三個欄位。
 *
 * 台幣的情況匯率一律視為 1 而不是沿用輸入,否則有人在幣別是台幣時手滑填了
 * 匯率,金額就會被莫名其妙地乘一次。
 */
export function toMoney(input: {
  currency: string;
  originalAmount: number;
  fxRate: number;
}): Money | null {
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (!Number.isFinite(input.originalAmount) || input.originalAmount <= 0) return null;

  const fxRate = isBaseCurrency(currency) ? 1 : input.fxRate;
  if (!Number.isFinite(fxRate) || fxRate <= 0) return null;

  return {
    currency,
    originalAmount: Math.round(input.originalAmount),
    fxRate,
    // Rounded to whole dollars, like every other amount in this system.
    amount: Math.round(Math.round(input.originalAmount) * fxRate),
  };
}

/** "USD 12,000 @ 31.5" — null for base currency, where there is nothing to say. */
export function describeForeign(money: Pick<Money, "currency" | "originalAmount" | "fxRate">): string | null {
  if (isBaseCurrency(money.currency)) return null;
  return `${money.currency} ${money.originalAmount.toLocaleString("zh-TW")} @ ${money.fxRate}`;
}

/**
 * 匯率變動會讓還沒入帳的訂單多花(或少花)多少台幣。
 *
 * 已入帳的不算:那筆錢已經付掉了,用的就是當時的匯率。這個數字回答的是
 * 「如果今天全部付款,會比當初多付多少」——外幣 PO 簽下去之後,這是唯一一個
 * 沒人動過卻會自己變大的風險。
 */
export function fxExposure(
  openCommitments: Pick<Money, "currency" | "originalAmount" | "fxRate">[],
  currentRates: Map<string, number>
): { byCurrency: { currency: string; original: number; bookedTwd: number; atTodayTwd: number; delta: number }[]; total: number } {
  const grouped = new Map<string, { original: number; bookedTwd: number; atTodayTwd: number }>();

  for (const row of openCommitments) {
    if (isBaseCurrency(row.currency)) continue;
    const today = currentRates.get(row.currency);
    // No current rate on file means nothing can be said about the drift, and
    // guessing it is zero would report "no exposure" for the very currency
    // nobody is watching.
    if (today === undefined) continue;
    const entry = grouped.get(row.currency) ?? { original: 0, bookedTwd: 0, atTodayTwd: 0 };
    entry.original += row.originalAmount;
    entry.bookedTwd += Math.round(row.originalAmount * row.fxRate);
    entry.atTodayTwd += Math.round(row.originalAmount * today);
    grouped.set(row.currency, entry);
  }

  const byCurrency = [...grouped.entries()].map(([currency, e]) => ({
    currency,
    original: e.original,
    bookedTwd: e.bookedTwd,
    atTodayTwd: e.atTodayTwd,
    delta: e.atTodayTwd - e.bookedTwd,
  }));

  return { byCurrency, total: byCurrency.reduce((t, c) => t + c.delta, 0) };
}
