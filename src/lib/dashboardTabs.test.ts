import { describe, expect, it } from "vitest";
import {
  MAX_DASHBOARD_TABS,
  MAX_TAB_NAME,
  assignSection,
  resolveActiveTab,
  sanitizeDashboardTabs,
  tabOfSection,
  visibleSectionIds,
} from "./dashboardTabs";

const tab = (id: string, name: string, sections: string[] = []) => ({ id, name, sections });

describe("sanitizeDashboardTabs", () => {
  it("格式不對就是沒有子類", () => {
    expect(sanitizeDashboardTabs(null)).toEqual([]);
    expect(sanitizeDashboardTabs("x")).toEqual([]);
    expect(sanitizeDashboardTabs([1, null, {}])).toEqual([]);
  });

  it("名稱去空白、截短、不重複(忽略大小寫);代號不合格或重複的略過", () => {
    const out = sanitizeDashboardTabs([
      tab("aaaa1111", "  個人  "),
      tab("aaaa1111", "團隊"), // 代號重複
      tab("bbbb2222", "個人"), // 名稱重複
      tab("!!", "壞代號"),
      tab("cccc3333", "x".repeat(MAX_TAB_NAME + 5)),
      tab("dddd4444", "   "),
    ]);
    expect(out.map((t) => t.name)).toEqual(["個人", "x".repeat(MAX_TAB_NAME)]);
  });

  it("區塊只留認得的 id,同一個區塊只留在最先出現的子類", () => {
    const out = sanitizeDashboardTabs([
      tab("aaaa1111", "個人", ["myItems", "nope", "myItems", "openRisks"]),
      tab("bbbb2222", "團隊", ["openRisks", "teamWorkload"]),
    ]);
    expect(out).toEqual([
      tab("aaaa1111", "個人", ["myItems", "openRisks"]),
      tab("bbbb2222", "團隊", ["teamWorkload"]),
    ]);
  });

  it(`最多 ${MAX_DASHBOARD_TABS} 個`, () => {
    const many = Array.from({ length: 12 }, (_, i) => tab(`id${String(i).padStart(6, "0")}`, `類${i}`));
    expect(sanitizeDashboardTabs(many)).toHaveLength(MAX_DASHBOARD_TABS);
  });
});

describe("分頁與區塊歸屬", () => {
  const tabs = [tab("aaaa1111", "個人", ["myItems"]), tab("bbbb2222", "團隊", ["teamWorkload"])];

  it("沒選或選到不存在的分頁 = 全部(不限制)", () => {
    expect(resolveActiveTab(tabs, undefined)).toBeNull();
    expect(resolveActiveTab(tabs, "zzzz9999")).toBeNull();
    expect(visibleSectionIds(null)).toBeNull();
  });

  it("選了子類:只顯示歸給它的區塊", () => {
    const active = resolveActiveTab(tabs, "bbbb2222");
    expect([...(visibleSectionIds(active) ?? [])]).toEqual(["teamWorkload"]);
  });

  it("assignSection 把區塊搬到另一個子類,或設成不歸類", () => {
    const moved = assignSection(tabs, "myItems", "bbbb2222");
    expect(moved.map((t) => t.sections)).toEqual([[], ["teamWorkload", "myItems"]]);
    expect(tabOfSection(moved, "myItems")).toBe("bbbb2222");
    const cleared = assignSection(moved, "myItems", null);
    expect(tabOfSection(cleared, "myItems")).toBeNull();
  });
});
