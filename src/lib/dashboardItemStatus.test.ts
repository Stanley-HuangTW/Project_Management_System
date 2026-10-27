import { describe, expect, it } from "vitest";
import type { ColumnData, ItemData } from "@/types/board";
import { resolveItemStatusOption } from "./dashboard";

/** 甘特圖名稱欄的狀態標籤:項目在 Status 欄選了哪個選項就顯示哪個。只造這支函式用得到的欄位。 */
const STATUS = "c_status";

const column = {
  id: STATUS,
  name: "Status",
  type: "STATUS",
  options: {
    statuses: [
      { id: "plan", label: "Planned", color: "#c4c4c4" },
      { id: "doing", label: "In Progress", color: "#fdab3d" },
      { id: "done", label: "Completed", color: "#00c875" },
    ],
  },
} as unknown as ColumnData;

const itemWith = (value: unknown) =>
  ({ id: "i1", cellValues: value === undefined ? [] : [{ columnId: STATUS, value }] }) as unknown as ItemData;

describe("resolveItemStatusOption", () => {
  it("回傳項目選的選項(標籤與顏色)", () => {
    expect(resolveItemStatusOption(itemWith("doing"), column)).toEqual({
      id: "doing",
      label: "In Progress",
      color: "#fdab3d",
    });
  });

  it("沒選狀態、選項已被刪掉、看板沒有 Status 欄:都是 null", () => {
    expect(resolveItemStatusOption(itemWith(undefined), column)).toBeNull();
    expect(resolveItemStatusOption(itemWith(null), column)).toBeNull();
    expect(resolveItemStatusOption(itemWith("gone"), column)).toBeNull();
    expect(resolveItemStatusOption(itemWith("doing"), null)).toBeNull();
  });
});
