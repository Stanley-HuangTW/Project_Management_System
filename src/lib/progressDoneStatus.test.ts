import { describe, expect, it } from "vitest";
import { doneStatusTarget } from "./progressDoneStatus";

const status = (id: string, name: string, statuses: { id: string; label: string; color: string }[]) => ({
  id,
  type: "STATUS",
  name,
  options: { statuses },
});
const OPTS = [
  { id: "planned", label: "Planned", color: "#aaa" },
  { id: "inprog", label: "In Progress", color: "#0a0" },
  { id: "c1", label: "Completed", color: "#00f" },
];

describe("doneStatusTarget", () => {
  it("報表設定有對應完成的選項,就用它", () => {
    const col = status("s1", "Status", OPTS);
    expect(doneStatusTarget([col], "s1", ["c1"])).toEqual({ columnId: "s1", optionId: "c1", doneOptionIds: ["c1"] });
  });
  it("沒設定報表:用名稱是 Completed / Done / 完成 的選項", () => {
    const col = status("s1", "Status", OPTS);
    expect(doneStatusTarget([col], null, [])?.optionId).toBe("c1");
  });
  it("預設的 done 選項(id 是 done)也算", () => {
    const col = status("s1", "Status", [{ id: "done", label: "已結束", color: "#0f0" }, ...OPTS.slice(0, 2)]);
    expect(doneStatusTarget([col], null, [])?.optionId).toBe("done");
  });
  it("多個狀態欄:報表設定的那個優先,其次叫 Status 的", () => {
    const a = status("a", "Phase", OPTS);
    const b = status("b", "Status", OPTS);
    expect(doneStatusTarget([a, b], null, [])?.columnId).toBe("b");
    expect(doneStatusTarget([a, b], "a", ["c1"])?.columnId).toBe("a");
  });
  it("找不到完成選項、或沒有狀態欄:null(不亂猜)", () => {
    expect(doneStatusTarget([status("s", "Status", OPTS.slice(0, 2))], null, [])).toBeNull();
    expect(doneStatusTarget([{ id: "n", type: "NUMBER", name: "x", options: {} }], null, [])).toBeNull();
  });
});
