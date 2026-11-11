import { describe, expect, it } from "vitest";
import { MAX_STATUS_LABEL, MAX_STATUS_OPTIONS, updateBucketLists, validateStatusOptions } from "./statusOptionsEdit";

const prev = [
  { id: "planned", label: "Planned", color: "#00c875" },
  { id: "done", label: "Completed", color: "#e2445c" },
];

describe("validateStatusOptions", () => {
  it("新增一個狀態:回報新增了哪個、沒有拿掉誰", () => {
    const r = validateStatusOptions([...prev, { id: "sabc1234", label: " Pending ", color: "#c4c4c4" }], prev);
    expect("value" in r && r.value.at(-1)).toEqual({ id: "sabc1234", label: "Pending", color: "#c4c4c4" });
    expect("addedIds" in r && r.addedIds).toEqual(["sabc1234"]);
    expect("removedIds" in r && r.removedIds).toEqual([]);
  });

  it("改名與改顏色不算新增或刪除(id 不變)", () => {
    const r = validateStatusOptions([{ ...prev[0], label: "計畫中", color: "#111111" }, prev[1]], prev);
    expect("addedIds" in r && r.addedIds).toEqual([]);
    expect("removedIds" in r && r.removedIds).toEqual([]);
  });

  it("拿掉的選項會列在 removedIds,讓呼叫端去檢查有沒有人在用", () => {
    const r = validateStatusOptions([prev[0]], prev);
    expect("removedIds" in r && r.removedIds).toEqual(["done"]);
  });

  it("擋下空名稱、太長、重名(忽略大小寫)、壞顏色、重複代號、全刪光、太多", () => {
    const bad = (raw: unknown, re: RegExp) => {
      const r = validateStatusOptions(raw, prev);
      expect("error" in r && r.error).toMatch(re);
    };
    bad([{ id: "a1", label: "  ", color: "#c4c4c4" }], /不可為空/);
    bad([{ id: "a1", label: "x".repeat(MAX_STATUS_LABEL + 1), color: "#c4c4c4" }], /太長/);
    bad([prev[0], { id: "a1", label: "planned", color: "#c4c4c4" }], /已經有一個叫/);
    bad([{ id: "a1", label: "X", color: "red" }], /顏色/);
    bad([prev[0], { ...prev[1], id: "planned" }], /代號/);
    bad([], /至少要留一個/);
    bad(Array.from({ length: MAX_STATUS_OPTIONS + 1 }, (_, i) => ({ id: `i${i}`, label: `L${i}`, color: "#c4c4c4" })), /太多/);
    bad("x", /格式/);
  });
});

describe("updateBucketLists", () => {
  const lists = { notStarted: ["a"], planned: ["b"], paused: [], stuck: ["c"], done: ["d"] };

  it("刪掉的選項從所有分類拿掉", () => {
    const r = updateBucketLists(lists, ["b", "d"], {});
    expect(r).toEqual({ notStarted: ["a"], planned: [], paused: [], stuck: ["c"], done: [] });
  });

  it("新增的選項放進指定的分類;進行中不用存", () => {
    const r = updateBucketLists(lists, [], { n1: "paused", n2: "inProgress", n3: "done" });
    expect(r.paused).toEqual(["n1"]);
    expect(r.done).toEqual(["d", "n3"]);
    expect(Object.values(r).flat()).not.toContain("n2");
  });

  it("不會改到傳進來的名單", () => {
    updateBucketLists(lists, ["a"], { n1: "paused" });
    expect(lists.notStarted).toEqual(["a"]);
    expect(lists.paused).toEqual([]);
  });
});
