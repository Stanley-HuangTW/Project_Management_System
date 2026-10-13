import { describe, expect, it } from "vitest";
import {
  boardFilterSummary,
  decodeBoardCookie,
  encodeBoardCookie,
  parseBoardParam,
  resolveBoardFilter,
} from "./dashboardBoardFilter";

describe("parseBoardParam", () => {
  it("沒有 ?board=:null(用記住的);有但是空的:空清單(全部看板)", () => {
    expect(parseBoardParam(undefined)).toBeNull();
    expect(parseBoardParam("")).toEqual([]);
  });

  it("單一值、重複的參數、逗號隔開都收;去掉空白與重複", () => {
    expect(parseBoardParam("a")).toEqual(["a"]);
    expect(parseBoardParam(["a", "b"])).toEqual(["a", "b"]);
    expect(parseBoardParam("a, b,,a")).toEqual(["a", "b"]);
  });
});

describe("cookie", () => {
  it("寫進去再讀回來", () => {
    expect(decodeBoardCookie("u1", encodeBoardCookie("u1", ["b1", "b2"]))).toEqual(["b1", "b2"]);
  });

  it("沒選任何看板(全部):讀回來是空清單", () => {
    expect(decodeBoardCookie("u1", encodeBoardCookie("u1", []))).toEqual([]);
  });

  it("別人記的(換人登入)、沒有記、壞掉的值:都當作沒有記", () => {
    const raw = encodeBoardCookie("u1", ["b1"]);
    expect(decodeBoardCookie("u2", raw)).toEqual([]);
    expect(decodeBoardCookie("u1", undefined)).toEqual([]);
    expect(decodeBoardCookie("u1", "")).toEqual([]);
    expect(decodeBoardCookie("u1", "garbage-without-colon")).toEqual([]);
  });
});

describe("resolveBoardFilter", () => {
  const accessibleIds = ["b1", "b2", "b3"];

  it("網址沒指定:用記住的", () => {
    expect(resolveBoardFilter({ urlIds: null, savedIds: ["b2", "b3"], accessibleIds })).toEqual(["b2", "b3"]);
  });

  it("網址有指定:網址優先,不管記住的", () => {
    expect(resolveBoardFilter({ urlIds: ["b1"], savedIds: ["b2"], accessibleIds })).toEqual(["b1"]);
  });

  it("網址是空的(全部看板)也算指定:不會被記住的蓋掉", () => {
    expect(resolveBoardFilter({ urlIds: [], savedIds: ["b2"], accessibleIds })).toEqual([]);
  });

  it("記住的看板被刪了或看不到了:只留還看得到的;全部都不見了就是空(全部看板),不會變成空白儀表板", () => {
    expect(resolveBoardFilter({ urlIds: null, savedIds: ["b2", "gone"], accessibleIds })).toEqual(["b2"]);
    expect(resolveBoardFilter({ urlIds: null, savedIds: ["gone"], accessibleIds })).toEqual([]);
  });
});

describe("boardFilterSummary", () => {
  const boards = [
    { id: "b1", name: "P100" },
    { id: "b2", name: "B120" },
    { id: "b3", name: "M3" },
  ];

  it("沒選:全部看板;選一個:名字;選多個:個數", () => {
    expect(boardFilterSummary([], boards)).toBe("全部看板");
    expect(boardFilterSummary(["b2"], boards)).toBe("B120");
    expect(boardFilterSummary(["b1", "b3"], boards)).toBe("2 個看板");
  });

  it("選的看板已經不在清單裡:不算", () => {
    expect(boardFilterSummary(["gone"], boards)).toBe("全部看板");
  });
});
