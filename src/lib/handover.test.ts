import { describe, expect, it } from "vitest";
import { currentMonthTaipei, isUnfinished, mergeAllocationPct, replacePersonValue, slotIsOngoing } from "@/lib/handover";

describe("replacePersonValue", () => {
  it("單一個人的字串:是轉出者就換成接手的人,別人不動", () => {
    expect(replacePersonValue("a", "a", "b")).toBe("b");
    expect(replacePersonValue("c", "a", "b")).toBe("c");
    expect(replacePersonValue(null, "a", "b")).toBeNull();
  });

  it("陣列:換掉轉出者,接手的人已經在裡面就不重複", () => {
    expect(replacePersonValue(["a", "c"], "a", "b")).toEqual(["b", "c"]);
    expect(replacePersonValue(["a", "b"], "a", "b")).toEqual(["b"]);
    expect(replacePersonValue(["c"], "a", "b")).toEqual(["c"]);
  });
});

describe("mergeAllocationPct", () => {
  it("加總,上限 100", () => {
    expect(mergeAllocationPct(30, 20)).toBe(50);
    expect(mergeAllocationPct(80, 50)).toBe(100);
  });
});

describe("currentMonthTaipei", () => {
  it("台灣時間:UTC 月底晚上已經是台灣的下個月", () => {
    expect(currentMonthTaipei(new Date("2026-10-31T17:00:00.000Z"))).toBe("2026-11");
    expect(currentMonthTaipei(new Date("2026-10-19T03:00:00.000Z"))).toBe("2026-10");
  });
});

describe("slotIsOngoing", () => {
  it("還有這個月以後的投入,或沒排月份:進行中", () => {
    expect(slotIsOngoing(["2026-09", "2026-10"], "2026-10")).toBe(true);
    expect(slotIsOngoing(["2026-12"], "2026-10")).toBe(true);
    expect(slotIsOngoing([], "2026-10")).toBe(true);
  });

  it("全部都在過去:已經發生的成本,不交接", () => {
    expect(slotIsOngoing(["2026-07", "2026-09"], "2026-10")).toBe(false);
  });
});

describe("isUnfinished", () => {
  const options = [
    { id: "planned", label: "Planned" },
    { id: "done", label: "Completed" },
    { id: "x9", label: "驗收通過" },
  ];

  it("狀態不是完成:還沒完成", () => {
    expect(isUnfinished("planned", options, [])).toBe(true);
  });

  it("預設的 done、標籤叫完成、報表設定指定的完成選項:已完成", () => {
    expect(isUnfinished("done", options, [])).toBe(false);
    expect(isUnfinished("x9", options, ["x9"])).toBe(false);
  });

  it("沒選狀態、或選項已經不存在:算還沒完成", () => {
    expect(isUnfinished(null, options, [])).toBe(true);
    expect(isUnfinished("gone", options, [])).toBe(true);
  });
});
