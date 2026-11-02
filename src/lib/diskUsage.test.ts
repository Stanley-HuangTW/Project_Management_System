import { describe, expect, it } from "vitest";
import { GIB, assessDisk, diskAdvice, formatBytes, worstLevel } from "./diskUsage";

describe("assessDisk", () => {
  it("a roomy disk is fine", () => {
    expect(assessDisk(100 * GIB, 60 * GIB)).toBe("ok");
  });

  it("warns under 10 GB free or under 15%, whichever comes first", () => {
    expect(assessDisk(60 * GIB, 9.5 * GIB)).toBe("warn"); // 小磁碟:絕對值先到(比例 15.8%)
    expect(assessDisk(500 * GIB, 60 * GIB)).toBe("warn"); // 大磁碟:比例先到(12%)
    expect(assessDisk(47 * GIB, 8 * GIB)).toBe("warn");
  });

  it("is critical under 2 GB free or under 5%", () => {
    expect(assessDisk(30 * GIB, 1.9 * GIB)).toBe("critical"); // 小磁碟:絕對值先到(比例 6.3%)
    expect(assessDisk(500 * GIB, 20 * GIB)).toBe("critical"); // 大磁碟:比例先到(4%)
    expect(assessDisk(47 * GIB, 2.2 * GIB)).toBe("critical"); // 4.7%
    expect(assessDisk(47 * GIB, 0)).toBe("critical"); // 2026-11-02 那台:100% 滿
  });

  it("does not shout about a disk it cannot measure", () => {
    expect(assessDisk(0, 0)).toBe("ok");
    expect(assessDisk(NaN, 5)).toBe("ok");
  });

  it("sits exactly on the thresholds: the boundary itself is still fine", () => {
    expect(assessDisk(100 * GIB, 15 * GIB)).toBe("ok"); // 剛好 15%、15 GB
    expect(assessDisk(100 * GIB, 10 * GIB)).toBe("warn"); // 10 GB 但只剩 10%
    expect(assessDisk(40 * GIB, 2 * GIB)).toBe("warn"); // 剛好 2 GB、5%:不算危險
  });
});

describe("worstLevel", () => {
  it("takes the worst of several disks", () => {
    expect(worstLevel([])).toBe("ok");
    expect(worstLevel(["ok", "warn"])).toBe("warn");
    expect(worstLevel(["warn", "critical", "ok"])).toBe("critical");
  });
});

describe("formatBytes", () => {
  it("picks a readable unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 2)).toBe("5.0 MB");
    expect(formatBytes(46 * GIB)).toBe("46.0 GB");
    expect(formatBytes(3 * 1024 ** 4)).toBe("3.0 TB");
  });
});

describe("diskAdvice", () => {
  it("says nothing when all is well, and something different when critical", () => {
    expect(diskAdvice("ok")).toBeNull();
    expect(diskAdvice("warn")).toContain("偏少");
    expect(diskAdvice("critical")).toContain("幾乎用完");
  });
});
