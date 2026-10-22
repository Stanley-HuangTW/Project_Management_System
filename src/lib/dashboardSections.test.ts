import { describe, expect, it } from "vitest";
import { DASHBOARD_SECTIONS, moveSection, orderDashboardSections, sanitizeDashboardOrder } from "./dashboardSections";

const sections = (...ids: string[]) => ids.map((id) => ({ id }));
const idsOf = (list: { id: string }[]) => list.map((s) => s.id);

describe("orderDashboardSections", () => {
  it("keeps the default order for someone who never arranged anything", () => {
    expect(idsOf(orderDashboardSections(sections("a", "b", "c"), []))).toEqual(["a", "b", "c"]);
  });

  it("puts the sections in the person's own order", () => {
    expect(idsOf(orderDashboardSections(sections("a", "b", "c"), ["c", "a", "b"]))).toEqual(["c", "a", "b"]);
  });

  it("a section added later (not in the stored list) goes to the end, in its default place among the new ones", () => {
    expect(idsOf(orderDashboardSections(sections("a", "b", "c", "d"), ["c", "a"]))).toEqual(["c", "a", "b", "d"]);
  });

  it("ignores stored ids this person has no section for (a supervisor-only block for a member)", () => {
    expect(idsOf(orderDashboardSections(sections("a", "c"), ["c", "gone", "a"]))).toEqual(["c", "a"]);
  });
});

describe("sanitizeDashboardOrder", () => {
  it("keeps only known section ids, once each, in order", () => {
    expect(sanitizeDashboardOrder(["myItems", "nope", "myItems", "openRisks", 5, ""])).toEqual(["myItems", "openRisks"]);
  });

  it("is empty for anything that is not a list", () => {
    expect(sanitizeDashboardOrder(null)).toEqual([]);
    expect(sanitizeDashboardOrder("myItems")).toEqual([]);
  });
});

describe("moveSection", () => {
  it("moves one step up or down", () => {
    expect(moveSection(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveSection(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("does nothing past either end or for an unknown id", () => {
    expect(moveSection(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveSection(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
    expect(moveSection(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
  });

  it("returns a copy, never the same array", () => {
    const original = ["a", "b"];
    expect(moveSection(original, "a", -1)).not.toBe(original);
  });
});

describe("DASHBOARD_SECTIONS", () => {
  it("has unique ids", () => {
    const ids = DASHBOARD_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
