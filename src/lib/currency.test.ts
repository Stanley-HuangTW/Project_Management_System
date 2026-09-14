import { describe, expect, it } from "vitest";
import { toMoney, describeForeign, fxExposure, isBaseCurrency } from "./currency";

describe("toMoney", () => {
  it("converts a foreign amount at the rate given", () => {
    const money = toMoney({ currency: "USD", originalAmount: 12_000, fxRate: 31.5 })!;

    expect(money.amount).toBe(378_000);
    expect(money.originalAmount).toBe(12_000);
    expect(money.fxRate).toBe(31.5);
  });

  it("forces the rate to 1 for the base currency", () => {
    // Somebody leaves 31.5 in the rate box and switches back to TWD — the
    // amount must not quietly get multiplied.
    const money = toMoney({ currency: "TWD", originalAmount: 50_000, fxRate: 31.5 })!;

    expect(money.fxRate).toBe(1);
    expect(money.amount).toBe(50_000);
  });

  it("accepts a lowercase code and normalises it", () => {
    expect(toMoney({ currency: "usd", originalAmount: 100, fxRate: 31 })!.currency).toBe("USD");
  });

  it("refuses a rate of zero or less — that is not a conversion", () => {
    expect(toMoney({ currency: "USD", originalAmount: 100, fxRate: 0 })).toBeNull();
    expect(toMoney({ currency: "USD", originalAmount: 100, fxRate: -1 })).toBeNull();
  });

  it("refuses a code that is not three letters", () => {
    expect(toMoney({ currency: "US", originalAmount: 100, fxRate: 31 })).toBeNull();
    expect(toMoney({ currency: "", originalAmount: 100, fxRate: 31 })).toBeNull();
  });

  it("refuses an amount of zero or less", () => {
    expect(toMoney({ currency: "USD", originalAmount: 0, fxRate: 31 })).toBeNull();
  });
});

describe("describeForeign", () => {
  it("spells out what was converted", () => {
    expect(describeForeign({ currency: "USD", originalAmount: 12_000, fxRate: 31.5 })).toBe(
      "USD 12,000 @ 31.5"
    );
  });

  it("says nothing for the base currency", () => {
    expect(describeForeign({ currency: "TWD", originalAmount: 50_000, fxRate: 1 })).toBeNull();
    expect(isBaseCurrency("twd")).toBe(true);
  });
});

describe("fxExposure", () => {
  it("shows what an unsettled PO would cost at today's rate", () => {
    // 簽的時候 31.5,現在 33 — 同一張單子要多付 18,000。
    const exposure = fxExposure(
      [{ currency: "USD", originalAmount: 12_000, fxRate: 31.5 }],
      new Map([["USD", 33]])
    );

    expect(exposure.byCurrency[0].bookedTwd).toBe(378_000);
    expect(exposure.byCurrency[0].atTodayTwd).toBe(396_000);
    expect(exposure.total).toBe(18_000);
  });

  it("reports a favourable move as a negative number", () => {
    const exposure = fxExposure(
      [{ currency: "USD", originalAmount: 10_000, fxRate: 32 }],
      new Map([["USD", 31]])
    );

    expect(exposure.total).toBe(-10_000);
  });

  it("groups several orders in the same currency", () => {
    const exposure = fxExposure(
      [
        { currency: "USD", originalAmount: 10_000, fxRate: 31 },
        { currency: "USD", originalAmount: 5_000, fxRate: 32 },
      ],
      new Map([["USD", 33]])
    );

    expect(exposure.byCurrency).toHaveLength(1);
    expect(exposure.byCurrency[0].original).toBe(15_000);
    // 10,000×(33−31) + 5,000×(33−32)
    expect(exposure.total).toBe(25_000);
  });

  it("ignores base-currency orders — they cannot drift", () => {
    const exposure = fxExposure(
      [{ currency: "TWD", originalAmount: 500_000, fxRate: 1 }],
      new Map([["USD", 33]])
    );

    expect(exposure.byCurrency).toEqual([]);
    expect(exposure.total).toBe(0);
  });

  it("stays silent about a currency with no rate on file", () => {
    // Reporting zero drift for the one currency nobody is tracking would be
    // the most misleading answer available.
    const exposure = fxExposure(
      [{ currency: "JPY", originalAmount: 1_000_000, fxRate: 0.21 }],
      new Map([["USD", 33]])
    );

    expect(exposure.byCurrency).toEqual([]);
  });
});
