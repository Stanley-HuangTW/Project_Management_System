import { describe, expect, it } from "vitest";
import { matchLocalPerson, matchMantisPerson, type LocalPerson } from "./mantisPeople";

const locals: LocalPerson[] = [
  { id: "u-jason", name: "Jason Huang", email: "jason.huang@ur-srobot.com" },
  { id: "u-mei", name: "陳美玲", email: "mei.chen@ur-srobot.com" },
  { id: "u-li", name: "李小明", email: "li.sw@ur-srobot.com" },
];

describe("matchLocalPerson: Mantis handler → local person", () => {
  it("matches by email when Mantis sends one, ignoring case", () => {
    expect(matchLocalPerson({ id: 3, name: "x", email: "LI.SW@ur-srobot.com" }, locals)).toEqual({ userId: "u-li", how: "email" });
  });

  it("matches by name when Mantis sends no email — the Jason_Huang case", () => {
    expect(matchLocalPerson({ id: 12, name: "Jason_Huang" }, locals)).toEqual({ userId: "u-jason", how: "name" });
    expect(matchLocalPerson({ id: 12, name: "jason.huang" }, locals)).toEqual({ userId: "u-jason", how: "name" });
    expect(matchLocalPerson({ id: 12, name: "JASON HUANG" }, locals)).toEqual({ userId: "u-jason", how: "name" });
  });

  it("matches the Mantis real name or the email account against the local name or account", () => {
    expect(matchLocalPerson({ id: 4, name: "chen.ee", realName: "陳美玲" }, locals)).toEqual({ userId: "u-mei", how: "name" });
    expect(matchLocalPerson({ id: 5, name: "mei_chen" }, locals)).toEqual({ userId: "u-mei", how: "name" });
    expect(matchLocalPerson({ id: 6, name: "x", email: "li.sw@other.com" }, locals)).toEqual({ userId: "u-li", how: "name" });
  });

  it("prefers a hand-made mapping over everything else", () => {
    const out = matchLocalPerson({ id: 12, name: "Jason_Huang", email: "jason.huang@ur-srobot.com" }, locals, { "u-li": 12 });
    expect(out).toEqual({ userId: "u-li", how: "manual" });
  });

  it("prefers email over name", () => {
    const out = matchLocalPerson({ id: 7, name: "李小明", email: "jason.huang@ur-srobot.com" }, locals);
    expect(out).toEqual({ userId: "u-jason", how: "email" });
  });

  it("does not guess when two people could be meant", () => {
    const twins = [...locals, { id: "u-jason2", name: "Jason Huang", email: "jhuang2@ur-srobot.com" }];
    expect(matchLocalPerson({ id: 12, name: "Jason_Huang" }, twins)).toBeNull();
    // 手動指定仍然可以解開
    expect(matchLocalPerson({ id: 12, name: "Jason_Huang" }, twins, { "u-jason2": 12 })).toEqual({ userId: "u-jason2", how: "manual" });
  });

  it("returns null when nobody fits or Mantis sent nothing to go on", () => {
    expect(matchLocalPerson({ id: 9, name: "vendor", realName: "外部廠商" }, locals)).toBeNull();
    expect(matchLocalPerson({}, locals)).toBeNull();
    expect(matchLocalPerson({ id: 1, name: "  ", realName: "", email: "" }, locals)).toBeNull();
  });

  it("ignores a hand-made mapping for a person who no longer exists", () => {
    expect(matchLocalPerson({ id: 12, name: "Jason_Huang" }, locals, { "u-gone": 12 })).toEqual({ userId: "u-jason", how: "name" });
  });
});

describe("matchMantisPerson: local person → Mantis user (for writing the handler)", () => {
  const mantis = [
    { id: 12, name: "Jason_Huang", realName: "", email: "" },
    { id: 4, name: "chen.ee", realName: "陳美玲", email: "" },
    { id: 3, name: "li.sw", realName: "李小明", email: "li.sw@ur-srobot.com" },
  ];

  it("uses the hand-made mapping first, even for a Mantis user not collected yet", () => {
    expect(matchMantisPerson(locals[2], mantis, { "u-li": 99 })).toEqual({ user: { id: 99 }, how: "manual" });
    expect(matchMantisPerson(locals[2], mantis, { "u-li": 4 })).toEqual({ user: mantis[1], how: "manual" });
  });

  it("then email, then name", () => {
    expect(matchMantisPerson(locals[2], mantis)).toEqual({ user: mantis[2], how: "email" });
    expect(matchMantisPerson(locals[0], mantis)).toEqual({ user: mantis[0], how: "name" });
    expect(matchMantisPerson(locals[1], mantis)).toEqual({ user: mantis[1], how: "name" });
  });

  it("does not guess between two Mantis users, and says nothing when there is no match", () => {
    const dup = [...mantis, { id: 13, name: "jason.huang", realName: "", email: "" }];
    expect(matchMantisPerson(locals[0], dup)).toBeNull();
    expect(matchMantisPerson({ id: "u-x", name: "吳志豪", email: "wu@x.com" }, mantis)).toBeNull();
  });
});
