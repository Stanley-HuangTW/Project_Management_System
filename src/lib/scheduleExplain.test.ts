import { describe, expect, it } from "vitest";
import { explainSchedule, type ExplainEntry, type ExplainInput } from "./scheduleExplain";

const d = (iso: string) => new Date(iso);
const range = (start: string, end: string) => ({ start: d(start), end: d(end) });

const base: ExplainInput = {
  mode: "CALENDAR",
  holidays: new Set(),
  myDays: 3,
  alwaysComputed: false,
  manualStartName: "start(set)",
  manualDurationName: "duration",
  rollUp: null,
  entries: [],
  baseRange: null,
  constraint: { type: null, date: null },
  constraintSource: null,
  followsChildren: false,
};
const entry = (id: string, label: string, relationship: string | null, lag: number, r: string[] | null): ExplainEntry => ({
  itemId: id,
  label,
  relationship,
  lag,
  range: r ? range(r[0], r[1]) : null,
});

describe("explainSchedule", () => {
  it("統計型父項:最早的子項目決定開始日,最晚的決定完成日", () => {
    const out = explainSchedule({
      ...base,
      rollUp: [
        { label: "1.1 甲", range: range("2027-01-05", "2027-01-09") },
        { label: "1.2 乙", range: range("2027-01-03", "2027-01-20") },
        { label: "1.3 丙", range: range("2027-01-10", "2027-01-30") },
      ],
    });
    expect(out.start?.source).toBe("rollup");
    expect(out.start?.text).toContain("1.2 乙");
    expect(out.start?.text).toContain("2027-01-03");
    expect(out.finish?.text).toContain("1.3 丙");
    expect(out.finish?.text).toContain("2027-01-30");
    expect(out.drivers.size).toBe(0);
  });

  it("FS + Lag:開始日 = 前置完成日的下一天 + Lag,前置標成「決定開始日」", () => {
    const out = explainSchedule({ ...base, entries: [entry("p", "1.1 前置", "FS", 2, ["2027-01-01", "2027-01-05"])] });
    expect(out.start?.source).toBe("pred");
    expect(out.start?.text).toContain("前置「1.1 前置」完成日 2027-01-05");
    expect(out.start?.text).toContain("+ Lag 2 天");
    expect(out.start?.text).toContain("(FS)");
    expect(out.finish?.text).toContain("開始日 2027-01-08");
    expect(out.finish?.text).toContain("duration 3 天");
    expect(out.drivers.get("p")?.drives).toBe("start");
    expect(out.drivers.get("p")?.note).toContain("開始日參照這個項目的完成日");
  });

  it("多個前置:開始最晚的那個才算,另一個不標示", () => {
    const out = explainSchedule({
      ...base,
      entries: [
        entry("early", "1.1 早", "FS", 0, ["2027-01-01", "2027-01-03"]),
        entry("late", "1.2 晚", "FS", 0, ["2027-01-01", "2027-01-20"]),
      ],
    });
    expect([...out.drivers.keys()]).toEqual(["late"]);
    expect(out.start?.text).toContain("1.2 晚");
  });

  it("SS:開始日取前置的開始日 + Lag", () => {
    const out = explainSchedule({ ...base, entries: [entry("p", "1.1 前置", "SS", 1, ["2027-01-10", "2027-01-20"])] });
    expect(out.start?.text).toContain("前置「1.1 前置」開始日 2027-01-10");
    expect(out.start?.text).toContain("+ Lag 1 天");
    expect(out.drivers.get("p")?.drives).toBe("start");
  });

  it("FF:完成日取前置的完成日 + Lag,開始日由完成日往回推;前置標成「決定完成日」", () => {
    const out = explainSchedule({ ...base, entries: [entry("p", "1.1 前置", "FF", 0, ["2027-01-01", "2027-01-10"])] });
    expect(out.finish?.text).toContain("前置「1.1 前置」完成日 2027-01-10");
    expect(out.start?.text).toContain("往回推");
    expect(out.drivers.get("p")?.drives).toBe("finish");
  });

  it("沒有關係(Link 沒設)或前置沒日期:不算前置驅動", () => {
    expect(explainSchedule({ ...base, entries: [entry("p", "1.1", null, 0, ["2027-01-01", "2027-01-05"])] }).drivers.size).toBe(0);
    expect(explainSchedule({ ...base, entries: [entry("p", "1.1", "FS", 0, null)] }).drivers.size).toBe(0);
  });

  it("一律自己計算、沒有前置:Start(set) + Duration", () => {
    const out = explainSchedule({ ...base, alwaysComputed: true, baseRange: range("2027-02-01", "2027-02-03") });
    expect(out.start?.source).toBe("manual");
    expect(out.start?.text).toContain("start(set)");
    expect(out.finish?.text).toContain("start(set) 2027-02-01");
    expect(out.finish?.text).toContain("duration 3 天");
  });

  it("日期約束把前置排出的開始日往後推:說明寫約束,原本的日期也寫出來;跟著前置時標示那個前置", () => {
    const out = explainSchedule({
      ...base,
      entries: [entry("p", "1.1 前置", "FS", 0, ["2027-01-01", "2027-01-05"])],
      constraint: { type: "START_NO_EARLIER_THAN", date: "2027-01-20" },
      constraintSource: { predItemId: "q", text: "前置任務 1.2 的結束時間" },
    });
    expect(out.start?.source).toBe("constraint");
    expect(out.start?.text).toContain("不得早於(開始) 2027-01-20");
    expect(out.start?.text).toContain("原本由前置「1.1 前置」排出的是 2027-01-06");
    expect(out.start?.text).toContain("日期取自前置任務 1.2 的結束時間");
    expect(out.drivers.get("q")?.drives).toBe("constraint");
    expect(out.drivers.has("p")).toBe(false);
  });

  it("日期約束沒有改變結果(前置排出的比約束晚)時,還是前置決定", () => {
    const out = explainSchedule({
      ...base,
      entries: [entry("p", "1.1 前置", "FS", 0, ["2027-01-01", "2027-01-25"])],
      constraint: { type: "START_NO_EARLIER_THAN", date: "2027-01-10" },
    });
    expect(out.start?.source).toBe("pred");
    expect(out.drivers.get("p")?.drives).toBe("start");
  });

  it("「不得晚於」不會移動任何東西,不改變說明", () => {
    const out = explainSchedule({
      ...base,
      entries: [entry("p", "1.1 前置", "FS", 0, ["2027-01-01", "2027-01-25"])],
      constraint: { type: "FINISH_NO_LATER_THAN", date: "2027-01-10" },
    });
    expect(out.start?.source).toBe("pred");
  });

  it("沒有前置、只有「必須完成於」:完成日釘死,開始日往回推", () => {
    const out = explainSchedule({ ...base, constraint: { type: "MUST_FINISH_ON", date: "2027-03-10" } });
    expect(out.finish?.source).toBe("constraint");
    expect(out.finish?.text).toContain("必須完成於 2027-03-10");
    expect(out.start?.text).toContain("往回推");
  });

  it("傳統看板、沒有前置:手填的日期,沒有什麼要說明", () => {
    const out = explainSchedule(base);
    expect(out.start).toBeNull();
    expect(out.finish).toBeNull();
  });

  it("日期後面附星期幾", () => {
    const out = explainSchedule({ ...base, entries: [entry("p", "1.1 前置", "FS", 0, ["2027-01-01", "2027-01-05"])] });
    expect(out.start?.text).toContain("2027-01-05(週二)");
  });
});
