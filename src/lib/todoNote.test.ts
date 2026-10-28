import { describe, expect, it } from "vitest";
import { TODO_NOTE_MAX, TODO_TEXT_MAX, noteForLog, normalizeTodoNote, normalizeTodoText } from "./todoNote";

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

describe("normalizeTodoText", () => {
  it("trims the name", () => {
    expect(normalizeTodoText("  訂治具  ")).toEqual({ text: "訂治具" });
  });

  it("folds line breaks into a single space", () => {
    expect(normalizeTodoText("第一行\n  第二行\r\n第三行")).toEqual({ text: "第一行 第二行 第三行" });
  });

  it("rejects an empty name", () => {
    expect(normalizeTodoText("")).toHaveProperty("error");
    expect(normalizeTodoText("  \n ")).toHaveProperty("error");
  });

  it("accepts exactly the limit and rejects one over", () => {
    expect(normalizeTodoText("a".repeat(TODO_TEXT_MAX))).toEqual({ text: "a".repeat(TODO_TEXT_MAX) });
    expect(normalizeTodoText("a".repeat(TODO_TEXT_MAX + 1))).toHaveProperty("error");
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
