import { describe, expect, it } from "vitest";
import { barIndexRange, computeDailyLoadByUser, computeRolledUpDateRange, hasOwnScheduleRule } from "./gantt";

const START = "startCol";
const DAYS = "daysCol";
const PRED = "predCol";
const MANUAL_START = "startSetCol";

function iso(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Minimal item shape computeRolledUpDateRange reads. */
function item(
  id: string,
  parentId: string | null,
  cells: Record<string, string | number>
) {
  return {
    id,
    parentId,
    cellValues: Object.entries(cells).map(([columnId, value]) => ({ columnId, value })),
  } as never;
}

const RULE_COLUMNS = { predColumnId: PRED };

describe("hasOwnScheduleRule", () => {
  it("is true when a Pred is set", () => {
    expect(hasOwnScheduleRule(item("a", null, { [PRED]: "1.2" }), RULE_COLUMNS)).toBe(true);
  });

  it("is false when only a manual start is set — every item on an always-computed board has one", () => {
    expect(hasOwnScheduleRule(item("a", null, { [MANUAL_START]: "2026-08-03" }), RULE_COLUMNS)).toBe(false);
  });

  it("is false for blank values, and when no rule columns are configured", () => {
    expect(hasOwnScheduleRule(item("a", null, { [PRED]: "  " }), RULE_COLUMNS)).toBe(false);
    expect(hasOwnScheduleRule(item("a", null, {}), RULE_COLUMNS)).toBe(false);
    expect(hasOwnScheduleRule(item("a", null, { [PRED]: "1.2" }), undefined)).toBe(false);
  });
});

describe("computeRolledUpDateRange", () => {
  // A parent whose own dates are 8/3–9/1, with children sitting outside it.
  const parentCells = { [START]: "2026-08-03", [DAYS]: 30 };
  const child = item("child", "parent", { [START]: "2026-09-04", [DAYS]: 2 });

  it("rolls a plain summary up from its children", () => {
    const parent = item("parent", null, parentCells);
    const range = computeRolledUpDateRange(parent, [parent, child], START, DAYS, "CALENDAR", new Set(), RULE_COLUMNS);
    expect(iso(range!.start)).toBe("2026-09-04");
    expect(iso(range!.end)).toBe("2026-09-05");
  });

  it("keeps a Pred-driven summary's own dates instead of rolling up", () => {
    const parent = item("parent", null, { ...parentCells, [PRED]: "1.6.1" });
    const range = computeRolledUpDateRange(parent, [parent, child], START, DAYS, "CALENDAR", new Set(), RULE_COLUMNS);
    expect(iso(range!.start)).toBe("2026-08-03");
    expect(iso(range!.end)).toBe("2026-09-01");
  });

  it("rolls a summary up from its children even when it carries a manual start", () => {
    // 任務原本自己排好時程(start(set)+天數),後來加了子項——長條要跟著子項的範圍走,
    // 不是停在它原本規劃的那一段。
    const parent = item("parent", null, { ...parentCells, [MANUAL_START]: "2026-08-03" });
    const range = computeRolledUpDateRange(parent, [parent, child], START, DAYS, "CALENDAR", new Set(), RULE_COLUMNS);
    expect(iso(range!.start)).toBe("2026-09-04");
    expect(iso(range!.end)).toBe("2026-09-05");
  });

  it("still rolls up when the rule columns aren't passed (unchanged callers)", () => {
    const parent = item("parent", null, { ...parentCells, [PRED]: "1.6.1" });
    const range = computeRolledUpDateRange(parent, [parent, child], START, DAYS);
    expect(iso(range!.start)).toBe("2026-09-04");
  });

  it("falls back to the rollup when a rule-bearing summary has no own dates", () => {
    const parent = item("parent", null, { [PRED]: "1.6.1" });
    const range = computeRolledUpDateRange(parent, [parent, child], START, DAYS, "CALENDAR", new Set(), RULE_COLUMNS);
    expect(iso(range!.start)).toBe("2026-09-04");
  });

  it("lets a nested rule-bearing summary hold its own dates inside a grandparent's rollup", () => {
    const grandparent = item("gp", null, {});
    const parent = item("parent", "gp", { ...parentCells, [PRED]: "1.6.1" });
    const nestedChild = item("child", "parent", { [START]: "2026-09-04", [DAYS]: 2 });
    const range = computeRolledUpDateRange(
      grandparent,
      [grandparent, parent, nestedChild],
      START,
      DAYS,
      "CALENDAR",
      new Set(),
      RULE_COLUMNS
    );
    expect(iso(range!.start)).toBe("2026-08-03");
    expect(iso(range!.end)).toBe("2026-09-01");
  });
});

describe("barIndexRange", () => {
  // 工作天模式的時間軸:週末與 10/26(光復節補假)不佔寬度。
  const iso = ["2026-10-22", "2026-10-23", "2026-10-27", "2026-10-28", "2026-10-29"];
  const days = iso.map((d) => new Date(`${d}T00:00:00Z`));
  const indexByIso = new Map(iso.map((d, i) => [d, i]));
  const range = (start: string, end: string) => ({ start: new Date(`${start}T00:00:00Z`), end: new Date(`${end}T00:00:00Z`) });

  it("起訖都在時間軸上就照原位置", () => {
    expect(barIndexRange(days, range("2026-10-23", "2026-10-28"), indexByIso)).toEqual({ startIndex: 1, endIndex: 3 });
  });

  it("0 天的里程碑排在假日:畫在下一個工作日,不是最左邊", () => {
    expect(barIndexRange(days, range("2026-10-26", "2026-10-26"), indexByIso)).toEqual({ startIndex: 2, endIndex: 2 });
  });

  it("開始落在週末就往後靠、結束落在週末就往前靠", () => {
    expect(barIndexRange(days, range("2026-10-24", "2026-10-26"), indexByIso)).toEqual({ startIndex: 2, endIndex: 2 });
    expect(barIndexRange(days, range("2026-10-22", "2026-10-25"), indexByIso)).toEqual({ startIndex: 0, endIndex: 1 });
  });

  it("超出時間軸就夾在兩端", () => {
    expect(barIndexRange(days, range("2026-11-02", "2026-11-03"), indexByIso)).toEqual({ startIndex: 4, endIndex: 4 });
    expect(barIndexRange(days, range("2026-10-01", "2026-10-02"), indexByIso)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it("沒有任何日子時不會當掉", () => {
    expect(barIndexRange([], range("2026-10-26", "2026-10-26"), new Map())).toEqual({ startIndex: 0, endIndex: 0 });
  });
});

describe("computeDailyLoadByUser:只算人員分配", () => {
  const item = (assignments: { userId: string; allocationPct: number }[], ownerValue?: string) =>
    ({
      id: "i1",
      parentId: null,
      assignments,
      cellValues: [
        { columnId: "s", value: "2026-10-05" },
        { columnId: "d", value: 2 },
        ...(ownerValue ? [{ columnId: "owner", value: ownerValue }] : []),
      ],
    }) as unknown as Parameters<typeof computeDailyLoadByUser>[0][number];

  it("有人員分配:每一天都記上那個百分比", () => {
    const load = computeDailyLoadByUser([item([{ userId: "u1", allocationPct: 30 }])], "s", "d");
    expect([...(load.get("u1") ?? [])]).toEqual([
      ["2026-10-05", 30],
      ["2026-10-06", 30],
    ]);
  });

  it("只有負責人欄位、沒有人員分配:不算工作量", () => {
    const load = computeDailyLoadByUser([item([], "u2")], "s", "d");
    expect(load.size).toBe(0);
  });

  it("負責人欄位跟人員分配是不同的人:只有被分配的人有負載", () => {
    const load = computeDailyLoadByUser([item([{ userId: "u1", allocationPct: 50 }], "u2")], "s", "d");
    expect([...load.keys()]).toEqual(["u1"]);
  });
});
