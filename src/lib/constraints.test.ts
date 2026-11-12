import { describe, expect, it } from "vitest";
import {
  applyConstraint,
  constraintConflict,
  describeConstraint,
  pinnedRange,
  pinnedScheduleReason,
  pinsFinish,
  resolveConstraint,
} from "./constraints";

const range = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });
const iso = (d: Date) => d.toISOString().slice(0, 10);
const cal = "CALENDAR" as const;
const noHolidays = new Set<string>();

describe("applyConstraint", () => {
  it("leaves the range alone when no constraint is set", () => {
    const planned = range("2026-08-03", "2026-08-07");
    const out = applyConstraint(planned, 5, { type: null, date: null }, cal, noHolidays);
    expect(out.range).toBe(planned);
    expect(out.violation).toBeNull();
  });

  describe("不得早於(開始)", () => {
    const constraint = { type: "START_NO_EARLIER_THAN" as const, date: "2026-08-10" };

    it("pushes the item out when the chain would start it too soon, keeping its length", () => {
      const out = applyConstraint(range("2026-08-03", "2026-08-07"), 5, constraint, cal, noHolidays);
      expect(iso(out.range.start)).toBe("2026-08-10");
      expect(iso(out.range.end)).toBe("2026-08-14");
      expect(out.violation).toBeNull();
    });

    it("leaves an item that already starts late enough exactly where it is", () => {
      const planned = range("2026-08-17", "2026-08-21");
      const out = applyConstraint(planned, 5, constraint, cal, noHolidays);
      expect(out.range).toBe(planned);
    });
  });

  describe("必須完成於", () => {
    it("pins the finish and derives the start backwards", () => {
      const out = applyConstraint(
        range("2026-08-03", "2026-08-07"),
        5,
        { type: "MUST_FINISH_ON", date: "2026-09-01" },
        cal,
        noHolidays
      );
      expect(iso(out.range.end)).toBe("2026-09-01");
      expect(iso(out.range.start)).toBe("2026-08-28");
    });

    it("pulls an item earlier too — it is the fixed date, not a floor", () => {
      const out = applyConstraint(
        range("2026-09-10", "2026-09-14"),
        5,
        { type: "MUST_FINISH_ON", date: "2026-09-01" },
        cal,
        noHolidays
      );
      expect(iso(out.range.end)).toBe("2026-09-01");
    });
  });

  describe("不得晚於(完成)", () => {
    const constraint = { type: "FINISH_NO_LATER_THAN" as const, date: "2026-08-31" };

    it("reports the miss without moving anything — a deadline does not speed work up", () => {
      const planned = range("2026-09-01", "2026-09-05");
      const out = applyConstraint(planned, 5, constraint, cal, noHolidays);
      expect(out.range).toBe(planned);
      expect(out.violation).toBe("完成日 2026-09-05 已超過「不得晚於 2026-08-31」的期限");
    });

    it("says nothing when the work finishes in time", () => {
      const out = applyConstraint(range("2026-08-20", "2026-08-24"), 5, constraint, cal, noHolidays);
      expect(out.violation).toBeNull();
    });

    it("treats finishing exactly on the date as meeting it", () => {
      const out = applyConstraint(range("2026-08-27", "2026-08-31"), 5, constraint, cal, noHolidays);
      expect(out.violation).toBeNull();
    });
  });

  it("skips a constraint whose date is missing or unparseable", () => {
    const planned = range("2026-08-03", "2026-08-07");
    expect(applyConstraint(planned, 5, { type: "MUST_FINISH_ON", date: null }, cal, noHolidays).range).toBe(planned);
    expect(applyConstraint(planned, 5, { type: "MUST_FINISH_ON", date: "nonsense" }, cal, noHolidays).range).toBe(planned);
  });

  it("skips weekends when a working-day board derives the other end", () => {
    // 5 working days back from Friday 2026-09-04 is Monday 2026-08-31.
    const out = applyConstraint(
      range("2026-08-03", "2026-08-07"),
      5,
      { type: "MUST_FINISH_ON", date: "2026-09-04" },
      "BUSINESS",
      noHolidays
    );
    expect(iso(out.range.start)).toBe("2026-08-31");
  });
});

describe("describeConstraint", () => {
  it("reads as a sentence", () => {
    expect(describeConstraint({ type: "FINISH_NO_LATER_THAN", date: "2026-08-31" })).toBe(
      "不得晚於(完成) 2026-08-31"
    );
  });

  it("is null when nothing is set", () => {
    expect(describeConstraint({ type: null, date: "2026-08-31" })).toBeNull();
    expect(describeConstraint({ type: "MUST_FINISH_ON", date: null })).toBeNull();
  });
});

describe("pinsFinish / pinnedRange", () => {
  const pin = { type: "MUST_FINISH_ON" as const, date: "2026-11-03" };

  it("only a MUST_FINISH_ON with a date pins the finish", () => {
    expect(pinsFinish(pin)).toBe(true);
    expect(pinsFinish({ type: "MUST_FINISH_ON", date: null })).toBe(false);
    expect(pinsFinish({ type: "MUST_FINISH_ON", date: "nonsense" })).toBe(false);
    expect(pinsFinish({ type: "FINISH_NO_LATER_THAN", date: "2026-11-03" })).toBe(false);
    expect(pinsFinish({ type: null, date: null })).toBe(false);
  });

  it("builds the whole range from the date and the length alone", () => {
    const out = pinnedRange(23, pin, cal, noHolidays)!;
    expect(iso(out.start)).toBe("2026-10-12");
    expect(iso(out.end)).toBe("2026-11-03");
  });

  it("counts working days back on a working-day board", () => {
    // 11/03 is a Tuesday: 23 working days back lands on Friday 10/02.
    const out = pinnedRange(23, pin, "BUSINESS", noHolidays)!;
    expect(iso(out.start)).toBe("2026-10-02");
    expect(iso(out.end)).toBe("2026-11-03");
  });

  it("a one-day (or zero-day) item starts and ends on the date", () => {
    for (const days of [1, 0]) {
      const out = pinnedRange(days, pin, cal, noHolidays)!;
      expect(iso(out.start)).toBe("2026-11-03");
      expect(iso(out.end)).toBe("2026-11-03");
    }
  });

  it("is null without a length or without a pinned finish", () => {
    expect(pinnedRange(null, pin, cal, noHolidays)).toBeNull();
    expect(pinnedRange(5, { type: "START_NO_EARLIER_THAN", date: "2026-11-03" }, cal, noHolidays)).toBeNull();
  });
});

describe("constraintConflict", () => {
  const pin = { type: "MUST_FINISH_ON" as const, date: "2026-11-03" };

  it("reports it when the predecessors alone would finish after the pinned date", () => {
    const message = constraintConflict(range("2026-11-06", "2026-11-08"), 3, pin, cal, noHolidays);
    expect(message).toContain("2026-11-06 ~ 2026-11-08");
    expect(message).toContain("必須完成於 2026-11-03");
    // …and says where the item actually sits, since the pin wins.
    expect(message).toContain("2026-11-01 ~ 2026-11-03");
  });

  it("is quiet when the predecessors leave room — finishing earlier than the pin is slack, not a conflict", () => {
    expect(constraintConflict(range("2026-10-25", "2026-10-27"), 3, pin, cal, noHolidays)).toBeNull();
    expect(constraintConflict(range("2026-11-01", "2026-11-03"), 3, pin, cal, noHolidays)).toBeNull();
  });

  it("is quiet without predecessors or without a pinned finish", () => {
    expect(constraintConflict(null, 3, pin, cal, noHolidays)).toBeNull();
    const late = range("2026-11-06", "2026-11-08");
    expect(constraintConflict(late, 3, { type: "START_NO_EARLIER_THAN", date: "2026-11-03" }, cal, noHolidays)).toBeNull();
    expect(constraintConflict(late, 3, { type: "MUST_FINISH_ON", date: null }, cal, noHolidays)).toBeNull();
  });
});

describe("pinnedScheduleReason", () => {
  it("names the constraint and what to change instead", () => {
    const reason = pinnedScheduleReason({ type: "MUST_FINISH_ON", date: "2026-11-03" });
    expect(reason).toContain("必須完成於 2026-11-03");
    expect(reason).toContain("日期約束");
    expect(reason).toContain("天數");
  });

  it("is null when the finish is not pinned", () => {
    expect(pinnedScheduleReason({ type: "FINISH_NO_LATER_THAN", date: "2026-11-03" })).toBeNull();
    expect(pinnedScheduleReason({ type: null, date: null })).toBeNull();
  });
});

describe("resolveConstraint:約束日期跟著前置任務", () => {
  const ranges: Record<string, ReturnType<typeof range>> = { A: range("2026-11-02", "2026-11-06") };
  const read = (id: string) => ranges[id] ?? null;
  const base = { constraintType: "MUST_FINISH_ON" as const, constraintDate: "2026-01-01", constraintRefItemId: "A", constraintRefEdge: "FINISH" as const };

  it("跟著完成日 / 開始日:日期取自前置任務現在的起訖", () => {
    expect(resolveConstraint(base, ["A"], read)).toEqual({ constraint: { type: "MUST_FINISH_ON", date: "2026-11-06" }, followsPred: true, refDropped: false });
    expect(resolveConstraint({ ...base, constraintRefEdge: "START" }, ["A"], read).constraint.date).toBe("2026-11-02");
  });

  it("沒有跟著誰(固定日期)、或沒有約束類型:原樣回傳存著的", () => {
    expect(resolveConstraint({ constraintType: "MUST_FINISH_ON", constraintDate: "2026-11-03" }, ["A"], read)).toEqual({
      constraint: { type: "MUST_FINISH_ON", date: "2026-11-03" },
      followsPred: false,
      refDropped: false,
    });
    expect(resolveConstraint({ ...base, constraintType: null }, ["A"], read).constraint).toEqual({ type: null, date: "2026-01-01" });
  });

  it("前置任務已經不在 Pred 裡:用存著的日期,並標示要把「跟著前置任務」清掉", () => {
    expect(resolveConstraint(base, ["X"], read)).toEqual({ constraint: { type: "MUST_FINISH_ON", date: "2026-01-01" }, followsPred: false, refDropped: true });
    expect(resolveConstraint(base, [], read).refDropped).toBe(true);
  });

  it("前置任務還沒有日期:沿用存著的日期,不清掉(它排好之後就會跟上)", () => {
    expect(resolveConstraint({ ...base, constraintRefItemId: "A" }, ["A"], () => null)).toEqual({
      constraint: { type: "MUST_FINISH_ON", date: "2026-01-01" },
      followsPred: true,
      refDropped: false,
    });
  });
});
