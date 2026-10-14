import { describe, expect, it } from "vitest";
import { applyStoredOrder, sanitizeOrder } from "@/lib/sidebarOrder";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((r) => r.id);

describe("applyStoredOrder", () => {
  it("沒有存過順序就維持原本的順序", () => {
    expect(ids(applyStoredOrder(rows("a", "b", "c"), []))).toEqual(["a", "b", "c"]);
  });

  it("照存的順序排", () => {
    expect(ids(applyStoredOrder(rows("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("新建的(清單裡沒有)接在最後,彼此維持原本的順序", () => {
    expect(ids(applyStoredOrder(rows("a", "b", "c", "d"), ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("清單裡有、但已經看不到或刪掉的 id 略過,不留空位", () => {
    expect(ids(applyStoredOrder(rows("a", "b"), ["gone", "b", "a", "also-gone"]))).toEqual(["b", "a"]);
  });

  it("清單裡重複的 id 只算第一次", () => {
    expect(ids(applyStoredOrder(rows("a", "b", "c"), ["b", "a", "b"]))).toEqual(["b", "a", "c"]);
  });

  it("不改動傳進來的陣列", () => {
    const input = rows("a", "b");
    applyStoredOrder(input, ["b", "a"]);
    expect(ids(input)).toEqual(["a", "b"]);
  });
});

describe("sanitizeOrder", () => {
  it("只留字串、去掉空字串與重複", () => {
    expect(sanitizeOrder(["a", "", "b", "a", 3, null, "c"])).toEqual(["a", "b", "c"]);
  });

  it("不是陣列就當作空的", () => {
    expect(sanitizeOrder("abc")).toEqual([]);
    expect(sanitizeOrder(undefined)).toEqual([]);
  });

  it("超過上限只留前面的", () => {
    const many = Array.from({ length: 1500 }, (_, i) => `id${i}`);
    expect(sanitizeOrder(many)).toHaveLength(1000);
  });
});
