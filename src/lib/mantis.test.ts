import { describe, expect, it } from "vitest";
import {
  buildDescription,
  formatDueDate,
  issueUrl,
  mantisIdFromUrl,
  mapMantisIssue,
  normalizeBaseUrl,
  parseIssuesPage,
  parseProjects,
  severityToImpact,
  statusToRisk,
  type MantisIssue,
} from "./mantis";

const BASE = "https://mantis.example.com";

const issue = (over: Partial<MantisIssue> = {}): MantisIssue => ({
  id: 123,
  summary: "主控板開機偶發當機",
  description: "冷開機約 1/20 機率卡在 bootloader",
  status: { id: 50, name: "assigned", label: "assigned" },
  severity: { id: 60, name: "major" },
  handler: { id: 7, name: "wchang", real_name: "張偉", email: "Wei.Chang@Example.com" },
  created_at: "2026-10-01T09:00:00+08:00",
  updated_at: "2026-10-05T16:30:00+08:00",
  ...over,
});

describe("normalizeBaseUrl", () => {
  it("拿掉結尾斜線與 /api/rest", () => {
    expect(normalizeBaseUrl("https://mantis.example.com/")).toEqual({ url: "https://mantis.example.com" });
    expect(normalizeBaseUrl("https://mantis.example.com/api/rest/")).toEqual({ url: "https://mantis.example.com" });
    expect(normalizeBaseUrl("https://x.com/mantis/api/rest")).toEqual({ url: "https://x.com/mantis" });
  });

  it("貼成某一頁的網址也行(拿掉 .php 檔名、查詢字串)", () => {
    expect(normalizeBaseUrl("https://mantis.example.com/view.php?id=5")).toEqual({ url: "https://mantis.example.com" });
    expect(normalizeBaseUrl("https://x.com/bugs/my_view_page.php#a")).toEqual({ url: "https://x.com/bugs" });
  });

  it("保留子路徑與埠號", () => {
    expect(normalizeBaseUrl("http://10.0.0.5:8080/mantis")).toEqual({ url: "http://10.0.0.5:8080/mantis" });
  });

  it("不是 http(s) 或亂打的就拒絕", () => {
    expect("error" in normalizeBaseUrl("ftp://x.com")).toBe(true);
    expect("error" in normalizeBaseUrl("javascript:alert(1)")).toBe(true);
    expect("error" in normalizeBaseUrl("mantis.example.com")).toBe(true);
    expect("error" in normalizeBaseUrl("")).toBe(true);
  });
});

describe("mantisIdFromUrl", () => {
  it("認得同一個 Mantis 網站的議題頁", () => {
    expect(mantisIdFromUrl("https://mantis.example.com/view.php?id=123", BASE)).toBe(123);
    expect(mantisIdFromUrl(issueUrl(BASE, 45), BASE)).toBe(45);
  });

  it("子路徑的網站也行", () => {
    expect(mantisIdFromUrl("https://x.com/mantis/view.php?id=9", "https://x.com/mantis")).toBe(9);
  });

  it("別的網站、別的頁面、沒有編號都是 null", () => {
    expect(mantisIdFromUrl("https://other.com/view.php?id=123", BASE)).toBeNull();
    expect(mantisIdFromUrl("https://mantis.example.com/my_view_page.php", BASE)).toBeNull();
    expect(mantisIdFromUrl("https://mantis.example.com/view.php", BASE)).toBeNull();
    expect(mantisIdFromUrl("https://mantis.example.com/view.php?id=abc", BASE)).toBeNull();
    expect(mantisIdFromUrl("not a url", BASE)).toBeNull();
  });
});

describe("statusToRisk / severityToImpact", () => {
  it("沒人處理 = 未處理,有人處理 = 處理中,resolved 以後 = 已結案", () => {
    expect([10, 20, 30, 40].map(statusToRisk)).toEqual(["OPEN", "OPEN", "OPEN", "OPEN"]);
    expect([50, 60, 79].map(statusToRisk)).toEqual(["MITIGATING", "MITIGATING", "MITIGATING"]);
    expect([80, 90].map(statusToRisk)).toEqual(["CLOSED", "CLOSED"]);
    expect(statusToRisk(undefined)).toBe("OPEN");
  });

  it("嚴重度對應衝擊 1–5", () => {
    expect([10, 20, 30].map(severityToImpact)).toEqual([1, 1, 1]);
    expect(severityToImpact(40)).toBe(2);
    expect(severityToImpact(50)).toBe(3);
    expect(severityToImpact(60)).toBe(4);
    expect([70, 80].map(severityToImpact)).toEqual([5, 5]);
    expect(severityToImpact(undefined)).toBe(3);
  });
});

describe("formatDueDate", () => {
  it("換成台灣的日期", () => {
    expect(formatDueDate("2026-10-20T00:00:00+08:00")).toBe("2026-10-20");
    expect(formatDueDate("2026-10-19T18:00:00+00:00")).toBe("2026-10-20");
  });

  it("沒有或看不懂就是 null", () => {
    expect(formatDueDate(null)).toBeNull();
    expect(formatDueDate("")).toBeNull();
    expect(formatDueDate("soon")).toBeNull();
  });
});

describe("buildDescription", () => {
  it("說明後面接最近的備註,附日期與作者", () => {
    const text = buildDescription(
      issue({
        notes: [
          { id: 1, reporter: { name: "a", real_name: "王小明" }, text: "已重現", created_at: "2026-10-02T10:00:00+08:00" },
          { id: 2, reporter: { name: "b" }, text: "換了一顆電容\n再測看看", created_at: "2026-10-03T10:00:00+08:00" },
        ],
      })
    );
    expect(text).toContain("冷開機約 1/20 機率卡在 bootloader");
    expect(text).toContain("── Mantis 備註(最近 2 則,共 2 則)──");
    expect(text).toContain("[2026-10-02 王小明] 已重現");
    expect(text).toContain("[2026-10-03 b] 換了一顆電容 再測看看");
  });

  it("只留最近 5 則,並說明總共幾則", () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({ id: i, text: `備註${i + 1}`, created_at: "2026-10-02T10:00:00+08:00" }));
    const text = buildDescription(issue({ notes }));
    expect(text).toContain("最近 5 則,共 8 則");
    expect(text).toContain("備註8");
    expect(text).not.toContain("備註3\n");
    expect(text).not.toContain("備註1 ");
  });

  it("太長的備註與整段都會截短", () => {
    const text = buildDescription(issue({ description: "x".repeat(7000), notes: [{ text: "y".repeat(500) }] }));
    expect(text.length).toBeLessThanOrEqual(6001);
    const only = buildDescription(issue({ description: "", notes: [{ text: "y".repeat(500) }] }));
    expect(only).toContain("y".repeat(300) + "…");
  });

  it("沒有說明也沒有備註就是空字串;空白備註不算", () => {
    expect(buildDescription(issue({ description: "", notes: [] }))).toBe("");
    expect(buildDescription(issue({ description: "", notes: [{ text: "  " }] }))).toBe("");
  });
});

describe("mapMantisIssue", () => {
  it("一筆完整的議題", () => {
    const m = mapMantisIssue(issue(), BASE);
    expect(m).toMatchObject({
      mantisId: 123,
      mantisUrl: "https://mantis.example.com/view.php?id=123",
      mantisStatus: "assigned",
      mantisHandler: "張偉",
      title: "主控板開機偶發當機",
      status: "MITIGATING",
      probability: 5,
      impact: 4,
      handlerEmail: "wei.chang@example.com",
      dueDate: null,
    });
    expect(m.mantisUpdatedAt?.toISOString()).toBe("2026-10-05T08:30:00.000Z");
    expect(m.createdAt?.toISOString()).toBe("2026-10-01T01:00:00.000Z");
  });

  it("欄位都缺也不會壞:標題用 Mantis 編號、衝擊中等、沒有處理人", () => {
    const m = mapMantisIssue({ id: 7 }, BASE);
    expect(m).toMatchObject({
      title: "Mantis #7",
      status: "OPEN",
      impact: 3,
      handlerEmail: null,
      mantisHandler: null,
      mantisStatus: null,
      mantisUpdatedAt: null,
      createdAt: null,
    });
  });

  it("標題的換行壓成空白、太長截短", () => {
    expect(mapMantisIssue(issue({ summary: "a\nb  c" }), BASE).title).toBe("a b c");
    expect(mapMantisIssue(issue({ summary: "z".repeat(300) }), BASE).title).toHaveLength(200);
  });

  it("已解決/已關閉 = 已結案;到期日換成台灣日期", () => {
    const m = mapMantisIssue(issue({ status: { id: 90, name: "closed" }, due_date: "2026-10-20T00:00:00+08:00" }), BASE);
    expect(m.status).toBe("CLOSED");
    expect(m.dueDate).toBe("2026-10-20");
  });
});

describe("parseIssuesPage / parseProjects", () => {
  it("取 issues 陣列,也容忍直接回陣列;沒有 id 的丟掉", () => {
    expect(parseIssuesPage({ issues: [{ id: 1 }, { summary: "no id" }, null, { id: 2 }] }).map((i) => i.id)).toEqual([1, 2]);
    expect(parseIssuesPage([{ id: 3 }]).map((i) => i.id)).toEqual([3]);
  });

  it("格式不對就是空的", () => {
    expect(parseIssuesPage({})).toEqual([]);
    expect(parseIssuesPage(null)).toEqual([]);
    expect(parseIssuesPage("x")).toEqual([]);
  });

  it("專案清單", () => {
    expect(parseProjects({ projects: [{ id: 1, name: " M-100 " }, { id: 2 }, { name: "no id" }] })).toEqual([
      { id: 1, name: "M-100" },
      { id: 2, name: "專案 2" },
    ]);
    expect(parseProjects({})).toEqual([]);
  });
});
