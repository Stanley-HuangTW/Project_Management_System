import { describe, expect, it } from "vitest";
import { chronologicalInsertIndex } from "./phaseOrder";

const phases = [
  { startDate: "2026-08-01" }, // POC
  { startDate: "2026-10-01" }, // EVT1
  { startDate: "2027-01-01" }, // DVT
  { startDate: "2027-04-01" }, // PVT
];

describe("chronologicalInsertIndex", () => {
  it("puts a phase between the neighbours by start date", () => {
    expect(chronologicalInsertIndex(phases, "2026-11-15")).toBe(2);
  });

  it("puts an earlier phase first", () => {
    expect(chronologicalInsertIndex(phases, "2026-07-01")).toBe(0);
  });

  it("appends a phase that starts after all of them", () => {
    expect(chronologicalInsertIndex(phases, "2027-06-01")).toBe(4);
  });

  it("goes after a phase that starts the same day (it was there first)", () => {
    expect(chronologicalInsertIndex(phases, "2026-10-01")).toBe(2);
  });

  it("handles an empty list", () => {
    expect(chronologicalInsertIndex([], "2026-10-01")).toBe(0);
  });

  it("follows the current order even if someone dragged it out of date order", () => {
    // DVT 被拖到 EVT1 前面之後:新階段插在第一個比它晚開始的前面
    const dragged = [{ startDate: "2026-08-01" }, { startDate: "2027-01-01" }, { startDate: "2026-10-01" }];
    expect(chronologicalInsertIndex(dragged, "2026-11-15")).toBe(1);
  });
});
