import { describe, expect, it } from "vitest";
import {
  PROJECT_CATEGORY_LABEL,
  UNASSIGNED_PROJECT_LABEL,
  addDaysIso,
  aggregateTimesheet,
  bucketKeyOf,
  bucketKeysInRange,
  bucketLabel,
  canViewTimesheetOf,
  categoryColumnKey,
  daysBetweenInclusive,
  isValidIsoDate,
  monthRangeOf,
  weekDays,
  type TimesheetViewer,
} from "./timesheet";

describe("canViewTimesheetOf", () => {
  const member: TimesheetViewer = { id: "m1", role: "MEMBER", canViewAllTimesheets: false };
  const supervisor: TimesheetViewer = { id: "s1", role: "SUPERVISOR", canViewAllTimesheets: false };
  const bigSupervisor: TimesheetViewer = { id: "s2", role: "SUPERVISOR", canViewAllTimesheets: true };
  const admin: TimesheetViewer = { id: "a1", role: "ADMIN", canViewAllTimesheets: false };

  it("本人看得到自己的", () => {
    expect(canViewTimesheetOf(member, { id: "m1", supervisorId: "s1" })).toBe(true);
  });

  it("一般成員看不到別人的", () => {
    expect(canViewTimesheetOf(member, { id: "m2", supervisorId: "s1" })).toBe(false);
  });

  it("主管看得到直屬部屬", () => {
    expect(canViewTimesheetOf(supervisor, { id: "m1", supervisorId: "s1" })).toBe(true);
  });

  it("主管看不到不是自己直屬的人", () => {
    expect(canViewTimesheetOf(supervisor, { id: "m3", supervisorId: "s9" })).toBe(false);
    expect(canViewTimesheetOf(supervisor, { id: "m4", supervisorId: null })).toBe(false);
  });

  it("被指定可看全部的主管看得到所有人", () => {
    expect(canViewTimesheetOf(bigSupervisor, { id: "m3", supervisorId: "s9" })).toBe(true);
    expect(canViewTimesheetOf(bigSupervisor, { id: "m4", supervisorId: null })).toBe(true);
  });

  it("ADMIN 看得到所有人", () => {
    expect(canViewTimesheetOf(admin, { id: "m3", supervisorId: "s9" })).toBe(true);
  });

  it("成員自己被勾了旗標也一樣看得到全部——旗標看的是人,不是角色", () => {
    const flagged: TimesheetViewer = { ...member, canViewAllTimesheets: true };
    expect(canViewTimesheetOf(flagged, { id: "m2", supervisorId: "s1" })).toBe(true);
  });
});

describe("日期工具", () => {
  it("isValidIsoDate 擋掉格式對但不存在的日期", () => {
    expect(isValidIsoDate("2026-10-05")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("2026-1-5")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
  });

  it("addDaysIso 跨月跨年", () => {
    expect(addDaysIso("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("daysBetweenInclusive 含頭含尾", () => {
    expect(daysBetweenInclusive("2026-10-05", "2026-10-05")).toBe(1);
    expect(daysBetweenInclusive("2026-10-01", "2026-10-31")).toBe(31);
  });

  it("monthRangeOf 抓到月初月底(含閏年二月)", () => {
    expect(monthRangeOf("2026-10-15")).toEqual({ monthStart: "2026-10-01", monthEnd: "2026-10-31" });
    expect(monthRangeOf("2028-02-10")).toEqual({ monthStart: "2028-02-01", monthEnd: "2028-02-29" });
  });

  it("weekDays 從週一排到週日", () => {
    expect(weekDays("2026-09-28")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });
});

describe("時間桶", () => {
  it("bucketKeyOf:日=自己、週=週一、月=YYYY-MM", () => {
    expect(bucketKeyOf("2026-10-02", "day")).toBe("2026-10-02");
    expect(bucketKeyOf("2026-10-02", "week")).toBe("2026-09-28");
    expect(bucketKeyOf("2026-10-04", "week")).toBe("2026-09-28");
    expect(bucketKeyOf("2026-10-05", "week")).toBe("2026-10-05");
    expect(bucketKeyOf("2026-10-02", "month")).toBe("2026-10");
  });

  it("bucketKeysInRange 週粒度:區間頭尾落在週中間也各算一個桶", () => {
    expect(bucketKeysInRange("2026-09-30", "2026-10-07", "week")).toEqual(["2026-09-28", "2026-10-05"]);
  });

  it("bucketKeysInRange 月粒度:跨月跨年", () => {
    expect(bucketKeysInRange("2026-11-20", "2027-01-05", "month")).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("bucketKeysInRange 日粒度:每天一個", () => {
    expect(bucketKeysInRange("2026-10-01", "2026-10-03", "day")).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });

  it("bucketLabel", () => {
    expect(bucketLabel("2026-10-02", "day")).toBe("10-02");
    expect(bucketLabel("2026-10", "month")).toBe("2026-10");
    expect(bucketLabel("2026-09-28", "week")).toContain("2026 W40");
  });
});

describe("aggregateTimesheet", () => {
  const base = { from: "2026-09-28", to: "2026-10-04", granularity: "day" as const };

  it("同一人同一天多筆會累加,並且分別記在時間桶跟類別上", () => {
    const stats = aggregateTimesheet(
      [
        { userId: "u1", date: "2026-09-29", hours: 3, categoryLabel: PROJECT_CATEGORY_LABEL },
        { userId: "u1", date: "2026-09-29", hours: 1.5, categoryLabel: "例行會議" },
        { userId: "u1", date: "2026-09-29", hours: 2, categoryLabel: PROJECT_CATEGORY_LABEL },
      ],
      { ...base, userOrder: ["u1"] }
    );
    expect(stats.users[0].total).toBe(6.5);
    expect(stats.users[0].byBucket["2026-09-29"]).toBe(6.5);
    expect(stats.users[0].byCategory).toEqual({ [PROJECT_CATEGORY_LABEL]: 5, 例行會議: 1.5 });
  });

  it("沒有任何工時的人也會留一列(全是 0)", () => {
    const stats = aggregateTimesheet(
      [{ userId: "u1", date: "2026-09-29", hours: 4, categoryLabel: "其他" }],
      { ...base, userOrder: ["u1", "u2"] }
    );
    expect(stats.users.map((u) => u.userId)).toEqual(["u1", "u2"]);
    expect(stats.users[1].total).toBe(0);
    expect(stats.users[1].byBucket).toEqual({});
  });

  it("區間外的日期、不在名單內的人都被忽略", () => {
    const stats = aggregateTimesheet(
      [
        { userId: "u1", date: "2026-09-27", hours: 8, categoryLabel: "其他" },
        { userId: "u1", date: "2026-10-05", hours: 8, categoryLabel: "其他" },
        { userId: "stranger", date: "2026-09-29", hours: 8, categoryLabel: "其他" },
        { userId: "u1", date: "2026-09-29", hours: 1, categoryLabel: "其他" },
      ],
      { ...base, userOrder: ["u1"] }
    );
    expect(stats.totals.total).toBe(1);
    expect(stats.users[0].total).toBe(1);
  });

  it("類別順序:專案工作項在最前面,其餘照名稱", () => {
    const stats = aggregateTimesheet(
      [
        { userId: "u1", date: "2026-09-29", hours: 1, categoryLabel: "行政事務" },
        { userId: "u1", date: "2026-09-29", hours: 1, categoryLabel: PROJECT_CATEGORY_LABEL },
        { userId: "u1", date: "2026-09-29", hours: 1, categoryLabel: "例行會議" },
      ],
      { ...base, userOrder: ["u1"] }
    );
    expect(stats.categories[0]).toBe(PROJECT_CATEGORY_LABEL);
    expect(stats.categories).toHaveLength(3);
  });

  it("週粒度:同一週的不同天落在同一個桶", () => {
    const stats = aggregateTimesheet(
      [
        { userId: "u1", date: "2026-09-28", hours: 2, categoryLabel: "其他" },
        { userId: "u1", date: "2026-10-04", hours: 3, categoryLabel: "其他" },
      ],
      { from: "2026-09-28", to: "2026-10-04", granularity: "week", userOrder: ["u1"] }
    );
    expect(stats.buckets).toEqual(["2026-09-28"]);
    expect(stats.users[0].byBucket).toEqual({ "2026-09-28": 5 });
  });

  it("月粒度跨月拆開,合計列加總所有人", () => {
    const stats = aggregateTimesheet(
      [
        { userId: "u1", date: "2026-10-30", hours: 2, categoryLabel: "其他" },
        { userId: "u2", date: "2026-11-02", hours: 3, categoryLabel: "其他" },
      ],
      { from: "2026-10-01", to: "2026-11-30", granularity: "month", userOrder: ["u1", "u2"] }
    );
    expect(stats.buckets).toEqual(["2026-10", "2026-11"]);
    expect(stats.totals.byBucket).toEqual({ "2026-10": 2, "2026-11": 3 });
    expect(stats.totals.total).toBe(5);
  });

  it("小數加總不會留下浮點誤差", () => {
    const stats = aggregateTimesheet(
      [
        { userId: "u1", date: "2026-09-29", hours: 0.1, categoryLabel: "其他" },
        { userId: "u1", date: "2026-09-29", hours: 0.2, categoryLabel: "其他" },
      ],
      { ...base, userOrder: ["u1"] }
    );
    expect(stats.users[0].total).toBe(0.3);
  });

  it("沒有資料時回傳空統計而不是丟錯", () => {
    const stats = aggregateTimesheet([], { ...base, userOrder: [] });
    expect(stats.users).toEqual([]);
    expect(stats.categories).toEqual([]);
    expect(stats.totals.total).toBe(0);
  });
});

describe("aggregateTimesheet:專案維度", () => {
  const options = { from: "2026-10-05", to: "2026-10-11", granularity: "day" as const, userOrder: ["u1", "u2"] };
  const row = (userId: string, hours: number, categoryLabel: string, projectLabel?: string) => ({
    userId,
    date: "2026-10-06",
    hours,
    categoryLabel,
    projectLabel,
  });

  it("沒有帶專案的工時歸在「未歸屬專案」", () => {
    const stats = aggregateTimesheet([row("u1", 2, "部門週會")], options);
    expect(stats.columns).toEqual([
      { key: categoryColumnKey(UNASSIGNED_PROJECT_LABEL, "部門週會"), project: UNASSIGNED_PROJECT_LABEL, category: "部門週會" },
    ]);
  });

  it("欄位依專案分組:工時多的專案在前、未歸屬專案最後;專案底下專案工作項在前、其餘照名稱", () => {
    const stats = aggregateTimesheet(
      [
        row("u1", 1, "例行會議", "M3"),
        row("u1", 8, PROJECT_CATEGORY_LABEL, "AMR Platform"),
        row("u2", 2, "例行會議", "AMR Platform"),
        row("u1", 3, "部門週會"),
        row("u2", 1, "出差", "AMR Platform"),
      ],
      options
    );
    expect(stats.columns.map((c) => `${c.project}/${c.category}`)).toEqual([
      `AMR Platform/${PROJECT_CATEGORY_LABEL}`,
      "AMR Platform/出差",
      "AMR Platform/例行會議",
      "M3/例行會議",
      `${UNASSIGNED_PROJECT_LABEL}/部門週會`,
    ]);
  });

  it("每個人、合計都有 專案 × 類別 的工時", () => {
    const stats = aggregateTimesheet([row("u1", 2, "例行會議", "M3"), row("u2", 1.5, "例行會議", "M3")], options);
    const key = categoryColumnKey("M3", "例行會議");
    expect(stats.users[0].byColumn[key]).toBe(2);
    expect(stats.users[1].byColumn[key]).toBe(1.5);
    expect(stats.totals.byColumn[key]).toBe(3.5);
  });
});
