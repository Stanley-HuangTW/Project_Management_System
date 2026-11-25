import { getStatusOptions } from "@/types/column";
import { classifyStatusOption } from "@/lib/itemEvents";

const PAUSED_LABEL = /^(pending|on hold|paused|暫停)$/i;

/**
 * 子項目切成進行中或完成時,上層(摘要)項目的狀態要不要跟著變、變成什麼。
 * 回傳要改成的「進行中」選項;不用改就回 null。
 *
 * 只有上層還沒開始(例如 Planned、沒選)才改:已經是進行中、已經完成(不替人重新打開)、
 * 被擱置(暫停 / Pending / On Hold)的都不動。子項目是完成也只把上層切成進行中 ——
 * 其他子項目還沒做完,上層不會因為一個子項目完成就跟著完成。
 */
export function summaryStatusTarget(input: {
  columnOptions: unknown;
  doneOptionIds: string[];
  pausedOptionIds: string[];
  childValue: unknown;
  parentValue: unknown;
}): { optionId: string; label: string } | null {
  const options = getStatusOptions(input.columnOptions);
  const kindOf = (value: unknown) => {
    const option = typeof value === "string" ? options.find((o) => o.id === value) : undefined;
    return option ? classifyStatusOption(option, input.doneOptionIds) : "other";
  };
  const childKind = kindOf(input.childValue);
  if (childKind !== "inProgress" && childKind !== "done") return null;

  const parentKind = kindOf(input.parentValue);
  if (parentKind === "inProgress" || parentKind === "done") return null;
  if (typeof input.parentValue === "string") {
    const parentOption = options.find((o) => o.id === input.parentValue);
    if (input.pausedOptionIds.includes(input.parentValue) || (parentOption && PAUSED_LABEL.test(parentOption.label.trim()))) return null;
  }

  const target = options.find((o) => classifyStatusOption(o, input.doneOptionIds) === "inProgress");
  return target ? { optionId: target.id, label: target.label } : null;
}
