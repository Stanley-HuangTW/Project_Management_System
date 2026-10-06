import { describe, expect, it } from "vitest";
import { filterOptions } from "./searchOptions";

const options = [
  { label: "AMR BOX 專案 / POC-3 費用(NRE/BOM)" },
  { label: "AMR BOX 專案 / ID Concept" },
  { label: "M3專案 / POC-3 費用" },
  { label: "Eamon Chu", hint: "EE" },
];

describe("filterOptions", () => {
  it("沒有關鍵字就全部列出", () => {
    expect(filterOptions(options, "")).toHaveLength(4);
    expect(filterOptions(options, "   ")).toHaveLength(4);
  });

  it("不分大小寫、只要包含", () => {
    expect(filterOptions(options, "eamon").map((o) => o.label)).toEqual(["Eamon Chu"]);
    expect(filterOptions(options, "EAM")).toHaveLength(1);
  });

  it("空白隔開的每個關鍵字都要符合,不必連在一起或照順序", () => {
    expect(filterOptions(options, "amr poc-3").map((o) => o.label)).toEqual(["AMR BOX 專案 / POC-3 費用(NRE/BOM)"]);
    expect(filterOptions(options, "poc-3 amr")).toHaveLength(1);
    expect(filterOptions(options, "poc-3")).toHaveLength(2);
  });

  it("補充說明也能搜", () => {
    expect(filterOptions(options, "ee").map((o) => o.label)).toEqual(["Eamon Chu"]);
  });

  it("找不到就是空的", () => {
    expect(filterOptions(options, "zzz")).toEqual([]);
  });
});
