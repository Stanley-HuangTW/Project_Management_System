import { describe, expect, it } from "vitest";
import type { MantisIssue } from "./mantis";
import {
  buildIssueCreate,
  buildIssuePatch,
  categoryFor,
  contentToMantis,
  defaultIssueMapping,
  forcedWriteMapping,
  mantisTextMatchesCase,
  mantisToCaseFields,
  parseIssueMapping,
  priorityFromMantis,
  statusFromMantis,
  textFromMantis,
  validateIssueMapping,
} from "./issueMantis";

const issue = (over: Partial<MantisIssue> = {}): MantisIssue => ({
  id: 7,
  summary: "充電站無法充電",
  description: "接上電源後沒有反應",
  status: { id: 50, name: "assigned" },
  severity: { id: 60, name: "major" },
  handler: { id: 3, name: "jason", real_name: "Jason Huang", email: "jason@example.com" },
  created_at: "2026-11-01T02:00:00+08:00",
  updated_at: "2026-11-02T10:00:00+08:00",
  ...over,
});

const writable = () => {
  const m = defaultIssueMapping();
  m.writeBack = { enabled: true, fields: ["status", "handler", "priority", "content"] };
  return m;
};

describe("狀態與優先級對應(預設)", () => {
  const m = defaultIssueMapping();
  it("Mantis 已解決 → 暫時解決 TC、已關閉 → 永久解決 PC、其他 → 處理中", () => {
    expect(statusFromMantis(m, 10)).toBe("OPEN");
    expect(statusFromMantis(m, 50)).toBe("OPEN");
    expect(statusFromMantis(m, 80)).toBe("TC");
    expect(statusFromMantis(m, 90)).toBe("PC");
    expect(statusFromMantis(m, undefined)).toBe("OPEN");
  });
  it("嚴重度:當機 / 阻擋 P0、重大 P1、次要 P2、輕微 / 文字 / 建議 P3", () => {
    expect(priorityFromMantis(m, 80)).toBe("P0");
    expect(priorityFromMantis(m, 70)).toBe("P0");
    expect(priorityFromMantis(m, 60)).toBe("P1");
    expect(priorityFromMantis(m, 50)).toBe("P2");
    expect(priorityFromMantis(m, 40)).toBe("P3");
    expect(priorityFromMantis(m, 20)).toBe("P3");
    expect(priorityFromMantis(m, 10)).toBe("P3");
  });
  it("對應表有設定就優先用", () => {
    const custom = { ...m, statusIn: { "80": "PC" as const }, priorityIn: { "60": "P0" as const } };
    expect(statusFromMantis(custom, 80)).toBe("PC");
    expect(priorityFromMantis(custom, 60)).toBe("P0");
  });
});

describe("設定的讀取與驗證", () => {
  it("壞掉或沒有的設定用預設,而且預設不寫回", () => {
    for (const bad of [null, undefined, "x", 3, [], { statusIn: "壞的", writeBack: 5 }]) {
      const p = parseIssueMapping(bad);
      expect(p.writeBack.enabled).toBe(false);
      expect(p.statusOut.PC?.id).toBe(90);
    }
  });
  it("讀回存著的設定:分類、對應、寫回開關", () => {
    const p = parseIssueMapping({
      categoryDefault: " 客服 ",
      categoryByProduct: { prodA: "硬體", "": "x", prodB: 5 },
      statusIn: { "80": "PC", "x": "PC", "90": "壞" },
      writeBack: { enabled: true, fields: ["status", "content", "亂寫"] },
    });
    expect(p.categoryDefault).toBe("客服");
    expect(p.categoryByProduct).toEqual({ prodA: "硬體" });
    expect(p.statusIn).toEqual({ "80": "PC" });
    expect(p.writeBack).toEqual({ enabled: true, fields: ["status", "content"] });
  });
  it("驗證:不合法的項目、開寫回卻沒勾欄位、寫回狀態卻沒指定永久解決,都回說明", () => {
    expect("error" in validateIssueMapping({ statusIn: { "80": "亂來" } })).toBe(true);
    expect("error" in validateIssueMapping({ writeBack: { enabled: true, fields: [] } })).toBe(true);
    expect("error" in validateIssueMapping({ writeBack: { enabled: true, fields: ["status"] }, statusOut: {} })).toBe(true);
    expect("mapping" in validateIssueMapping({ writeBack: { enabled: true, fields: ["status"] } })).toBe(true);
    expect("error" in validateIssueMapping("x")).toBe(true);
  });
  it("建立用的分類:產品有對應用它,沒有用預設,都沒有是 null", () => {
    const m = { ...defaultIssueMapping(), categoryDefault: "一般", categoryByProduct: { p1: "硬體" } };
    expect(categoryFor(m, "p1")).toBe("硬體");
    expect(categoryFor(m, "p2")).toBe("一般");
    expect(categoryFor(m, null)).toBe("一般");
    expect(categoryFor(defaultIssueMapping(), "p1")).toBeNull();
  });
});

describe("文字內容", () => {
  it("摘要 = 問題描述第一行(最多 128 字);說明 = 規格與行為,沒有就用完整問題描述", () => {
    expect(contentToMantis({ description: "充電站壞了\n第二行細節", behavior: "" })).toEqual({ summary: "充電站壞了", description: "充電站壞了\n第二行細節" });
    expect(contentToMantis({ description: "標題", behavior: "詳細行為" })).toEqual({ summary: "標題", description: "詳細行為" });
    expect(contentToMantis({ description: "x".repeat(200), behavior: "" }).summary).toHaveLength(128);
    expect(contentToMantis({ description: "", behavior: "只有行為" })).toEqual({ summary: "只有行為", description: "只有行為" });
  });
  it("規格與行為尾巴接著的 Mantis 備註區塊不會送回 Mantis", () => {
    const notes = "── Mantis 備註(最近 1 則,共 1 則)──\n[2026-11-02 Jason] 已收到";
    expect(contentToMantis({ description: "標題", behavior: `詳細行為\n\n${notes}` }).description).toBe("詳細行為");
  });
  it("從 Mantis 來:摘要變問題描述、說明加備註變規格與行為", () => {
    const t = textFromMantis(issue({ notes: [{ text: "已收到", reporter: { name: "jason" }, created_at: "2026-11-02T10:00:00+08:00" }] }));
    expect(t.description).toBe("充電站無法充電");
    expect(t.behavior.startsWith("接上電源後沒有反應")).toBe(true);
    expect(t.behavior).toContain("Mantis 備註");
  });
  it("案件文字送去 Mantis 跟 Mantis 現況一樣 → 同步不用蓋掉(使用者多寫的行不會被吃掉)", () => {
    const local = { description: "充電站無法充電\n客戶說昨天開始的", behavior: "接上電源後沒有反應" };
    expect(mantisTextMatchesCase(issue(), local)).toBe(true);
    expect(mantisTextMatchesCase(issue({ summary: "別人改過的標題" }), local)).toBe(false);
  });
});

describe("Mantis → 案件欄位", () => {
  it("狀態、優先級、日期(台灣時間)、處理人", () => {
    const f = mantisToCaseFields(issue({ status: { id: 80, name: "resolved" } }), defaultIssueMapping());
    expect(f).toMatchObject({ mantisId: 7, status: "TC", priority: "P1", issueDate: "2026-11-01", updatedDate: "2026-11-02" });
    expect(f.handler).toMatchObject({ id: 3, email: "jason@example.com" });
    expect(f.mantisUpdatedAt?.getTime()).toBe(Date.parse("2026-11-02T10:00:00+08:00"));
  });
  it("沒有處理人、沒有時間也不會壞", () => {
    const f = mantisToCaseFields({ id: 9 }, defaultIssueMapping());
    expect(f).toMatchObject({ handler: null, issueDate: null, status: "OPEN", priority: "P2" });
    expect(f.description).toBe("Mantis #9");
  });
});

describe("寫回(PATCH)", () => {
  const owner = { id: "u1", name: "Jason Huang", email: "jason@example.com" };
  const users = [{ id: 3, name: "jason", realName: "Jason Huang", email: "jason@example.com" }];

  it("只送有變的欄位:狀態改暫時解決 → resolved + resolution", () => {
    const r = buildIssuePatch({ status: "TC" }, { mapping: writable(), issue: issue(), mantisUsers: users });
    expect("error" in r).toBe(false);
    if ("payload" in r) {
      expect(r.payload.status).toEqual({ id: 80, name: "resolved" });
      expect(r.payload.resolution).toEqual({ id: 20, name: "fixed" });
    }
  });
  it("Mantis 上現況跟要寫的同一類(assigned 與處理中)就不動", () => {
    const r = buildIssuePatch({ status: "OPEN", priority: "P1", owner }, { mapping: writable(), issue: issue(), mantisUsers: users });
    expect(r).toEqual({ payload: {}, summary: [] });
  });
  it("優先級 P0 → 嚴重度 crash", () => {
    const r = buildIssuePatch({ priority: "P0" }, { mapping: writable(), issue: issue(), mantisUsers: users });
    expect("payload" in r && r.payload.severity).toEqual({ id: 70, name: "crash" });
  });
  it("負責人換人:用 Email 比對 Mantis 使用者;對不上回錯誤說明", () => {
    const other = issue({ handler: { id: 99, name: "bob" } });
    const ok = buildIssuePatch({ owner }, { mapping: writable(), issue: other, mantisUsers: users });
    expect("payload" in ok && ok.payload.handler).toEqual({ id: 3 });
    const bad = buildIssuePatch({ owner: { id: "u2", name: "路人", email: "x@y.z" } }, { mapping: writable(), issue: other, mantisUsers: users });
    expect("error" in bad && bad.error).toContain("找不到「路人」對應的 Mantis 帳號");
  });
  it("取消指派:Mantis 已經有處理人 → 說明做不到;本來就沒有 → 沒事", () => {
    expect("error" in buildIssuePatch({ owner: null }, { mapping: writable(), issue: issue(), mantisUsers: users })).toBe(true);
    expect(buildIssuePatch({ owner: null }, { mapping: writable(), issue: issue({ handler: undefined }), mantisUsers: users })).toEqual({ payload: {}, summary: [] });
  });
  it("文字有變才送摘要 / 說明,而且只送變的那個", () => {
    const r = buildIssuePatch({ text: { description: "新的標題", behavior: "接上電源後沒有反應" } }, { mapping: writable(), issue: issue(), mantisUsers: users });
    expect("payload" in r && r.payload).toEqual({ summary: "新的標題" });
  });
  it("沒開寫回的欄位 → 回說明,不默默略過", () => {
    const closed = defaultIssueMapping();
    const r = buildIssuePatch({ status: "TC" }, { mapping: closed, issue: issue(), mantisUsers: users });
    expect("error" in r && r.error).toContain("沒有開啟寫回「狀態」");
    const onlyStatus = { ...closed, writeBack: { enabled: true, fields: ["status" as const] } };
    const r2 = buildIssuePatch({ priority: "P0" }, { mapping: onlyStatus, issue: issue(), mantisUsers: users });
    expect("error" in r2 && r2.error).toContain("優先級");
  });
  it("NA(不適用)沒設寫回的 Mantis 狀態 → 不動 Mantis", () => {
    expect(buildIssuePatch({ status: "NA" }, { mapping: writable(), issue: issue(), mantisUsers: users })).toEqual({ payload: {}, summary: [] });
  });
});

describe("建立到 Mantis(POST)", () => {
  const base = { description: "充電站無法充電", behavior: "", productId: "p1", priority: "P1" as const };
  it("帶專案、分類、摘要、說明、嚴重度", () => {
    const m = { ...defaultIssueMapping(), categoryDefault: "客服" };
    const r = buildIssueCreate(base, { mapping: m, projectId: 12 });
    expect("payload" in r && r.payload).toMatchObject({ summary: "充電站無法充電", project: { id: 12 }, category: { name: "客服" }, severity: { id: 60, name: "major" } });
  });
  it("沒有任何分類 → 回說明(Mantis 分類必填)", () => {
    const r = buildIssueCreate(base, { mapping: defaultIssueMapping(), projectId: 12 });
    expect("error" in r && r.error).toContain("分類");
  });
  it("產品型號有對應的分類就用它", () => {
    const m = { ...defaultIssueMapping(), categoryDefault: "客服", categoryByProduct: { p1: "硬體" } };
    const r = buildIssueCreate(base, { mapping: m, projectId: 12 });
    expect("payload" in r && r.payload.category).toEqual({ name: "硬體" });
  });
  it("問題描述空的 → 回說明", () => {
    const m = { ...defaultIssueMapping(), categoryDefault: "客服" };
    expect("error" in buildIssueCreate({ ...base, description: "" }, { mapping: m, projectId: 1 })).toBe(true);
  });
  it("建立後補欄位用的設定不看「允許寫回」開關", () => {
    const f = forcedWriteMapping(defaultIssueMapping());
    expect(f.writeBack.enabled).toBe(true);
    const r = buildIssuePatch({ status: "TC" }, { mapping: f, issue: issue(), mantisUsers: [] });
    expect("payload" in r && r.payload.status).toBeDefined();
  });
});
