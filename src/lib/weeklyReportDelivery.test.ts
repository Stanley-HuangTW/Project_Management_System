import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sendMailChecked = vi.fn();
vi.mock("@/lib/mail", () => ({ sendMailChecked: (...args: unknown[]) => sendMailChecked(...args) }));

import { deliverWeeklyReport } from "@/lib/weeklyReportDelivery";
import { diffWeeks, type ProgramSection, type WeeklyReportData } from "@/lib/weeklyReport";

const session = { userId: "u1", email: "henry@example.com", name: "Henry", role: "MEMBER" } as const;

function program(name: string | null, boardName: string): ProgramSection {
  return {
    programName: name,
    boards: [{ boardId: `b-${boardName}`, boardName, programName: name, total: 1, done: 0, overdue: 0, inProgress: 1, notStarted: 0 }],
    items: [],
    budgets: [],
    delays: [],
    risks: [],
    itemUpdates: [],
  };
}

function snapshot(programs: ProgramSection[]): WeeklyReportData {
  return {
    weekStart: "2026-10-05",
    weekEnd: "2026-10-11",
    generatedAt: "2026-10-12 08:00",
    viewerName: "Henry",
    programs,
    departments: [],
    upcomingDays: 7,
    activity: [],
  };
}

describe("週報寄信:一個專案一封", () => {
  beforeEach(() => {
    sendMailChecked.mockReset();
    sendMailChecked.mockResolvedValue({ ok: true });
    process.env.WEEKLY_REPORT_DIR = mkdtempSync(path.join(tmpdir(), "weekly-"));
  });

  it("三個專案寄三封,標題是「專案名稱+週報 W 週數 (起 ~ 迄)」,寄給要求產生的人", async () => {
    const data = snapshot([program("AMR BOX", "AMR BOX專案"), program("AMR Platform", "AMR Platform專案"), program("M3", "M3專案")]);
    const result = await deliverWeeklyReport(session, data, diffWeeks(data, null), "full markdown");

    expect(sendMailChecked).toHaveBeenCalledTimes(3);
    expect(sendMailChecked.mock.calls.map((c) => c[0])).toEqual(Array(3).fill("henry@example.com"));
    expect(sendMailChecked.mock.calls.map((c) => c[1])).toEqual([
      "AMR BOX週報 W41 (2026-10-05(週一) ~ 2026-10-11(週日))",
      "AMR Platform週報 W41 (2026-10-05(週一) ~ 2026-10-11(週日))",
      "M3週報 W41 (2026-10-05(週一) ~ 2026-10-11(週日))",
    ]);
    expect(result.mail.ok).toBe(true);
    expect(result.mail.messages.map((m) => m.programName)).toEqual(["AMR BOX", "AMR Platform", "M3"]);
  });

  it("每一封只有那個專案的內容", async () => {
    const data = snapshot([program("AMR BOX", "AMR BOX專案"), program("M3", "M3專案")]);
    await deliverWeeklyReport(session, data, diffWeeks(data, null), "full markdown");

    const [boxBody, m3Body] = sendMailChecked.mock.calls.map((c) => c[2] as string);
    expect(boxBody).toContain("## 專案:AMR BOX");
    expect(boxBody).not.toContain("M3專案");
    expect(m3Body).toContain("## 專案:M3");
    expect(m3Body).not.toContain("AMR BOX");
    expect(boxBody.startsWith("# AMR BOX週報 2026 W41")).toBe(true);
  });

  it("信裡有「依職能的工作項」,而且只有那個專案的人", async () => {
    const data = snapshot([program("AMR BOX", "AMR BOX專案"), program("M3", "M3專案")]);
    const person = (userName: string, programName: string) => ({
      userId: `u-${userName}`,
      userName,
      role: "DM" as const,
      discipline: "EE 電機",
      programName,
      groupName: programName,
      boardName: `${programName}專案`,
      overdue: [],
      completedThisWeek: [],
      upcoming: [],
    });
    data.departments = [person("Frank Chuang", "AMR BOX"), person("Henry Chen", "M3")];
    await deliverWeeklyReport(session, data, diffWeeks(data, null), "full markdown");

    const [boxBody, m3Body] = sendMailChecked.mock.calls.map((c) => c[2] as string);
    expect(boxBody).toContain("### 依職能的工作項");
    expect(boxBody).toContain("#### EE 電機");
    expect(boxBody).toContain("**[DM] Frank Chuang**");
    expect(boxBody).not.toContain("Henry Chen");
    expect(m3Body).toContain("**[DM] Henry Chen**");
    expect(m3Body).not.toContain("Frank Chuang");
  });

  it("一封寄失敗,後面的還是會寄,結果裡說清楚是哪一封", async () => {
    sendMailChecked.mockResolvedValueOnce({ ok: false, reason: "SMTP 連線逾時" }).mockResolvedValue({ ok: true });
    const data = snapshot([program("AMR BOX", "AMR BOX專案"), program("M3", "M3專案")]);
    const result = await deliverWeeklyReport(session, data, diffWeeks(data, null), "full");

    expect(sendMailChecked).toHaveBeenCalledTimes(2);
    expect(result.mail.ok).toBe(false);
    expect(result.mail.reason).toBe("SMTP 連線逾時");
    expect(result.mail.messages.map((m) => m.ok)).toEqual([false, true]);
  });

  it("沒有歸屬專案群組的看板用「未歸屬專案群組」當名字", async () => {
    const data = snapshot([program(null, "孤立看板")]);
    await deliverWeeklyReport(session, data, diffWeeks(data, null), "full");
    expect(sendMailChecked.mock.calls[0][1]).toBe("未歸屬專案群組週報 W41 (2026-10-05(週一) ~ 2026-10-11(週日))");
  });

  it("帳號沒有 email 就不寄", async () => {
    const data = snapshot([program("M3", "M3專案")]);
    const result = await deliverWeeklyReport({ ...session, email: "" }, data, diffWeeks(data, null), "full");
    expect(sendMailChecked).not.toHaveBeenCalled();
    expect(result.mail).toEqual({ ok: false, reason: "這個帳號沒有 email", messages: [] });
  });

  it("看不到任何看板(沒有專案)就沒有信可以寄,並說明原因", async () => {
    const data = snapshot([]);
    const result = await deliverWeeklyReport(session, data, diffWeeks(data, null), "full");
    expect(sendMailChecked).not.toHaveBeenCalled();
    expect(result.mail.ok).toBe(false);
    expect(result.mail.reason).toMatch(/沒有可以寄/);
  });
});
