import { describe, expect, it } from "vitest";
import { buildWbsIndexFromItems } from "@/lib/predecessorLink";
import { mapCellValue, planColumnMapping, remapPredAcrossBoards, stripPredReferences } from "@/lib/crossBoard";

const col = (id: string, name: string, type: string, options: unknown = {}) => ({ id, name, type, options });
const statuses = (...pairs: [string, string][]) => ({ statuses: pairs.map(([id, label]) => ({ id, label, color: "#ccc" })) });

describe("planColumnMapping", () => {
  it("名稱與類型都相同才對應", () => {
    const source = [col("s1", "Start", "DATE"), col("s2", "Days", "NUMBER"), col("s3", "負責人", "PERSON")];
    const target = [col("t1", "Start", "DATE"), col("t2", "Days", "TEXT"), col("t3", "負責人", "PERSON")];
    const mapping = planColumnMapping(source, target);
    expect(mapping.get("s1")?.targetId).toBe("t1");
    expect(mapping.has("s2")).toBe(false); // 名稱同、類型不同
    expect(mapping.get("s3")?.targetId).toBe("t3");
  });

  it("目標沒有的欄位不在對應裡", () => {
    expect(planColumnMapping([col("s1", "測試工具", "TEXT")], [col("t1", "Start", "DATE")]).size).toBe(0);
  });

  it("同名同類型有好幾個:依目標順序各取一個,不重複使用", () => {
    const mapping = planColumnMapping(
      [col("s1", "備註", "TEXT"), col("s2", "備註", "TEXT")],
      [col("t1", "備註", "TEXT"), col("t2", "備註", "TEXT")]
    );
    expect([mapping.get("s1")?.targetId, mapping.get("s2")?.targetId]).toEqual(["t1", "t2"]);
  });

  it("要另外處理的欄位(例如 Pred)不放進一般對應", () => {
    const mapping = planColumnMapping([col("s1", "Pred", "TEXT")], [col("t1", "Pred", "TEXT")], new Set(["s1"]));
    expect(mapping.size).toBe(0);
  });

  it("狀態選項依名稱對應,id 不同也對得上", () => {
    const source = [col("s1", "Status", "STATUS", statuses(["a", "進行中"], ["b", "完成"]))];
    const target = [col("t1", "Status", "STATUS", statuses(["x", "完成"], ["y", "進行中"]))];
    const m = planColumnMapping(source, target).get("s1")!;
    expect(m.optionMap?.get("a")).toBe("y");
    expect(m.optionMap?.get("b")).toBe("x");
  });

  it("名稱對不上、但目標有同一個 id 的選項也對應", () => {
    const source = [col("s1", "Status", "STATUS", statuses(["done", "Done"]))];
    const target = [col("t1", "Status", "STATUS", statuses(["done", "已完成"]))];
    expect(planColumnMapping(source, target).get("s1")?.optionMap?.get("done")).toBe("done");
  });
});

describe("mapCellValue", () => {
  const status = { targetId: "t1", optionMap: new Map([["a", "y"]]) };

  it("狀態值換成目標看板的選項 id", () => {
    expect(mapCellValue(status, "a")).toEqual({ ok: true, value: "y" });
  });

  it("目標看板沒有的狀態選項:略過這一格", () => {
    expect(mapCellValue(status, "zzz")).toEqual({ ok: false });
  });

  it("其他類型的值原樣帶過去", () => {
    expect(mapCellValue({ targetId: "t2", optionMap: null }, "2026-10-05")).toEqual({ ok: true, value: "2026-10-05" });
    expect(mapCellValue({ targetId: "t2", optionMap: null }, 3)).toEqual({ ok: true, value: 3 });
  });
});

describe("remapPredAcrossBoards", () => {
  const node = (id: string, order: number, groupId = "g") => ({ id, parentId: null, order, groupId });
  const index = buildWbsIndexFromItems([node("a", 0), node("b", 1), node("c", 2)]);

  it("指到一起複製的項目改指複本,範圍外的清掉並計數", () => {
    const idMap = new Map([["a", "a2"]]);
    expect(remapPredAcrossBoards(index, "g", "a,c", (id) => idMap.get(id))).toEqual({ value: "a2", dropped: 1 });
  });

  it("每條依賴自己的關係與延遲保留", () => {
    const idMap = new Map([
      ["a", "a2"],
      ["b", "b2"],
    ]);
    expect(remapPredAcrossBoards(index, "g", "a:SS+2,b", (id) => idMap.get(id)).value).toBe("a2:SS+2,b2");
  });

  it("全部都在範圍外就是空的", () => {
    expect(remapPredAcrossBoards(index, "g", "c", () => undefined)).toEqual({ value: null, dropped: 1 });
  });

  it("沒有前置就什麼都沒有", () => {
    expect(remapPredAcrossBoards(index, "g", null, () => undefined)).toEqual({ value: null, dropped: 0 });
  });
});

describe("stripPredReferences", () => {
  it("拿掉被搬走的項目,其餘條目原樣保留", () => {
    expect(stripPredReferences("a:FS+3,b,c", new Set(["b"]))).toEqual({ changed: true, value: "a:FS+3,c" });
  });

  it("條目帶關係與延遲也認得出是誰", () => {
    expect(stripPredReferences("a:SS+2", new Set(["a"]))).toEqual({ changed: true, value: null });
  });

  it("沒有受影響就維持原值", () => {
    expect(stripPredReferences("a,b", new Set(["z"]))).toEqual({ changed: false, value: "a,b" });
  });

  it("空值或不是字串就沒有變", () => {
    expect(stripPredReferences(null, new Set(["a"])).changed).toBe(false);
    expect(stripPredReferences("", new Set(["a"])).changed).toBe(false);
  });
});
