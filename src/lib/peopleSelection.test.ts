import { describe, expect, it } from "vitest";
import { departmentState, selectedPeople, toggleDepartment, togglePerson } from "./peopleSelection";

const people = [
  { id: "a", discipline: "SW" },
  { id: "b", discipline: "SW" },
  { id: "c", discipline: "EE" },
  { id: "d", discipline: "ME" },
  { id: "e", discipline: null },
];

describe("togglePerson", () => {
  it("從全部人取消一個,變成其餘的人", () => {
    expect(togglePerson(null, people, "c")).toEqual(["a", "b", "d", "e"]);
  });

  it("補回最後一個就收回「全部人」(null)", () => {
    expect(togglePerson(["a", "b", "d", "e"], people, "c")).toBeNull();
  });
});

describe("toggleDepartment", () => {
  it("目前是全部人時,按部門就只留下這個部門", () => {
    expect(toggleDepartment(null, people, "SW")).toEqual(["a", "b"]);
  });

  it("可以一個部門一個部門加上去", () => {
    expect(toggleDepartment(["a", "b"], people, "EE")).toEqual(["a", "b", "c"]);
  });

  it("部門已經全選時,再按就取消那個部門", () => {
    expect(toggleDepartment(["a", "b", "c"], people, "SW")).toEqual(["c"]);
  });

  it("部門只選了一部分時,按一下補齊", () => {
    expect(toggleDepartment(["a"], people, "SW")).toEqual(["a", "b"]);
  });

  it("沒有成員的部門不動", () => {
    expect(toggleDepartment(["a"], people, "QA")).toEqual(["a"]);
  });

  it("加到跟全部一樣就收成 null", () => {
    expect(toggleDepartment(["a", "b", "c", "d"], people, "SW")).toEqual(["c", "d"]);
    expect(toggleDepartment(["c", "d", "e"], people, "SW")).toBeNull();
  });
});

describe("departmentState", () => {
  it("全部 / 部分 / 沒有", () => {
    expect(departmentState(null, people, "SW")).toBe("all");
    expect(departmentState(["a"], people, "SW")).toBe("some");
    expect(departmentState(["c"], people, "SW")).toBe("none");
    expect(departmentState(null, people, "QA")).toBe("none");
  });
});

describe("selectedPeople", () => {
  it("null 是全部人,否則只留被選的(照名單順序)", () => {
    expect(selectedPeople(null, people)).toHaveLength(5);
    expect(selectedPeople(["d", "a"], people).map((p) => p.id)).toEqual(["a", "d"]);
  });
});
