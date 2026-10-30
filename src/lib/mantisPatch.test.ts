import { describe, expect, it } from "vitest";
import {
  buildDescription,
  descriptionWasTruncated,
  mapMantisIssue,
  resolveLocalStatus,
  splitMantisDescription,
  type MantisIssue,
  type MantisUser,
} from "./mantis";
import { buildMantisPatch, resolveMantisHandler } from "./mantisPatch";
import { defaultMapping, parseMapping, type MantisMapping } from "./mantisMapping";

const issue: MantisIssue = {
  id: 12,
  summary: "藍牙斷線",
  description: "重現步驟:略。",
  status: { id: 50, name: "assigned" },
  severity: { id: 50, name: "minor" },
  priority: { id: 30, name: "normal" },
  handler: { id: 4, name: "chen.ee", real_name: "陳美玲", email: "chen.ee@example.com" },
  due_date: "2026-11-10T00:00:00+08:00",
  updated_at: "2026-10-20T10:00:00+08:00",
};
const users: MantisUser[] = [
  { id: 3, name: "li.sw", realName: "李小明", email: "li.sw@example.com" },
  { id: 4, name: "chen.ee", realName: "陳美玲", email: "chen.ee@example.com" },
];
const enabled = (fields: MantisMapping["writeBack"]["fields"] = ["status", "handler", "severity", "content"]): MantisMapping => ({
  ...defaultMapping(),
  writeBack: { enabled: true, fields },
});
const ctx = (mapping = enabled(), i = issue) => ({ mapping, issue: i, mantisUsers: users });
const li = { id: "u-li", name: "李小明", email: "Li.SW@example.com" };

describe("buildMantisPatch: nothing to send", () => {
  it("is empty when nothing changed, whatever is enabled", () => {
    const sameAsMantis = {
      status: mapMantisIssue(issue, "https://m.test").status,
      title: "藍牙斷線",
      description: "重現步驟:略。",
      dueDate: "2026-11-10",
      impact: mapMantisIssue(issue, "https://m.test").impact,
      priorityId: 30,
    };
    expect(buildMantisPatch(sameAsMantis, ctx())).toEqual({ payload: {}, summary: [] });
    expect(buildMantisPatch({}, ctx())).toEqual({ payload: {}, summary: [] });
  });

  it("does not touch Mantis for a status it does not write (待審核 by default)", () => {
    expect(buildMantisPatch({ status: "PENDING_REVIEW" }, ctx())).toEqual({ payload: {}, summary: [] });
  });

  it("does not rewrite a status Mantis already counts as the same thing (feedback is 未處理 too)", () => {
    const feedback = { ...issue, status: { id: 20, name: "feedback" } };
    expect(buildMantisPatch({ status: "OPEN" }, ctx(enabled(), feedback))).toEqual({ payload: {}, summary: [] });
  });
});

describe("buildMantisPatch: status", () => {
  it("writes the mapped Mantis status, with the resolution when it is resolved / closed", () => {
    const patch = buildMantisPatch({ status: "CLOSED" }, ctx());
    expect(patch).toMatchObject({ payload: { status: { id: 80, name: "resolved" }, resolution: { id: 20, name: "fixed" } } });
  });

  it("writes in-progress and open without a resolution", () => {
    const open = { ...issue, status: { id: 10, name: "new" } };
    const patch = buildMantisPatch({ status: "MITIGATING" }, ctx(enabled(), open)) as { payload: Record<string, unknown> };
    expect(patch.payload).toEqual({ status: { id: 50, name: "assigned" } });
  });

  it("follows the configured mapping, and leaves out the resolution when none is configured", () => {
    const mapping = parseMapping({ ...enabled(), statusOut: { CLOSED: { id: 90, name: "closed" } }, resolutionOut: null });
    const patch = buildMantisPatch({ status: "CLOSED" }, ctx(mapping)) as { payload: Record<string, unknown> };
    expect(patch.payload).toEqual({ status: { id: 90, name: "closed" } });
  });

  it("refuses when status write-back is not enabled", () => {
    expect(buildMantisPatch({ status: "CLOSED" }, ctx(enabled(["content"])))).toEqual({ error: expect.stringContaining("狀態") });
  });
});

describe("buildMantisPatch: handler", () => {
  it("matches the person to a Mantis user by email, ignoring case", () => {
    expect(buildMantisPatch({ owner: li }, ctx())).toMatchObject({ payload: { handler: { id: 3 } } });
  });

  it("prefers the hand-made mapping over the email", () => {
    const mapping = { ...enabled(), handlerOverrides: { "u-li": 4 } };
    const patch = buildMantisPatch({ owner: li }, ctx(mapping)) as { payload: Record<string, unknown> };
    expect(patch.payload).toEqual({});
  });

  it("says who it could not match, and how to fix it", () => {
    const error = buildMantisPatch({ owner: { id: "u-x", name: "吳志豪", email: "wu@example.com" } }, ctx());
    expect(error).toEqual({ error: expect.stringContaining("「吳志豪」") });
    expect(error).toEqual({ error: expect.stringContaining("處理人對應") });
  });

  it("cannot clear the handler through the API, but unassigning an unassigned issue is nothing", () => {
    expect(buildMantisPatch({ owner: null }, ctx())).toHaveProperty("error");
    const nobody = { ...issue, handler: undefined };
    expect(buildMantisPatch({ owner: null }, ctx(enabled(), nobody))).toEqual({ payload: {}, summary: [] });
  });

  it("refuses when handler write-back is not enabled", () => {
    expect(buildMantisPatch({ owner: li }, ctx(enabled(["status"])))).toEqual({ error: expect.stringContaining("處理人") });
  });

  it("resolveMantisHandler uses the email only when there is one", () => {
    expect(resolveMantisHandler({ id: "u", name: "某人", email: "" }, defaultMapping(), users)).toHaveProperty("error");
  });
});

describe("buildMantisPatch: severity, priority, content", () => {
  it("writes a new impact as the mapped severity, and skips it when Mantis already reads as that impact", () => {
    expect(buildMantisPatch({ impact: 5 }, ctx())).toMatchObject({ payload: { severity: { id: 70, name: "crash" } } });
    expect(buildMantisPatch({ impact: 3 }, ctx())).toEqual({ payload: {}, summary: [] });
  });

  it("writes a priority change, naming it from the enum list", () => {
    const patch = buildMantisPatch({ priorityId: 50 }, ctx()) as { payload: Record<string, unknown> };
    expect(patch.payload).toEqual({ priority: { id: 50, name: "urgent" } });
  });

  it("writes the summary, description and due date, and only those that changed", () => {
    const patch = buildMantisPatch({ title: "藍牙斷線(已重現)", description: "重現步驟:略。", dueDate: "2026-11-20" }, ctx()) as {
      payload: Record<string, unknown>;
    };
    expect(patch.payload).toEqual({ summary: "藍牙斷線(已重現)", due_date: "2026-11-20" });
  });

  it("compares text after trimming and normalising line breaks", () => {
    expect(buildMantisPatch({ description: "  重現步驟:略。\r\n" }, ctx())).toEqual({ payload: {}, summary: [] });
  });

  it("refuses an empty or too-long summary, an empty description, and clearing the due date", () => {
    expect(buildMantisPatch({ title: "  " }, ctx())).toHaveProperty("error");
    expect(buildMantisPatch({ title: "字".repeat(129) }, ctx())).toHaveProperty("error");
    expect(buildMantisPatch({ description: "" }, ctx())).toHaveProperty("error");
    expect(buildMantisPatch({ dueDate: null }, ctx())).toHaveProperty("error");
  });

  it("refuses fields whose group is not enabled, and says which group", () => {
    expect(buildMantisPatch({ title: "新標題" }, ctx(enabled(["status"])))).toEqual({ error: expect.stringContaining("摘要、說明與到期日") });
    expect(buildMantisPatch({ impact: 5 }, ctx(enabled(["status"])))).toEqual({ error: expect.stringContaining("嚴重度與優先權") });
    expect(buildMantisPatch({ priorityId: 50 }, ctx(enabled(["status"])))).toHaveProperty("error");
  });

  it("combines everything into one request and one summary line per field", () => {
    const patch = buildMantisPatch({ status: "CLOSED", impact: 5, title: "新標題" }, ctx());
    expect(patch).toMatchObject({ payload: { status: { id: 80 }, severity: { id: 70 }, summary: "新標題" } });
    expect((patch as { summary: string[] }).summary).toHaveLength(3);
  });
});

describe("the description and the Mantis notes block", () => {
  const withNotes = buildDescription({
    id: 1,
    description: "原本的說明",
    notes: [{ text: "已重現", created_at: "2026-10-02T11:00:00+08:00", reporter: { real_name: "黃雅婷" } }],
  });

  it("splits what was stored back into the description and the notes", () => {
    const { description, notes } = splitMantisDescription(withNotes);
    expect(description).toBe("原本的說明");
    expect(notes).toContain("已重現");
    expect(notes.startsWith("── Mantis 備註(最近 1 則")).toBe(true);
  });

  it("leaves a description without notes alone, and copes with an empty one", () => {
    expect(splitMantisDescription("只有說明")).toEqual({ description: "只有說明", notes: "" });
    expect(splitMantisDescription("")).toEqual({ description: "", notes: "" });
  });

  it("handles a description that is only notes", () => {
    const only = buildDescription({ id: 1, notes: [{ text: "只有備註" }] });
    expect(splitMantisDescription(only).description).toBe("");
    expect(splitMantisDescription(only).notes).toContain("只有備註");
  });

  it("knows when the stored description was cut short", () => {
    const long = buildDescription({ id: 1, description: "字".repeat(7000) });
    expect(descriptionWasTruncated(long)).toBe(true);
    expect(descriptionWasTruncated(withNotes)).toBe(false);
    expect(descriptionWasTruncated("短")).toBe(false);
  });
});

describe("resolveLocalStatus keeps 待審核 until Mantis is closed", () => {
  it("lets Mantis decide when the row is not waiting for review", () => {
    expect(resolveLocalStatus("OPEN", "MITIGATING", 50, undefined)).toBe("MITIGATING");
    expect(resolveLocalStatus(undefined, "CLOSED", 90, undefined)).toBe("CLOSED");
    expect(resolveLocalStatus("CLOSED", "OPEN", 10, undefined)).toBe("OPEN");
  });

  it("does not let a sync turn 待審核 back into 處理中 / 未處理", () => {
    expect(resolveLocalStatus("PENDING_REVIEW", "MITIGATING", 50, undefined)).toBe("PENDING_REVIEW");
    expect(resolveLocalStatus("PENDING_REVIEW", "OPEN", 10, undefined)).toBe("PENDING_REVIEW");
  });

  it("closes it when Mantis was closed by someone else", () => {
    expect(resolveLocalStatus("PENDING_REVIEW", "CLOSED", 90, undefined)).toBe("CLOSED");
  });

  it("keeps 待審核 when Mantis sits at the very status that 待審核 is written as", () => {
    expect(resolveLocalStatus("PENDING_REVIEW", "CLOSED", 80, 80)).toBe("PENDING_REVIEW");
    expect(resolveLocalStatus("PENDING_REVIEW", "CLOSED", 90, 80)).toBe("CLOSED");
  });
});
