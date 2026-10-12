import { describe, expect, it } from "vitest";
import { resolveDmRestriction, restrictItemsToDmScope, type DmScopeSettings } from "./dmScope";

const on = { limitItems: true, limitLabour: true, limitBudget: true };
const swOn: DmScopeSettings = { SW: on };
const members = [
  { discipline: "SW" as const, userId: "sw1" },
  { discipline: "SW" as const, userId: "sw2" },
  { discipline: "HW" as const, userId: "hw1" },
];
const base = { userId: "dm", isAdmin: false, isBoardOwner: false, members, settings: swOn };
const roles = (...rs: string[]) => rs.map((role) => ({ role: role as never }));

describe("resolveDmRestriction", () => {
  it("沒有打開任何設定:SW DM 跟以前一樣什麼都看得到", () => {
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM"), settings: {} })).toBeNull();
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM"), settings: { SW: { limitItems: false, limitLabour: false, limitBudget: false } } })).toBeNull();
  });

  it("SW DM 三項都打開:工作項看指派給自己與 SW 組員的、人力表只看 SW、預算金額看不到", () => {
    const r = resolveDmRestriction({ ...base, roles: roles("SW_DM") });
    expect(r?.itemAssigneeIds).toEqual(new Set(["dm", "sw1", "sw2"]));
    expect(r?.labourUnits).toEqual(new Set(["SW"]));
    expect(r?.hideBudget).toBe(true);
  });

  it("三項可以各自開關", () => {
    const r = resolveDmRestriction({ ...base, roles: roles("SW_DM"), settings: { SW: { limitItems: true, limitLabour: false, limitBudget: false } } });
    expect(r?.itemAssigneeIds).not.toBeNull();
    expect(r?.labourUnits).toBeNull();
    expect(r?.hideBudget).toBe(false);
  });

  it("HW DM 對到 EE 與 HW 兩個單位;別的職能的設定不影響", () => {
    const r = resolveDmRestriction({ ...base, roles: roles("HW_DM"), settings: { HW: on, SW: { limitItems: false, limitLabour: false, limitBudget: false } } });
    expect(r?.labourUnits).toEqual(new Set(["EE", "HW"]));
    expect(r?.itemAssigneeIds).toEqual(new Set(["dm", "hw1"]));
  });

  it("QA、PM DM 也一樣照職能判斷", () => {
    expect(resolveDmRestriction({ ...base, roles: roles("QA"), settings: { QA: on } })?.labourUnits).toEqual(new Set(["QA"]));
    expect(resolveDmRestriction({ ...base, roles: roles("PM_DM"), settings: { PM: on } })?.labourUnits).toEqual(new Set(["PM"]));
  });

  it("管理者、看板建立者、Team Leader、PMD 不受限", () => {
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM"), isAdmin: true })).toBeNull();
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM"), isBoardOwner: true })).toBeNull();
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM", "TEAM_LEADER") })).toBeNull();
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM", "PMD") })).toBeNull();
  });

  it("不是 DM(沒有角色、只有 PMM)不受限", () => {
    expect(resolveDmRestriction({ ...base, roles: [] })).toBeNull();
    expect(resolveDmRestriction({ ...base, roles: roles("PMM") })).toBeNull();
  });

  it("身兼兩個職能的 DM:兩個都打開才限制,看到的是聯集;只要有一個沒打開那一項就不限", () => {
    const both = resolveDmRestriction({ ...base, roles: roles("SW_DM", "HW_DM"), settings: { SW: on, HW: on } });
    expect(both?.labourUnits).toEqual(new Set(["SW", "EE", "HW"]));
    expect(both?.itemAssigneeIds).toEqual(new Set(["dm", "sw1", "sw2", "hw1"]));
    expect(resolveDmRestriction({ ...base, roles: roles("SW_DM", "HW_DM"), settings: { SW: on } })).toBeNull();
    const partial = resolveDmRestriction({
      ...base,
      roles: roles("SW_DM", "HW_DM"),
      settings: { SW: on, HW: { limitItems: false, limitLabour: true, limitBudget: false } },
    });
    expect(partial?.itemAssigneeIds).toBeNull();
    expect(partial?.labourUnits).toEqual(new Set(["SW", "EE", "HW"]));
    expect(partial?.hideBudget).toBe(false);
  });
});

describe("restrictItemsToDmScope", () => {
  // 樹:root ─ a(指派給 sw1)─ a1(指派給 hw1)
  //          └ b(指派給 hw1)─ b1(指派給 sw2)
  //     c(沒指派)    d(dm 自己建立、沒指派)
  const items = [
    { id: "root", parentId: null, createdById: "boss", assigneeIds: [] },
    { id: "a", parentId: "root", createdById: "boss", assigneeIds: ["sw1"] },
    { id: "a1", parentId: "a", createdById: "boss", assigneeIds: ["hw1"] },
    { id: "b", parentId: "root", createdById: "boss", assigneeIds: ["hw1"] },
    { id: "b1", parentId: "b", createdById: "boss", assigneeIds: ["sw2"] },
    { id: "c", parentId: null, createdById: "boss", assigneeIds: [] },
    { id: "d", parentId: null, createdById: "dm", assigneeIds: [] },
  ];
  const all = new Set(items.map((i) => i.id));
  const scope = { userId: "dm", assigneeIds: new Set(["dm", "sw1", "sw2"]) };

  it("留下指派給範圍內的人的項目、自己建立的,再加上它們的上層;其他的拿掉", () => {
    expect(restrictItemsToDmScope(all, items, scope)).toEqual(new Set(["root", "a", "b", "b1", "d"]));
  });

  it("上層項目(root、b)顯示出來,但上層自己的別的子項目(a1 指派給 HW)不顯示", () => {
    const r = restrictItemsToDmScope(all, items, scope);
    expect(r.has("b")).toBe(true);
    expect(r.has("a1")).toBe(false);
    expect(r.has("c")).toBe(false);
  });

  it("只會縮小:原本就看不到的(私人項目)不會因為指派給 SW 就變得看得到", () => {
    const visible = new Set(["root", "a", "b1"]); // b 是私人項目,b1 的上層看不到
    const r = restrictItemsToDmScope(visible, items, scope);
    expect(r.has("b")).toBe(false);
    expect([...r].every((id) => visible.has(id))).toBe(true);
  });

  it("親子關係壞掉(繞圈)也不會卡住", () => {
    const loop = [
      { id: "x", parentId: "y", createdById: null, assigneeIds: ["sw1"] },
      { id: "y", parentId: "x", createdById: null, assigneeIds: [] },
    ];
    const r = restrictItemsToDmScope(new Set(["x", "y"]), loop, scope);
    expect(r).toEqual(new Set(["x", "y"]));
  });

  it("沒有任何相關項目:空的", () => {
    expect(restrictItemsToDmScope(all, items, { userId: "nobody", assigneeIds: new Set(["zzz"]) })).toEqual(new Set());
  });
});
