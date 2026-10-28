import { describe, expect, it } from "vitest";
import { TODO_NOTE_MAX, noteForLog, normalizeTodoNote } from "./todoNote";

describe("normalizeTodoNote", () => {
  it("trims the note", () => {
    expect(normalizeTodoNote("  已寄出報價單  ")).toEqual({ note: "已寄出報價單" });
  });

  it("treats empty / whitespace-only / null as no note", () => {
    expect(normalizeTodoNote("")).toEqual({ note: null });
    expect(normalizeTodoNote("   \n ")).toEqual({ note: null });
    expect(normalizeTodoNote(null)).toEqual({ note: null });
  });

  it("keeps line breaks inside the note", () => {
    expect(normalizeTodoNote("第一行\n第二行")).toEqual({ note: "第一行\n第二行" });
  });

  it("accepts exactly the limit and rejects one over", () => {
    expect(normalizeTodoNote("a".repeat(TODO_NOTE_MAX))).toEqual({ note: "a".repeat(TODO_NOTE_MAX) });
    expect(normalizeTodoNote("a".repeat(TODO_NOTE_MAX + 1))).toHaveProperty("error");
  });
});

describe("noteForLog", () => {
  it("shows a cleared note", () => {
    expect(noteForLog(null)).toBe("(清空)");
  });

  it("truncates a long note", () => {
    expect(noteForLog("a".repeat(100))).toBe(`${"a".repeat(80)}…`);
    expect(noteForLog("短備註")).toBe("短備註");
  });
});
