import { describe, expect, it } from "vitest";
import { summaryStatusTarget } from "./summaryStatus";

const options = {
  statuses: [
    { id: "planned", label: "Planned", color: "#999" },
    { id: "inprog", label: "In Progress", color: "#a25ddc" },
    { id: "done", label: "Completed", color: "#00c875" },
    { id: "hold", label: "On Hold", color: "#fdab3d" },
  ],
};
const base = { columnOptions: options, doneOptionIds: [] as string[], pausedOptionIds: [] as string[] };

describe("summaryStatusTarget:子項目變動時上層的狀態", () => {
  it("子項目切成進行中,上層還是 Planned → 切成進行中", () => {
    expect(summaryStatusTarget({ ...base, childValue: "inprog", parentValue: "planned" })).toEqual({ optionId: "inprog", label: "In Progress" });
  });
  it("子項目切成完成,上層 Planned → 也只切成進行中(不是完成)", () => {
    expect(summaryStatusTarget({ ...base, childValue: "done", parentValue: "planned" })?.optionId).toBe("inprog");
  });
  it("上層沒選狀態 → 切成進行中", () => {
    expect(summaryStatusTarget({ ...base, childValue: "inprog", parentValue: null })?.optionId).toBe("inprog");
  });
  it("子項目只是切成 Planned 或別的 → 不動", () => {
    expect(summaryStatusTarget({ ...base, childValue: "planned", parentValue: "planned" })).toBeNull();
    expect(summaryStatusTarget({ ...base, childValue: "hold", parentValue: "planned" })).toBeNull();
  });
  it("上層已經是進行中或完成 → 不動(不替人重新打開已完成的)", () => {
    expect(summaryStatusTarget({ ...base, childValue: "inprog", parentValue: "inprog" })).toBeNull();
    expect(summaryStatusTarget({ ...base, childValue: "inprog", parentValue: "done" })).toBeNull();
  });
  it("上層被擱置(On Hold / 報表設定的暫停)→ 不動", () => {
    expect(summaryStatusTarget({ ...base, childValue: "inprog", parentValue: "hold" })).toBeNull();
    expect(summaryStatusTarget({ ...base, pausedOptionIds: ["planned"], childValue: "inprog", parentValue: "planned" })).toBeNull();
  });
  it("這個狀態欄沒有進行中的選項 → null", () => {
    const only = { statuses: [{ id: "a", label: "Todo", color: "#999" }, { id: "d", label: "Done", color: "#0a0" }] };
    expect(summaryStatusTarget({ ...base, columnOptions: only, childValue: "d", parentValue: "a" })).toBeNull();
  });
});
