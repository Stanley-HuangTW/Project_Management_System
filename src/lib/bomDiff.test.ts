import { describe, expect, it } from "vitest";
import { summariseBom, type BomLineInput } from "./bom";
import { BUILT_IN_BOM_COLUMNS, type BomColumnDef } from "./bomColumns";
import { diffBoms } from "./bomDiff";

type L = [id: string, parentId: string | null, name: string, over?: Partial<BomLineInput>];

/** 一份 BOM:照清單順序排,算好小計。 */
function bom(lines: L[]) {
  const input: BomLineInput[] = lines.map(([id, parentId, name, over], i) => ({
    id,
    parentId,
    name,
    vendor: "",
    partNumber: "",
    qty: 1,
    unitPrice: 0,
    currency: "TWD",
    fxRate: 1,
    note: "",
    deliveryDate: null,
    extra: {},
    order: i,
    ...over,
  }));
  return summariseBom(input).nodes;
}

const diff = (a: L[], b: L[], columns: BomColumnDef[] = BUILT_IN_BOM_COLUMNS, userName?: (id: string) => string) =>
  diffBoms(bom(a), bom(b), columns, userName);

const custom = (id: string, name: string, type: BomColumnDef["type"], over: Partial<BomColumnDef> = {}): BomColumnDef => ({
  id,
  name,
  type,
  options: [],
  required: false,
  defaultValue: null,
  visible: true,
  ...over,
});

describe("diffBoms", () => {
  it("兩份一模一樣:全部沒變、沒有任何一列標成有變動", () => {
    const lines: L[] = [
      ["a", null, "主機板", { partNumber: "MB-1", unitPrice: 1200 }],
      ["b", null, "電池模組"],
      ["c", "b", "電芯", { partNumber: "CELL-1", qty: 14, unitPrice: 95 }],
    ];
    const d = diff(lines, lines.map(([id, p, n, o]) => [`x${id}`, p ? `x${p}` : null, n, o] as L));
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 0, same: 3 });
    expect(d.rows.every((r) => r.status === "same" && !r.dirty)).toBe(true);
    expect(d.baseUnitCostTwd).toBe(d.targetUnitCostTwd);
  });

  it("新增與移除:只在對象裡 = 新增,只在基準裡 = 移除,各自只有一邊的小計", () => {
    const d = diff(
      [
        ["a", null, "主機板", { partNumber: "MB-1", unitPrice: 1000 }],
        ["b", null, "舊外殼", { partNumber: "CASE-OLD", unitPrice: 300 }],
      ],
      [
        ["a", null, "主機板", { partNumber: "MB-1", unitPrice: 1000 }],
        ["c", null, "新外殼", { partNumber: "CASE-NEW", unitPrice: 450, qty: 2 }],
      ]
    );
    expect(d.counts).toEqual({ added: 1, removed: 1, changed: 0, same: 1 });
    const added = d.rows.find((r) => r.status === "added")!;
    const removed = d.rows.find((r) => r.status === "removed")!;
    expect(added.name).toBe("新外殼");
    expect(added.beforeTotalTwd).toBeNull();
    expect(added.afterTotalTwd).toBe(900);
    expect(removed.name).toBe("舊外殼");
    expect(removed.beforeTotalTwd).toBe(300);
    expect(removed.afterTotalTwd).toBeNull();
    expect(d.baseUnitCostTwd).toBe(1300);
    expect(d.targetUnitCostTwd).toBe(1900);
  });

  it("改價:零件列出「單價」的前後,祖先只當上下文(沒變、但標成有變動),小計前後不同", () => {
    const d = diff(
      [
        ["p", null, "電池模組"],
        ["c", "p", "電芯", { partNumber: "CELL-1", qty: 14, unitPrice: 95 }],
      ],
      [
        ["p", null, "電池模組"],
        ["c", "p", "電芯", { partNumber: "CELL-1", qty: 14, unitPrice: 120 }],
      ]
    );
    const cell = d.rows.find((r) => r.name === "電芯")!;
    expect(cell.status).toBe("changed");
    expect(cell.changes).toEqual([{ label: "單價", before: "95 TWD", after: "120 TWD" }]);
    expect(cell.beforeTotalTwd).toBe(1330);
    expect(cell.afterTotalTwd).toBe(1680);
    const parent = d.rows.find((r) => r.name === "電池模組")!;
    expect(parent.status).toBe("same");
    expect(parent.dirty).toBe(true);
    expect(parent.beforeTotalTwd).toBe(1330);
    expect(parent.afterTotalTwd).toBe(1680);
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 1, same: 1 });
  });

  it("換廠商、換交期、改備註:欄位叫看板設定的名字", () => {
    const columns = BUILT_IN_BOM_COLUMNS.map((c) => (c.id === "vendor" ? { ...c, name: "供應商" } : c));
    const d = diff(
      [["a", null, "主機板", { partNumber: "MB-1", vendor: "華創", deliveryDate: "2026-11-20", note: "" }]],
      [["a", null, "主機板", { partNumber: "MB-1", vendor: "廣達", deliveryDate: "2026-12-05", note: "改版" }]],
      columns
    );
    expect(d.rows[0].changes).toEqual([
      { label: "供應商", before: "華創", after: "廣達" },
      { label: "交期", before: "2026-11-20", after: "2026-12-05" },
      { label: "備註", before: "—", after: "改版" },
    ]);
  });

  it("隱藏的欄位不比", () => {
    const columns = BUILT_IN_BOM_COLUMNS.map((c) => (c.id === "note" ? { ...c, visible: false } : c));
    const d = diff(
      [["a", null, "主機板", { partNumber: "MB-1", note: "舊" }]],
      [["a", null, "主機板", { partNumber: "MB-1", note: "新" }]],
      columns
    );
    expect(d.rows[0].status).toBe("same");
  });

  it("換料:名稱一樣、料號不一樣,算同一列、改了型號/料號(不是一個移除一個新增)", () => {
    const d = diff(
      [["a", null, "電芯", { partNumber: "OLD-1", vendor: "Samsung" }]],
      [["z", null, "電芯", { partNumber: "NEW-9", vendor: "LG" }]]
    );
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 1, same: 0 });
    expect(d.rows[0].changes.map((c) => c.label)).toEqual(["廠商", "型號/料號"]);
  });

  it("料號一樣、名稱改了:同一列,列出「名稱」的前後", () => {
    const d = diff(
      [["a", null, "主控板", { partNumber: "MB-1" }]],
      [["z", null, "主機板", { partNumber: "MB-1" }]]
    );
    expect(d.rows[0].status).toBe("changed");
    expect(d.rows[0].changes).toEqual([{ label: "名稱", before: "主控板", after: "主機板" }]);
  });

  it("搬到別的子集底下:用料號認得出來,列出「上層」的前後", () => {
    const d = diff(
      [
        ["m", null, "主機板"],
        ["bat", null, "電池模組"],
        ["x", "m", "保護板", { partNumber: "BMS-1", unitPrice: 380 }],
      ],
      [
        ["m", null, "主機板"],
        ["bat", null, "電池模組"],
        ["x", "bat", "保護板", { partNumber: "BMS-1", unitPrice: 380 }],
      ]
    );
    const row = d.rows.find((r) => r.name === "保護板")!;
    expect(row.status).toBe("changed");
    expect(row.changes).toEqual([{ label: "上層", before: "主機板", after: "電池模組" }]);
    expect(row.depth).toBe(1);
    expect(d.counts.added + d.counts.removed).toBe(0);
  });

  it("同一個料號出現好幾列:照樹的順序一對一對", () => {
    const d = diff(
      [
        ["a", null, "螺絲 A", { partNumber: "SCREW", qty: 4 }],
        ["b", null, "螺絲 B", { partNumber: "SCREW", qty: 8 }],
      ],
      [
        ["a", null, "螺絲 A", { partNumber: "SCREW", qty: 4 }],
        ["b", null, "螺絲 B", { partNumber: "SCREW", qty: 6 }],
      ]
    );
    expect(d.rows.map((r) => r.status)).toEqual(["same", "changed"]);
    expect(d.rows[1].changes).toEqual([{ label: "數量", before: "8", after: "6" }]);
  });

  it("沒有料號的列,在對得上的上層底下用名稱對;同名的照順序一對一", () => {
    const d = diff(
      [
        ["p", null, "外殼組"],
        ["a", "p", "螺絲", { qty: 2 }],
        ["b", "p", "螺絲", { qty: 4 }],
      ],
      [
        ["p", null, "外殼組"],
        ["a", "p", "螺絲", { qty: 2 }],
        ["b", "p", "螺絲", { qty: 4 }],
        ["c", "p", "螺絲", { qty: 6 }],
      ]
    );
    expect(d.counts).toEqual({ added: 1, removed: 0, changed: 0, same: 3 });
  });

  it("兄弟列的順序不一樣不算變動", () => {
    const d = diff(
      [
        ["a", null, "甲", { partNumber: "A" }],
        ["b", null, "乙", { partNumber: "B" }],
      ],
      [
        ["b", null, "乙", { partNumber: "B" }],
        ["a", null, "甲", { partNumber: "A" }],
      ]
    );
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 0, same: 2 });
  });

  it("外幣:幣別或匯率不同才列匯率;台幣對台幣不比匯率", () => {
    const usd: L = ["a", null, "測距模組", { partNumber: "URG", unitPrice: 420, currency: "USD", fxRate: 32 }];
    const same = diff([usd], [["a", null, "測距模組", { partNumber: "URG", unitPrice: 420, currency: "USD", fxRate: 32 }]]);
    expect(same.rows[0].status).toBe("same");
    const fx = diff([usd], [["a", null, "測距模組", { partNumber: "URG", unitPrice: 420, currency: "USD", fxRate: 31 }]]);
    expect(fx.rows[0].changes).toEqual([{ label: "匯率", before: "32", after: "31" }]);
    const twd = diff(
      [["a", null, "外殼", { partNumber: "C", unitPrice: 100, fxRate: 1 }]],
      [["a", null, "外殼", { partNumber: "C", unitPrice: 100, fxRate: 1.2 }]]
    );
    expect(twd.rows[0].status).toBe("same");
  });

  it("自訂欄位:下拉、人員(換成姓名)、勾選(是 / 沒勾);檔案附件不比", () => {
    const columns = [
      ...BUILT_IN_BOM_COLUMNS,
      custom("c_status01", "驗證狀態", "SELECT", { options: ["未送樣", "通過"] }),
      custom("c_buyer001", "採購負責人", "PERSON"),
      custom("c_rohs0001", "RoHS", "CHECKBOX"),
      custom("c_spec0001", "規格書", "FILE"),
      custom("c_hidden01", "內部代碼", "TEXT", { visible: false }),
    ];
    const names: Record<string, string> = { u1: "李美玲", u2: "王小明" };
    const d = diff(
      [["a", null, "主控板", { partNumber: "MB-1", extra: { c_status01: "未送樣", c_buyer001: "u1", c_hidden01: "x" } }]],
      [["a", null, "主控板", { partNumber: "MB-1", extra: { c_status01: "通過", c_buyer001: "u2", c_rohs0001: true, c_hidden01: "y" } }]],
      columns,
      (id) => names[id] ?? id
    );
    expect(d.rows[0].changes).toEqual([
      { label: "驗證狀態", before: "未送樣", after: "通過" },
      { label: "採購負責人", before: "李美玲", after: "王小明" },
      { label: "RoHS", before: "—", after: "是" },
    ]);
  });

  it("零件變成子集(或相反):說明類型變了,不比子集自己沒意義的單價", () => {
    const d = diff(
      [["a", null, "電池模組", { partNumber: "BAT", unitPrice: 500 }]],
      [
        ["a", null, "電池模組", { partNumber: "BAT", unitPrice: 500 }],
        ["c", "a", "電芯", { partNumber: "CELL", unitPrice: 95, qty: 4 }],
      ]
    );
    const row = d.rows.find((r) => r.name === "電池模組")!;
    expect(row.changes).toEqual([{ label: "類型", before: "零件", after: "子集" }]);
    expect(d.rows.find((r) => r.name === "電芯")!.status).toBe("added");
  });

  it("兩邊都是子集:自己的單價不比,只比數量;小計變了是因為底下", () => {
    const d = diff(
      [
        ["p", null, "電池模組", { unitPrice: 1 }],
        ["c", "p", "電芯", { partNumber: "CELL", unitPrice: 100 }],
      ],
      [
        ["p", null, "電池模組", { unitPrice: 999, qty: 2 }],
        ["c", "p", "電芯", { partNumber: "CELL", unitPrice: 100 }],
      ]
    );
    const parent = d.rows.find((r) => r.name === "電池模組")!;
    expect(parent.changes).toEqual([{ label: "數量", before: "1", after: "2" }]);
    expect(parent.beforeTotalTwd).toBe(100);
    expect(parent.afterTotalTwd).toBe(200);
  });

  it("整個子集被移除:底下的列也都是移除,縮排掛在原本的上層底下", () => {
    const d = diff(
      [
        ["a", null, "主機板", { partNumber: "MB-1" }],
        ["p", null, "舊電池模組"],
        ["c", "p", "舊電芯", { partNumber: "OLD-CELL", unitPrice: 50 }],
      ],
      [["a", null, "主機板", { partNumber: "MB-1" }]]
    );
    expect(d.rows.map((r) => [r.name, r.status, r.depth])).toEqual([
      ["主機板", "same", 0],
      ["舊電池模組", "removed", 0],
      ["舊電芯", "removed", 1],
    ]);
    expect(d.counts).toEqual({ added: 0, removed: 2, changed: 0, same: 1 });
  });

  it("只在基準裡的列,掛在它原本的上層(對得上的那一列)底下", () => {
    const d = diff(
      [
        ["p", null, "電池模組"],
        ["c1", "p", "電芯", { partNumber: "CELL" }],
        ["c2", "p", "保護板", { partNumber: "BMS" }],
      ],
      [
        ["p", null, "電池模組"],
        ["c1", "p", "電芯", { partNumber: "CELL" }],
      ]
    );
    expect(d.rows.map((r) => [r.name, r.status, r.depth])).toEqual([
      ["電池模組", "same", 0],
      ["電芯", "same", 1],
      ["保護板", "removed", 1],
    ]);
    expect(d.rows[0].dirty).toBe(true);
  });

  it("空的 BOM:全部新增(或全部移除),不會壞掉", () => {
    const lines: L[] = [["a", null, "主機板", { unitPrice: 100 }]];
    expect(diff([], lines).counts).toEqual({ added: 1, removed: 0, changed: 0, same: 0 });
    expect(diff(lines, []).counts).toEqual({ added: 0, removed: 1, changed: 0, same: 0 });
    expect(diff([], []).rows).toEqual([]);
  });

  it("名稱與料號比對忽略大小寫與前後 / 重複的空白", () => {
    const d = diff(
      [["a", null, "Main  Board", { partNumber: " mb-1 " }]],
      [["z", null, "main board", { partNumber: "MB-1" }]]
    );
    expect(d.counts.added + d.counts.removed).toBe(0);
  });
});
