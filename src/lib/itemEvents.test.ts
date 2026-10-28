import { describe, expect, it } from "vitest";
import { classifyStatusOption, completedAtOf, describeEvent, describeRiskEvent, eventTargetField, eventTargetTab, pickStatusTimes, formatEventTime, formatEventDateTime, taipeiDateOf, type ItemEventKind } from "./itemEvents";

describe("classifyStatusOption", () => {
  it("標籤叫 Completed / Done / 完成 / 已完成:完成(匯入的看板選項是隨機 id,只能看標籤)", () => {
    for (const label of ["Completed", "completed", "Done", "完成", "已完成", "已結案"]) {
      expect(classifyStatusOption({ id: "x1", label })).toBe("done");
    }
  });

  it("預設的 done id、報表設定指定的完成選項:完成", () => {
    expect(classifyStatusOption({ id: "done", label: "隨便" })).toBe("done");
    expect(classifyStatusOption({ id: "opt9", label: "驗收通過" }, ["opt9"])).toBe("done");
  });

  it("In Progress / 進行中 / 實作中:進行中;預設的 in_progress id 也是", () => {
    for (const label of ["In Progress", "in-progress", "inprogress", "進行中", "實作中", "處理中", "Doing"]) {
      expect(classifyStatusOption({ id: "x2", label })).toBe("inProgress");
    }
    expect(classifyStatusOption({ id: "in_progress", label: "任何字" })).toBe("inProgress");
  });

  it("Planned / 待處理 / 未處理 / Stuck:其他;「未完成」不會被當成完成", () => {
    for (const label of ["Planned", "待處理", "未處理", "Stuck", "未完成", "Not Completed"]) {
      expect(classifyStatusOption({ id: "x3", label })).toBe("other");
    }
  });
});

describe("completedAtOf", () => {
  const summary = { startedAt: null, completedAt: "2026-10-12T01:12:57.000Z", last: null };
  it("現在是完成狀態才有完成時間;切回別的狀態就清掉", () => {
    expect(completedAtOf(summary, true)).toBe("2026-10-12T01:12:57.000Z");
    expect(completedAtOf(summary, false)).toBeNull();
  });
  it("沒有紀錄:null(由呼叫端退回計畫完成日)", () => {
    expect(completedAtOf(undefined, true)).toBeNull();
    expect(completedAtOf({ startedAt: null, completedAt: null, last: null }, true)).toBeNull();
  });
});

describe("台灣時間", () => {
  it("UTC 晚上換成台灣已經是隔天;顯示成 月/日 時:分", () => {
    expect(taipeiDateOf("2026-10-11T17:30:00.000Z")).toBe("2026-10-12");
    expect(formatEventTime("2026-10-12T01:12:57.000Z")).toBe("10/12 09:12");
    expect(formatEventTime("2026-10-11T17:05:00.000Z")).toBe("10/12 01:05");
  });
});

describe("eventTargetField", () => {
  it("names the field a field-change or status event is about", () => {
    expect(eventTargetField("FIELD", "「duration」:28 → 29")).toBe("duration");
    expect(eventTargetField("FIELD", "「start(set)」已更新:2026-10-08 → 2026-08-10")).toBe("start(set)");
    expect(eventTargetField("STATUS", "「Status」:Planned → Completed")).toBe("Status");
  });

  it("has no field for comments, links and todos, or a message that does not start with one", () => {
    expect(eventTargetField("UPDATE", "「Status」誤判")).toBeNull();
    expect(eventTargetField("LINK", "新增連結:「規格書」")).toBeNull();
    expect(eventTargetField("TODO", "新增待辦事項:「送樣」")).toBeNull();
    expect(eventTargetField("FIELD", "批次搬移到「二、项目执行」底下")).toBeNull();
  });
});

describe("eventTargetTab", () => {
  it("更新跳更新、連結跳連結、待辦事項跳待辦事項,狀態與其他欄位跳項目卡片", () => {
    expect(eventTargetTab("UPDATE")).toBe("updates");
    expect(eventTargetTab("LINK")).toBe("links");
    expect(eventTargetTab("TODO")).toBe("checklist");
    expect(eventTargetTab("STATUS")).toBe("card");
    expect(eventTargetTab("FIELD")).toBe("card");
  });
});

describe("describeEvent(更新記錄那一格,跟通知列表同一套說法)", () => {
  const line = (kind: ItemEventKind, summary: string) => ({ kind, at: "2026-10-12T01:12:57.000Z", actorName: "Schumi Su", summary });

  it("狀態與其他欄位修改:標「修改」,訊息用通知的寫法(「欄位」:舊 → 新)", () => {
    expect(describeEvent(line("STATUS", "「Status」已更新:Planned → Completed"))).toEqual({
      label: "修改",
      tone: "UPDATED",
      message: "「Status」:Planned → Completed",
    });
    expect(describeEvent(line("FIELD", "「% Done」已更新:未設定 → 0.7")).message).toBe("「% Done」:未設定 → 0.7");
  });

  it("批次修改、拖曳時程這類沒有「舊 → 新」的句子:原樣", () => {
    expect(describeEvent(line("FIELD", "「Status」已批次更新")).message).toBe("「Status」已批次更新");
    expect(describeEvent(line("FIELD", "拖曳調整時程:2026-10-01~2026-10-05 → 2026-10-02~2026-10-06")).label).toBe("修改");
  });

  it("指派:標「指派」(通知也叫指派)", () => {
    expect(describeEvent(line("FIELD", "「負責人」指派給 Schumi Su"))).toEqual({
      label: "指派",
      tone: "ASSIGNED",
      message: "「負責人」指派給 Schumi Su",
    });
  });

  it("更新(留言):標「留言」,訊息是留言的內容;舊紀錄沒有內容就寫「新增留言」", () => {
    expect(describeEvent(line("UPDATE", "新增留言:@SY Chen 已選用 STM32G474MCT3"))).toEqual({
      label: "留言",
      tone: "COMMENTED",
      message: "@SY Chen 已選用 STM32G474MCT3",
    });
    expect(describeEvent(line("UPDATE", "新增留言")).message).toBe("新增留言");
  });

  it("連結與待辦事項沒有對應的通知類型:各標各的,中性色", () => {
    expect(describeEvent(line("LINK", "新增連結「規格書」"))).toEqual({ label: "連結", tone: "NEUTRAL", message: "新增連結「規格書」" });
    expect(describeEvent(line("TODO", "完成待辦事項:「驗收」"))).toEqual({ label: "待辦事項", tone: "NEUTRAL", message: "完成待辦事項:「驗收」" });
  });

  it("管理者代操作的註記不佔格子裡的位置", () => {
    expect(describeEvent(line("STATUS", "「Status」已更新:Planned → Completed〔管理者以「王小明」的身分操作〕")).message).toBe(
      "「Status」:Planned → Completed"
    );
  });
});

describe("describeRiskEvent", () => {
  it("建立風險 / 議題、Mantis 同步建立:新增", () => {
    expect(describeRiskEvent("建立風險「電池交期太長」(負責人:SY Chen)")).toMatchObject({ label: "新增", tone: "CREATED" });
    expect(describeRiskEvent("從 Mantis 同步建立問題 #591「車體重量」(處理中),指派給 Shuyi Lin")).toMatchObject({ label: "新增", tone: "CREATED" });
  });

  it("指派給誰、取消指派、換負責人或審核人:指派", () => {
    expect(describeRiskEvent("Mantis #591「車體重量」指派給 Shuyi Lin(原負責人:Tony Chia)").label).toBe("指派");
    expect(describeRiskEvent("Mantis #591「車體重量」取消指派(原負責人:Tony Chia)").tone).toBe("ASSIGNED");
    expect(describeRiskEvent("修改「電池交期」:負責人 A → B;機率 3 → 4").label).toBe("指派");
    expect(describeRiskEvent("修改「電池交期」:審核人 + SY Chen").tone).toBe("ASSIGNED");
  });

  it("其他(改機率、狀態、申請結案):修改;管理者代操作的註記不顯示", () => {
    expect(describeRiskEvent("修改「電池交期」:機率 3 → 4")).toMatchObject({ label: "修改", tone: "UPDATED" });
    expect(describeRiskEvent("Mantis #591「車體重量」狀態:未處理 → 處理中").label).toBe("修改");
    expect(describeRiskEvent("申請結案〔管理者以「王小明」的身分操作〕").message).toBe("申請結案");
  });
});

describe("pickStatusTimes", () => {
  const rows = [
    { statusKind: "done", at: "2026-10-13T02:00:00.000Z", by: "Amy" },
    { statusKind: "other", at: "2026-10-12T09:00:00.000Z", by: "Amy" },
    { statusKind: "inProgress", at: "2026-10-12T03:00:00.000Z", by: "Pat" },
    { statusKind: "inProgress", at: "2026-10-10T03:00:00.000Z", by: "Pat" },
  ];

  it("進行中:最近一次切成進行中的時間與人;完成:現在是完成就有", () => {
    expect(pickStatusTimes(rows, true)).toEqual({
      started: { at: "2026-10-12T03:00:00.000Z", by: "Pat" },
      completed: { at: "2026-10-13T02:00:00.000Z", by: "Amy" },
      wasCompleted: null,
    });
  });

  it("現在已經不是完成:完成時間清掉,最近一次完成的時間放在 wasCompleted", () => {
    const r = pickStatusTimes(rows, false);
    expect(r.completed).toBeNull();
    expect(r.wasCompleted).toEqual({ at: "2026-10-13T02:00:00.000Z", by: "Amy" });
  });

  it("沒有切換紀錄:都是 null", () => {
    expect(pickStatusTimes([], true)).toEqual({ started: null, completed: null, wasCompleted: null });
    expect(pickStatusTimes([{ statusKind: "other", at: "x", by: null }], false)).toEqual({ started: null, completed: null, wasCompleted: null });
  });
});

describe("formatEventDateTime", () => {
  it("台灣時間,含年份", () => {
    expect(formatEventDateTime("2026-10-12T01:12:57.000Z")).toBe("2026/10/12 09:12");
  });

  it("跨日、跨年:UTC 的晚上是台灣的隔天", () => {
    expect(formatEventDateTime(new Date("2026-12-31T17:05:00.000Z"))).toBe("2027/1/1 01:05");
  });
});
