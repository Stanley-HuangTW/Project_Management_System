import { describe, expect, it } from "vitest";
import { applyConstraint, describeConstraint } from "./constraints";

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
