import { describe, expect, it } from "vitest";
import {
  HOUR_PX,
  endMinuteOf,
  layoutDayEvents,
  minuteToPx,
  pxToMinute,
  selectionToSlot,
  snapHours,
  snapToGrid,
} from "./calendarLayout";

describe("座標與時間換算", () => {
  it("一小時 = HOUR_PX,來回換算", () => {
    expect(minuteToPx(60)).toBe(HOUR_PX);
    expect(pxToMinute(HOUR_PX * 2)).toBe(120);
    expect(pxToMinute(minuteToPx(525))).toBeCloseTo(525);
  });

  it("snapToGrid 對齊 15 分鐘並夾在一天之內", () => {
    expect(snapToGrid(527)).toBe(525);
    expect(snapToGrid(533)).toBe(540);
    expect(snapToGrid(-10)).toBe(0);
    expect(snapToGrid(5000)).toBe(1425);
  });

  it("snapHours 對齊 0.25 小時,至少一格", () => {
    expect(snapHours(0.6)).toBe(0.5);
    expect(snapHours(0.9)).toBe(1);
    expect(snapHours(0.01)).toBe(0.25);
  });

  it("endMinuteOf", () => {
    expect(endMinuteOf(525, 0.75)).toBe(570);
  });
});

describe("selectionToSlot(拖曳選一段時間)", () => {
  it("由上往下拖", () => {
    expect(selectionToSlot(540, 600)).toEqual({ startMinute: 540, hours: 1 });
  });

  it("由下往上拖也一樣", () => {
    expect(selectionToSlot(600, 540)).toEqual({ startMinute: 540, hours: 1 });
  });

  it("只點一下(沒拖)就是一格 15 分鐘", () => {
    expect(selectionToSlot(540, 540)).toEqual({ startMinute: 540, hours: 0.25 });
  });

  it("不會超過午夜", () => {
    const slot = selectionToSlot(1400, 2000);
    expect(slot.startMinute + slot.hours * 60).toBeLessThanOrEqual(1440);
  });
});

describe("layoutDayEvents(重疊並排)", () => {
  const ev = (key: string, startMinute: number, endMinute: number) => ({ key, startMinute, endMinute });

  it("不重疊的事件各自佔滿整列", () => {
    const layout = layoutDayEvents([ev("a", 480, 540), ev("b", 600, 660)]);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 1 });
    expect(layout.get("b")).toEqual({ lane: 0, lanes: 1 });
  });

  it("兩個重疊的並排成兩條車道", () => {
    const layout = layoutDayEvents([ev("a", 480, 600), ev("b", 540, 660)]);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(layout.get("b")).toEqual({ lane: 1, lanes: 2 });
  });

  it("緊鄰(一個結束、另一個剛好開始)不算重疊", () => {
    const layout = layoutDayEvents([ev("a", 480, 540), ev("b", 540, 600)]);
    expect(layout.get("a")?.lanes).toBe(1);
    expect(layout.get("b")?.lanes).toBe(1);
  });

  it("三個事件:c 可以接在 a 後面用第一條車道,整群寬度是 2", () => {
    const layout = layoutDayEvents([ev("a", 480, 540), ev("b", 500, 700), ev("c", 560, 620)]);
    expect(layout.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(layout.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(layout.get("c")).toEqual({ lane: 0, lanes: 2 });
  });

  it("不同群各自算寬度", () => {
    const layout = layoutDayEvents([ev("a", 480, 600), ev("b", 500, 560), ev("c", 800, 860)]);
    expect(layout.get("a")?.lanes).toBe(2);
    expect(layout.get("c")).toEqual({ lane: 0, lanes: 1 });
  });

  it("太短的事件以最短高度計算,緊鄰的短事件不會被畫成疊在一起", () => {
    const layout = layoutDayEvents([ev("a", 480, 481), ev("b", 485, 486)]);
    expect(layout.get("a")?.lanes).toBe(2);
  });

  it("沒有事件回空", () => {
    expect(layoutDayEvents([]).size).toBe(0);
  });
});
