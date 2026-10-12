import { describe, expect, it } from "vitest";
import { classifyStatusOption, completedAtOf, describeEvent, eventTargetTab, formatEventTime, taipeiDateOf, type ItemEventKind } from "./itemEvents";

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
