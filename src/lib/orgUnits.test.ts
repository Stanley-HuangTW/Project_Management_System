import { describe, it, expect } from "vitest";
import {
  checkUnitCode,
  guessUnitCode,
  normalizeUnitCode,
  unitLabel,
  DEFAULT_ORG_UNITS,
  type OrgUnit,
} from "@/lib/orgUnits";

const UNITS: OrgUnit[] = [
  { code: "EE", label: "EE 電機", order: 0 },
  { code: "EEDM", label: "EEDM 電機設計", order: 1 },
  { code: "SW", label: "SW 軟體", order: 2 },
];

describe("預設單位", () => {
  it("是使用者要的那六個,而且順序照他寫的", () => {
    expect(DEFAULT_ORG_UNITS.map((u) => u.code)).toEqual(["EE", "ME", "SW", "QA", "FAE", "PM"]);
  });
});

describe("代號", () => {
  it("一律轉大寫,ee 跟 EE 不會變成兩個單位", () => {
    expect(normalizeUnitCode(" ee ")).toBe("EE");
  });

  it("空白換成連字號,免得代號中間有空格", () => {
    expect(normalizeUnitCode("field test")).toBe("FIELD-TEST");
  });

  it("空的不收", () => {
    expect(checkUnitCode("   ")).toEqual({ ok: false, reason: "代號不可為空" });
  });

  it("中文與符號不收 —— 它會當主鍵,也會出現在欄位標題上", () => {
    expect(checkUnitCode("電機").ok).toBe(false);
    expect(checkUnitCode("EE/SW").ok).toBe(false);
  });

  it("英數與連字號可以", () => {
    expect(checkUnitCode("qa-rel")).toEqual({ ok: true, code: "QA-REL" });
  });

  it("太長的不收", () => {
    expect(checkUnitCode("ABCDEFGHIJKLM").ok).toBe(false);
  });
});

describe("顯示名稱", () => {
  it("查得到就用全名", () => {
    expect(unitLabel(UNITS, "SW")).toBe("SW 軟體");
  });

  it("查不到就回代號本身 —— 寧可顯示 XX,也不要顯示空白", () => {
    expect(unitLabel(UNITS, "XX")).toBe("XX");
  });

  it("沒有單位就是空字串", () => {
    expect(unitLabel(UNITS, null)).toBe("");
  });
});

describe("從名額代號猜單位", () => {
  it("EE1 猜 EE", () => {
    expect(guessUnitCode(UNITS, "EE1")).toBe("EE");
  });

  it("長的代號先比 —— EEDM1 是 EEDM,不是 EE", () => {
    expect(guessUnitCode(UNITS, "EEDM1")).toBe("EEDM");
  });

  it("不分大小寫", () => {
    expect(guessUnitCode(UNITS, "sw3")).toBe("SW");
  });

  it("猜不到就回 null,不替呼叫端挑一個", () => {
    expect(guessUnitCode(UNITS, "X9")).toBeNull();
    expect(guessUnitCode(UNITS, "  ")).toBeNull();
  });
});
