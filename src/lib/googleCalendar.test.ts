import { describe, expect, it } from "vitest";
import { clampToMidnight, minutesToHours, toCandidates, toTaipei, type GoogleEvent } from "./googleCalendar";

const ev = (over: Partial<GoogleEvent> & { id: string }): GoogleEvent => ({
  summary: "部門週會",
  status: "confirmed",
  start: { dateTime: "2026-10-06T14:00:00+08:00" },
  end: { dateTime: "2026-10-06T15:00:00+08:00" },
  ...over,
});

describe("toTaipei", () => {
  it("UTC 的時間換成台灣的日期與分鐘", () => {
    expect(toTaipei(Date.parse("2026-10-06T06:30:00Z"))).toEqual({ date: "2026-10-06", minute: 14 * 60 + 30 });
  });

  it("UTC 晚上換成台灣已經是隔天", () => {
    expect(toTaipei(Date.parse("2026-10-06T17:00:00Z"))).toEqual({ date: "2026-10-07", minute: 60 });
  });
});

describe("minutesToHours", () => {
  it("對齊 15 分鐘", () => {
    expect(minutesToHours(60)).toBe(1);
    expect(minutesToHours(50)).toBe(0.75);
    expect(minutesToHours(100)).toBe(1.75);
  });

  it("太短也至少一格", () => {
    expect(minutesToHours(5)).toBe(0.25);
  });
});

describe("toCandidates", () => {
  it("一般行程:台灣時間的日期、開始時間、時數,id 加上 gcal: 前綴", () => {
    const [c] = toCandidates([ev({ id: "abc", htmlLink: "https://calendar.google.com/x" })]);
    expect(c).toEqual({
      externalId: "gcal:abc",
      title: "部門週會",
      date: "2026-10-06",
      startMinute: 840,
      hours: 1,
      link: "https://calendar.google.com/x",
      skip: null,
    });
  });

  it("別的時區的行程也換成台灣時間", () => {
    const [c] = toCandidates([
      ev({ id: "x", start: { dateTime: "2026-10-06T06:00:00-07:00" }, end: { dateTime: "2026-10-06T07:30:00-07:00" } }),
    ]);
    expect(c.date).toBe("2026-10-06");
    expect(c.startMinute).toBe(21 * 60); // 台灣 21:00
    expect(c.hours).toBe(1.5);
  });

  it("依日期、開始時間排序", () => {
    const list = toCandidates([
      ev({ id: "b", summary: "B", start: { dateTime: "2026-10-07T09:00:00+08:00" }, end: { dateTime: "2026-10-07T10:00:00+08:00" } }),
      ev({ id: "a", summary: "A", start: { dateTime: "2026-10-06T15:00:00+08:00" }, end: { dateTime: "2026-10-06T16:00:00+08:00" } }),
      ev({ id: "c", summary: "C", start: { dateTime: "2026-10-06T09:00:00+08:00" }, end: { dateTime: "2026-10-06T10:00:00+08:00" } }),
    ]);
    expect(list.map((c) => c.title)).toEqual(["C", "A", "B"]);
  });

  it("取消的、自己婉拒的、不是一般行程的都丟掉", () => {
    const list = toCandidates([
      ev({ id: "1", status: "cancelled" }),
      ev({ id: "2", attendees: [{ self: true, responseStatus: "declined" }] }),
      ev({ id: "3", eventType: "workingLocation" }),
      ev({ id: "4", eventType: "birthday" }),
      ev({ id: "5", attendees: [{ self: false, responseStatus: "declined" }] }), // 別人婉拒不影響
      ev({ id: "6", eventType: "default" }),
    ]);
    expect(list.map((c) => c.externalId)).toEqual(["gcal:5", "gcal:6"]);
  });

  it("全天行程留著但不能匯入", () => {
    const [c] = toCandidates([{ id: "d", summary: "出差", start: { date: "2026-10-08" }, end: { date: "2026-10-09" } }]);
    expect(c).toMatchObject({ date: "2026-10-08", skip: "ALL_DAY", hours: 0 });
  });

  it("跨日的行程不能匯入", () => {
    const [c] = toCandidates([
      ev({ id: "n", start: { dateTime: "2026-10-06T22:00:00+08:00" }, end: { dateTime: "2026-10-07T02:00:00+08:00" } }),
    ]);
    expect(c.skip).toBe("MULTI_DAY");
  });

  it("剛好到午夜結束的不算跨日", () => {
    const [c] = toCandidates([
      ev({ id: "m", start: { dateTime: "2026-10-06T23:00:00+08:00" }, end: { dateTime: "2026-10-07T00:00:00+08:00" } }),
    ]);
    expect(c).toMatchObject({ skip: null, startMinute: 23 * 60, hours: 1 });
  });

  it("沒標題的給預設名字,標題裡的換行壓成空白", () => {
    const list = toCandidates([ev({ id: "t1", summary: "  " }), ev({ id: "t2", summary: "週會\n(含報告)" })]);
    expect(list.map((c) => c.title).sort()).toEqual(["(無標題)", "週會 (含報告)"].sort());
  });

  it("沒有 id 的、結束早於開始的不處理", () => {
    expect(toCandidates([{ summary: "x", start: { dateTime: "2026-10-06T14:00:00+08:00" } }])).toEqual([]);
    const bad = toCandidates([ev({ id: "z", end: { dateTime: "2026-10-06T13:00:00+08:00" } })]);
    expect(bad).toEqual([]);
  });

  it("對齊後會超過午夜的,時數縮到午夜", () => {
    const [c] = toCandidates([
      ev({ id: "e", start: { dateTime: "2026-10-06T23:50:00+08:00" }, end: { dateTime: "2026-10-06T23:59:00+08:00" } }),
    ]);
    expect(c.skip).toBeNull();
    expect(c.startMinute + Math.round(c.hours * 60)).toBeLessThanOrEqual(1440);
  });
});

describe("clampToMidnight", () => {
  it("不超過午夜就維持原時數", () => {
    expect(clampToMidnight(600, 1)).toBe(1);
  });

  it("超過午夜就縮到午夜", () => {
    expect(clampToMidnight(1410, 1)).toBe(0.5);
  });
});
