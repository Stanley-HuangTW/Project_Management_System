import { describe, expect, it } from "vitest";
import type { BoardWithData } from "@/types/board";
import { computeProtoUsage, findOverload, machineLoadColor, type ProtoUsageUnit } from "./protoUsage";
import type { WeekColumn } from "./workload";

const item = (id: string, name: string, start: string | null, days: number | null, groupId = "g1") => ({
  id,
  groupId,
  parentId: null,
  order: 0,
  name,
  assignments: [],
  cellValues: [
    ...(start ? [{ columnId: "s", value: start }] : []),
    ...(days !== null ? [{ columnId: "d", value: days }] : []),
  ],
});

const board = (over: Record<string, unknown> = {}) =>
  ({
    id: "b1",
    name: "PS30",
    groups: [{ id: "g1", name: "測試" }],
    columns: [],
    ganttStartColumnId: "s",
    ganttDurationColumnId: "d",
    ganttDurationMode: "CALENDAR",
    items: [item("i1", "跑 72 小時", "2026-10-05", 5), item("i2", "跌落測試", "2026-10-07", 3), item("i3", "未排程的測試", null, null)],
    ...over,
  }) as unknown as BoardWithData;

const unit = (id: string, seq: number, over: Partial<ProtoUsageUnit> = {}): ProtoUsageUnit => ({
  id,
  boardId: "b1",
  product: "PS30",
  unit: "QA",
  phaseId: "evt",
  seq,
  ...over,
});

const phases = [
  { id: "poc", name: "POC", order: 0 },
  { id: "evt", name: "EVT1", order: 1 },
];

// 兩週:10/5 與 10/12(都是星期一)。
const weeks: WeekColumn[] = [
  { start: new Date("2026-10-05"), label: "10/5", monthLabel: "2026/10", isMonthStart: true },
  { start: new Date("2026-10-12"), label: "10/12", monthLabel: "2026/10", isMonthStart: false },
];

describe("computeProtoUsage", () => {
  it("只列有工作項在用的樣機,工作項的起訖照排程、百分比照連結", () => {
    const usage = computeProtoUsage(
      [board()],
      [unit("u1", 1), unit("u2", 2)],
      phases,
      [{ itemId: "i1", protoUnitId: "u1", usagePct: 100 }],
      weeks
    );
    expect(usage.machines.map((m) => m.label)).toEqual(["PS30 / EVT1 / QA #1"]);
    expect(usage.tasksByMachine.u1).toEqual([
      expect.objectContaining({ itemId: "i1", itemName: "跑 72 小時", allocationPct: 100, boardName: "PS30", groupName: "測試" }),
    ]);
    expect(usage.tasksByMachine.u1[0].startDate?.toISOString().slice(0, 10)).toBe("2026-10-05");
    expect(usage.tasksByMachine.u1[0].endDate?.toISOString().slice(0, 10)).toBe("2026-10-09");
    expect(usage.tasksByMachine.u2).toBeUndefined();
  });

  it("一個工作項用好幾台:每台各有一筆", () => {
    const usage = computeProtoUsage(
      [board()],
      [unit("u1", 1), unit("u2", 2)],
      phases,
      [
        { itemId: "i1", protoUnitId: "u1", usagePct: 100 },
        { itemId: "i1", protoUnitId: "u2", usagePct: 100 },
      ],
      weeks
    );
    expect(usage.machines.map((m) => m.id)).toEqual(["u1", "u2"]);
    expect(usage.tasksByMachine.u1.map((t) => t.itemId)).toEqual(["i1"]);
    expect(usage.tasksByMachine.u2.map((t) => t.itemId)).toEqual(["i1"]);
  });

  it("每週取最滿的一天:單獨一個 100% 的工作項是 100,同一天疊兩個超過 100", () => {
    const usage = computeProtoUsage(
      [board()],
      [unit("u1", 1)],
      phases,
      [
        { itemId: "i1", protoUnitId: "u1", usagePct: 100 },
        { itemId: "i2", protoUnitId: "u1", usagePct: 40 },
      ],
      weeks
    );
    // i1 = 10/5 ~ 10/9、i2 = 10/7 ~ 10/9:10/7 起兩個都在用 = 140%;下一週都沒人用。
    expect(usage.weeklyLoadByMachine.u1).toEqual([140, 0]);
  });

  it("週末沒人用不會把重疊稀釋掉", () => {
    const usage = computeProtoUsage(
      [board({ ganttDurationMode: "BUSINESS" })],
      [unit("u1", 1)],
      phases,
      [
        { itemId: "i1", protoUnitId: "u1", usagePct: 100 },
        { itemId: "i2", protoUnitId: "u1", usagePct: 30 },
      ],
      weeks
    );
    expect(usage.weeklyLoadByMachine.u1[0]).toBe(130);
  });

  it("沒排程的工作項仍列在樣機底下(沒有起訖),但不算進負載", () => {
    const usage = computeProtoUsage(
      [board()],
      [unit("u1", 1)],
      phases,
      [{ itemId: "i3", protoUnitId: "u1", usagePct: 100 }],
      weeks
    );
    expect(usage.tasksByMachine.u1).toEqual([expect.objectContaining({ itemId: "i3", startDate: null, endDate: null })]);
    expect(usage.weeklyLoadByMachine.u1).toEqual([0, 0]);
  });

  it("看不到的工作項(不在 board.items 裡)不列,整台都沒人用就不出現", () => {
    const usage = computeProtoUsage(
      [board({ items: [item("i1", "跑 72 小時", "2026-10-05", 5)] })],
      [unit("u1", 1), unit("u2", 2)],
      phases,
      [
        { itemId: "hidden", protoUnitId: "u1", usagePct: 100 },
        { itemId: "i1", protoUnitId: "u2", usagePct: 100 },
      ],
      weeks
    );
    expect(usage.machines.map((m) => m.id)).toEqual(["u2"]);
  });

  it("不在傳進來的看板上的樣機會被略過", () => {
    const usage = computeProtoUsage(
      [board()],
      [unit("u1", 1, { boardId: "other" })],
      phases,
      [{ itemId: "i1", protoUnitId: "u1", usagePct: 100 }],
      weeks
    );
    expect(usage.machines).toEqual([]);
  });

  it("樣機照 看板 → 產品 → 階段順序 → 用途 → 第幾台 排", () => {
    const usage = computeProtoUsage(
      [board(), board({ id: "b0", name: "AMR" })],
      [
        unit("a", 2),
        unit("b", 1),
        unit("c", 1, { phaseId: "poc" }),
        unit("d", 1, { unit: "EE" }),
        unit("e", 1, { product: "M3" }),
        unit("f", 1, { boardId: "b0" }),
      ],
      phases,
      ["a", "b", "c", "d", "e", "f"].map((protoUnitId) => ({ itemId: "i1", protoUnitId, usagePct: 100 })),
      weeks
    );
    // AMR(f)先;PS30 內 M3 在 PS30 前;同產品 POC(c)在 EVT1 前;EVT1 內 EE(d)在 QA 前,QA 內 #1(b)在 #2(a)前。
    expect(usage.machines.map((m) => m.id)).toEqual(["f", "e", "c", "d", "b", "a"]);
  });
});

describe("machineLoadColor", () => {
  const t = { greenColor: "#0f0", redColor: "#f00" };
  it("滿載 100% 還是綠色,超過才紅", () => {
    expect(machineLoadColor(100, t)).toBe("#0f0");
    expect(machineLoadColor(101, t)).toBe("#f00");
  });
});

describe("computeProtoUsage: idle machines", () => {
  it("lists the machines nobody is using, in the same order as the busy ones", () => {
    const usage = computeProtoUsage(
      [board()],
      [unit("u1", 1), unit("u2", 2), unit("u3", 3, { unit: "EE" })],
      phases,
      [{ itemId: "i1", protoUnitId: "u2", usagePct: 100 }],
      weeks
    );
    expect(usage.machines.map((m) => m.id)).toEqual(["u2"]);
    expect(usage.idle.map((m) => m.label)).toEqual(["PS30 / EVT1 / EE #3", "PS30 / EVT1 / QA #1"]);
  });

  it("a machine whose only user is hidden from the viewer counts as idle", () => {
    const usage = computeProtoUsage(
      [board({ items: [item("i1", "跑 72 小時", "2026-10-05", 5)] })],
      [unit("u1", 1)],
      phases,
      [{ itemId: "hidden", protoUnitId: "u1", usagePct: 100 }],
      weeks
    );
    expect(usage.machines).toEqual([]);
    expect(usage.idle.map((m) => m.id)).toEqual(["u1"]);
  });

  it("ignores machines of boards that were not passed in", () => {
    const usage = computeProtoUsage([board()], [unit("u1", 1, { boardId: "other" })], phases, [], weeks);
    expect(usage.idle).toEqual([]);
  });
});

describe("findOverload", () => {
  const d = (iso: string) => new Date(iso);
  const entry = (itemId: string, pct: number, start: string | null, end: string | null, businessDaysOnly = false) => ({
    itemId,
    pct,
    start: start ? d(start) : null,
    end: end ? d(end) : null,
    businessDaysOnly,
  });

  it("is null for one item at 100%, or two that never meet", () => {
    expect(findOverload([entry("a", 100, "2026-10-05", "2026-10-09")])).toBeNull();
    expect(findOverload([entry("a", 100, "2026-10-05", "2026-10-09"), entry("b", 100, "2026-10-10", "2026-10-12")])).toBeNull();
  });

  it("two items that split the machine 50/50 are fine", () => {
    expect(findOverload([entry("a", 50, "2026-10-05", "2026-10-09"), entry("b", 50, "2026-10-05", "2026-10-09")])).toBeNull();
  });

  it("reports the days, the peak and who is involved when they overlap", () => {
    const span = findOverload([entry("a", 100, "2026-10-05", "2026-10-09"), entry("b", 40, "2026-10-07", "2026-10-12"), entry("c", 100, "2026-10-20", "2026-10-21")]);
    expect(span).toEqual({ from: "2026-10-07", to: "2026-10-09", peak: 140, itemIds: ["a", "b"] });
  });

  it("business-day mode skips the weekend, so an overlap that only exists on a weekend does not count", () => {
    // 10/10、10/11 是週六日:a 排到週日,b 從週六開始,只有週末重疊。
    const entries = (business: boolean) => [entry("a", 100, "2026-10-05", "2026-10-11", business), entry("b", 100, "2026-10-10", "2026-10-12", business)];
    expect(findOverload(entries(false))?.from).toBe("2026-10-10");
    expect(findOverload(entries(true))).toBeNull();
  });

  it("skips unscheduled items", () => {
    expect(findOverload([entry("a", 100, "2026-10-05", "2026-10-09"), entry("b", 100, null, null)])).toBeNull();
  });
});
