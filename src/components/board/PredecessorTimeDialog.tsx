"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { DateChangeHint } from "@/components/ui/DateChangeHint";
import { previewDragCascade } from "@/lib/actions/predecessorSchedule";
import { setItemBarRange } from "@/lib/actions/ganttResize";
import { describeAncestorWarnings, describeCascade, describeConflicts } from "@/lib/cascadeText";
import { actionErrorMessage } from "@/lib/userError";
import { withWeekday } from "@/lib/weekdayLabel";

const fieldClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500";

/**
 * 「相關項目」前置那一列的「調整時間」:直接改前置任務的開始日、結束日。
 *
 * 前置一動,本項目(以及更後面的項目)的時間會跟著排,所以套用之前先跳出確認畫面,
 * 寫清楚前置的時間、「本工作項」因前置調整後的原時間與新時間,以及其他一起連動的項目。
 */
export function PredecessorTimeButton({
  boardId,
  itemId,
  itemName,
  predecessor,
}: {
  boardId: string;
  /** 本工作項(這張卡片的項目):確認畫面要單獨列出它的時間變化。 */
  itemId: string;
  itemName: string;
  predecessor: { itemId: string; name: string; wbsCode: string; start: string; end: string };
}) {
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(predecessor.start);
  const [end, setEnd] = useState(predecessor.end);
  const [busy, setBusy] = useState(false);
  const predLabel = `${predecessor.wbsCode} ${predecessor.name}`.trim();
  const unchanged = start === predecessor.start && end === predecessor.end;

  function openDialog() {
    setStart(predecessor.start);
    setEnd(predecessor.end);
    setOpen(true);
  }

  async function submit() {
    if (!start || !end) {
      await notify("請填開始日與結束日。", { title: "無法調整" });
      return;
    }
    if (end < start) {
      await notify("結束日不能早於開始日。", { title: "無法調整" });
      return;
    }
    setBusy(true);
    try {
      let cascaded: Awaited<ReturnType<typeof previewDragCascade>>["cascaded"] = [];
      let conflicts: Awaited<ReturnType<typeof previewDragCascade>>["conflicts"] = [];
      let ancestorWarnings: string[] = [];
      try {
        ({ cascaded, conflicts, ancestorWarnings } = await previewDragCascade(boardId, predecessor.itemId, start, end));
      } catch {
        // 預覽失敗不擋調整,只是少了連動清單;真正能不能調整由套用時的檢查決定。
      }
      const own = cascaded.find((c) => c.itemId === itemId);
      const others = cascaded.filter((c) => c.itemId !== itemId);
      const lines = [
        `前置「${predLabel}」的時間:`,
        `　原時間 ${predecessor.start}~${predecessor.end}`,
        `　調整後 ${start}~${end}`,
        "",
        own
          ? `因前置調整,本工作項「${itemName}」的時間範圍:`
          : `本工作項「${itemName}」的時間不會因這次調整而改變。`,
        ...(own ? [`　原時間 ${own.oldStart}~${own.oldEnd}`, `　調整後 ${own.newStart}~${own.newEnd}`] : []),
        ...describeCascade(others),
        ...describeConflicts(conflicts),
        ...describeAncestorWarnings(ancestorWarnings),
        "",
        "確定要套用這個時程調整嗎?",
      ];
      if (!(await confirm(lines.join("\n"), { title: "調整前置任務的時間" }))) return;
      await setItemBarRange(boardId, predecessor.itemId, start, end);
      setOpen(false);
      router.refresh();
    } catch (err) {
      await notify(actionErrorMessage(err, "調整失敗"), { title: "無法調整" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-related-adjust={predecessor.itemId}
        onClick={openDialog}
        title="調整這個前置任務的時間(套用前會顯示本工作項的時間變化)"
        className="ml-1 inline-flex items-center gap-0.5 align-middle text-xs font-normal text-blue-600 hover:underline dark:text-blue-400"
      >
        <Pencil size={11} /> 調整時間
      </button>
      <Modal open={open} onOpenChange={setOpen} title="調整前置任務的時間">
        <div className="space-y-3 text-left">
          <p className="text-sm text-neutral-700 dark:text-neutral-200">
            前置:<span className="font-medium">{predLabel}</span>
            <br />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              它的時間一調整,「{itemName}」會依 Pred / Link 跟著重排;按「套用」會先顯示它的原時間與調整後時間,確認後才存。
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">開始日</span>
              <DateChangeHint saved={predecessor.start} current={start} />
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={fieldClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-neutral-500 dark:text-neutral-400">結束日</span>
              <DateChangeHint saved={predecessor.end} current={end} />
              <input type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} className={fieldClass} />
            </label>
          </div>
          {start && end && (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {withWeekday(start)} ~ {withWeekday(end)}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              data-related-adjust-submit
              disabled={busy || unchanged}
              onClick={() => void submit()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              套用
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
