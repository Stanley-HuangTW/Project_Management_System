import { describe, expect, it } from "vitest";
import {
  UNASSIGNED_KEY,
  countByStatus,
  filterIssues,
  groupByHandler,
  handlerKeyOf,
  handlerNameOf,
  sortIssues,
  type IssueFilter,
  type MantisIssueRow,
} from "./mantisIssues";

const row = (over: Partial<MantisIssueRow> & { mantisId: number }): MantisIssueRow => ({
  riskId: `r${over.mantisId}`,
  url: `https://m.example.com/view.php?id=${over.mantisId}`,
  title: `議題 ${over.mantisId}`,
  status: "OPEN",
  mantisStatus: "new",
  severity: "minor",
  priority: "normal",
  category: "韌體",
  reporter: "黃雅婷",
  handlerName: null,
  ownerId: null,
  ownerName: null,
  dueDate: null,
  descriptionPreview: "",
  impact: 3,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-05T00:00:00.000Z",
  ...over,
});

const noFilter: IssueFilter = { query: "", status: "all", handler: "all", showClosed: true };

describe("處理人", () => {
  it("key:對得到使用者用 userId,對不到用 Mantis 名字,沒有就是 none", () => {
    expect(handlerKeyOf({ ownerId: "u1", handlerName: "張偉" })).toBe("u1");
    expect(handlerKeyOf({ ownerId: null, handlerName: "外部廠商" })).toBe("mantis:外部廠商");
    expect(handlerKeyOf({ ownerId: null, handlerName: null })).toBe(UNASSIGNED_KEY);
  });

  it("顯示名稱優先用本系統的名字", () => {
    expect(handlerNameOf({ ownerName: "李小明", handlerName: "li.sw" })).toBe("李小明");
    expect(handlerNameOf({ ownerName: null, handlerName: "外部廠商" })).toBe("外部廠商");
    expect(handlerNameOf({ ownerName: null, handlerName: null })).toBe("未指派");
  });
});

describe("sortIssues", () => {
  it("未處理、處理中在前,已結案在後;同狀態嚴重的在前,再依更新時間", () => {
    const sorted = sortIssues([
      row({ mantisId: 1, status: "CLOSED", impact: 5 }),
      row({ mantisId: 2, status: "OPEN", impact: 2 }),
      row({ mantisId: 3, status: "MITIGATING", impact: 5 }),
      row({ mantisId: 4, status: "OPEN", impact: 5, updatedAt: "2026-10-01T00:00:00.000Z" }),
      row({ mantisId: 5, status: "OPEN", impact: 5, updatedAt: "2026-10-06T00:00:00.000Z" }),
    ]);
    expect(sorted.map((r) => r.mantisId)).toEqual([5, 4, 2, 3, 1]);
  });

  it("不改動傳進來的陣列", () => {
    const rows = [row({ mantisId: 1, status: "CLOSED" }), row({ mantisId: 2 })];
    sortIssues(rows);
    expect(rows.map((r) => r.mantisId)).toEqual([1, 2]);
  });
});

describe("filterIssues", () => {
  const rows = [
    row({ mantisId: 11, title: "藍牙斷線", handlerName: "li.sw", ownerId: "u1", ownerName: "李小明", category: "韌體" }),
    row({ mantisId: 12, title: "充電異常", status: "MITIGATING", handlerName: "vendor", category: "電路", severity: "major" }),
    row({ mantisId: 13, title: "外殼刮傷", status: "CLOSED", ownerId: "u2", ownerName: "張建宏", handlerName: "chang" }),
  ];

  it("預設(不勾顯示已結案)看不到已結案的", () => {
    expect(filterIssues(rows, { ...noFilter, showClosed: false }).map((r) => r.mantisId)).toEqual([11, 12]);
  });

  it("勾了顯示已結案就全部", () => {
    expect(filterIssues(rows, noFilter)).toHaveLength(3);
  });

  it("指定狀態:就算沒勾顯示已結案,選「已結案」也看得到", () => {
    expect(filterIssues(rows, { ...noFilter, showClosed: false, status: "CLOSED" }).map((r) => r.mantisId)).toEqual([13]);
    expect(filterIssues(rows, { ...noFilter, status: "MITIGATING" }).map((r) => r.mantisId)).toEqual([12]);
  });

  it("依處理人", () => {
    expect(filterIssues(rows, { ...noFilter, handler: "u1" }).map((r) => r.mantisId)).toEqual([11]);
    expect(filterIssues(rows, { ...noFilter, handler: "mantis:vendor" }).map((r) => r.mantisId)).toEqual([12]);
  });

  it("搜尋:標題、編號(有沒有 # 都行)、處理人、分類、嚴重度;多個關鍵字都要符合", () => {
    expect(filterIssues(rows, { ...noFilter, query: "藍牙" }).map((r) => r.mantisId)).toEqual([11]);
    expect(filterIssues(rows, { ...noFilter, query: "#12" }).map((r) => r.mantisId)).toEqual([12]);
    expect(filterIssues(rows, { ...noFilter, query: "13" }).map((r) => r.mantisId)).toEqual([13]);
    expect(filterIssues(rows, { ...noFilter, query: "李小明" }).map((r) => r.mantisId)).toEqual([11]);
    expect(filterIssues(rows, { ...noFilter, query: "電路 major" }).map((r) => r.mantisId)).toEqual([12]);
    expect(filterIssues(rows, { ...noFilter, query: "電路 韌體" })).toEqual([]);
  });
});

describe("countByStatus", () => {
  it("各狀態幾筆", () => {
    expect(countByStatus([row({ mantisId: 1 }), row({ mantisId: 2, status: "MITIGATING" }), row({ mantisId: 3, status: "CLOSED" }), row({ mantisId: 4 })])).toEqual({
      total: 4,
      open: 2,
      working: 1,
      closed: 1,
    });
  });
});

describe("groupByHandler", () => {
  const rows = [
    row({ mantisId: 1, ownerId: "u1", ownerName: "李小明", handlerName: "li.sw", status: "CLOSED" }),
    row({ mantisId: 2, ownerId: "u1", ownerName: "李小明", handlerName: "li.sw" }),
    row({ mantisId: 3, ownerId: "u2", ownerName: "陳美玲", handlerName: "chen", status: "MITIGATING" }),
    row({ mantisId: 4, ownerId: "u2", ownerName: "陳美玲", handlerName: "chen" }),
    row({ mantisId: 5, ownerId: "u2", ownerName: "陳美玲", handlerName: "chen" }),
    row({ mantisId: 6, handlerName: "外部廠商" }),
    row({ mantisId: 7 }),
  ];

  it("每個處理人一組,附各狀態筆數", () => {
    const g = groupByHandler(rows);
    const chen = g.find((x) => x.key === "u2")!;
    expect(chen).toMatchObject({ name: "陳美玲", userId: "u2", total: 3, open: 2, working: 1, closed: 0 });
    const li = g.find((x) => x.key === "u1")!;
    expect(li).toMatchObject({ total: 2, open: 1, closed: 1 });
  });

  it("手上未結案多的在前;沒有處理人的放最後", () => {
    expect(groupByHandler(rows).map((x) => x.key)).toEqual(["u2", "u1", "mantis:外部廠商", UNASSIGNED_KEY]);
  });

  it("Mantis 上才有的人(對不到本系統的使用者)也有一組,沒有 userId", () => {
    const ext = groupByHandler(rows).find((x) => x.key === "mantis:外部廠商")!;
    expect(ext.userId).toBeNull();
    expect(ext.name).toBe("外部廠商");
  });

  it("組內未結案的在前", () => {
    expect(groupByHandler(rows).find((x) => x.key === "u1")!.issues.map((i) => i.mantisId)).toEqual([2, 1]);
  });

  it("沒有議題就沒有組", () => {
    expect(groupByHandler([])).toEqual([]);
  });
});
