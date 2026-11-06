"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, ChevronRight } from "lucide-react";
import { groupTasksByBoardAndGroup, weekIndexForDate, type MemberTask, type WeekColumn, type WorkloadThresholdSettings } from "@/lib/workload";
import { machineLoadColor, type ProtoUsageMachine } from "@/lib/protoUsage";
import { setItemProtoUnitPct } from "@/lib/actions/itemProtoUnits";
import { PercentInput } from "@/components/ui/PercentInput";
import { useDialogs } from "@/components/ui/DialogProvider";
import { actionErrorMessage } from "@/lib/userError";
import { createTextMeasurer } from "@/components/board/textMeasure";
import { autoFitCap, fitNameColumnWidth } from "@/lib/nameColumnFit";

/** 樣機欄的預設(也是自動調整時最窄的)寬度;之後可以拖欄位標題的右緣調整。 */
const DEFAULT_LABEL_WIDTH = 200;
const MIN_LABEL_WIDTH = 120;
const MAX_LABEL_WIDTH = 720;
/** 樣機那一列上名稱以外的寬度:左右 padding、展開箭頭、間距、右邊的工作項數量、邊線。 */
const MACHINE_LABEL_CHROME = 60;
const WEEK_WIDTH = 26;
const DAY_MS = 86_400_000;

type Colors = Pick<WorkloadThresholdSettings, "greenColor" | "redColor">;

/** 一個工作項在這台樣機上的長條(寬度 = 起訖週數);點一下可以調它佔用這台的百分比。 */
function UsageBar({
  task,
  machineId,
  weeks,
  colors,
  startIdx,
  endIdx,
  machineCountOfItem,
}: {
  task: MemberTask;
  machineId: string;
  weeks: WeekColumn[];
  colors: Colors;
  startIdx: number;
  endIdx: number;
  /** 這個工作項在這一區一共用到幾台樣機(超過一台才給「全部都改」的選項)。 */
  machineCountOfItem: number;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState(task.allocationPct);
  const [applyToAll, setApplyToAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasRange = !!(task.startDate && task.endDate && weeks.length > 0);

  async function save() {
    // 「全部都改」時,這一台的百分比沒變也要送——其他台可能還不是這個數字。
    if (pct === task.allocationPct && !applyToAll) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const result = await setItemProtoUnitPct(task.itemId, machineId, pct, applyToAll);
      if (result.error) {
        await notify(result.error, { title: "無法儲存使用百分比" });
        return;
      }
      setOpen(false);
      router.refresh();
      if (result.warning) await notify(result.warning, { title: "樣機使用時間重疊" });
    } catch (err) {
      await notify(actionErrorMessage(err, "儲存失敗"), { title: "無法儲存使用百分比" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setPct(task.allocationPct);
          setApplyToAll(false);
        }
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          data-proto-bar={task.itemId}
          title="點選調整這個工作項佔用這台樣機的百分比"
          className={`flex h-3.5 items-center justify-center overflow-hidden rounded-sm text-[9px] font-medium text-white hover:ring-1 hover:ring-blue-400 ${
            hasRange ? "absolute top-0.5" : "px-1.5"
          }`}
          style={{
            left: hasRange ? startIdx * WEEK_WIDTH : undefined,
            width: hasRange ? (endIdx - startIdx + 1) * WEEK_WIDTH : undefined,
            backgroundColor: machineLoadColor(task.allocationPct, colors),
          }}
        >
          {hasRange ? `${task.allocationPct}%` : `未排程・${task.allocationPct}%`}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 w-64 rounded-md border border-neutral-200 bg-white p-3 shadow-md dark:border-neutral-700 dark:bg-neutral-900"
        >
          <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100" title={task.itemName}>
            {task.itemName}
          </p>
          <label className="mt-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
            佔用這台的百分比
            <PercentInput
              value={pct}
              onChange={setPct}
              className="w-16 rounded-md border border-neutral-300 px-1.5 py-1 text-xs outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
            />
          </label>
          {machineCountOfItem > 1 && (
            <label className="mt-2 flex items-start gap-1.5 text-xs text-neutral-600 dark:text-neutral-300">
              <input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} className="mt-0.5 accent-blue-600" />
              這個工作項用到的 {machineCountOfItem} 台樣機都改成這個百分比
            </label>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={save}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "儲存中..." : "儲存"}
            </button>
            <Link
              href={`/boards/${task.boardId}?highlight=${task.itemId}`}
              className="ml-auto text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              開啟工作項
            </Link>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * 樣機使用時程:跟「成員工作量明細」同一個樣子——一台樣機一列,上面是每週的佔用,
 * 點開來是用它的每一個工作項的起訖長條與佔用百分比(預設 100%)。
 * 每週的顏色:有人在用綠色,同一天不只一個工作項在用(超過 100%)紅色。
 */
export function ProtoUsageSection({
  title,
  machines,
  idle,
  tasksByMachine,
  weeks,
  weeklyLoadByMachine,
  colors,
  showBoardName,
}: {
  title: string;
  machines: ProtoUsageMachine[];
  /** 這些看板上沒有工作項在用的樣機。 */
  idle: ProtoUsageMachine[];
  tasksByMachine: Record<string, MemberTask[]>;
  weeks: WeekColumn[];
  weeklyLoadByMachine: Record<string, number[]>;
  colors: Colors;
  /** 好幾個看板的樣機放在一起時,每一列前面標看板名稱。 */
  showBoardName: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [labelWidth, setLabelWidth] = useState(DEFAULT_LABEL_WIDTH);
  // 寬度量好了(或量不了)才捲到今天附近,不然欄一變寬,今天就不在中間了。
  const [labelReady, setLabelReady] = useState(false);
  const labelTouchedRef = useRef(false);
  // 每個工作項在這一區用到幾台樣機。
  const machinesPerItem = new Map<string, number>();
  for (const tasks of Object.values(tasksByMachine)) for (const t of tasks) machinesPerItem.set(t.itemId, (machinesPerItem.get(t.itemId) ?? 0) + 1);
  const timelineWidth = weeks.length * WEEK_WIDTH;
  const timelineOrigin = weeks[0]?.start ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayOffsetPx = timelineOrigin
    ? ((new Date(new Date().toISOString().slice(0, 10)).getTime() - timelineOrigin.getTime()) / DAY_MS / 7) * WEEK_WIDTH
    : null;

  // 樣機欄一開始就寬到看得到每一台的全名,照畫面上真正的字型量字,不是固定寬度。只做一次;使用者之後照樣可以拖。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 字型還沒載入完就量,量的是備用字型,中文字寬會差一截。
      try {
        await document.fonts?.ready;
      } catch {}
      const scroller = scrollRef.current;
      if (cancelled || !scroller) return;
      const measureText = createTextMeasurer(scroller.querySelector("[data-proto-machine] span") ?? scroller);
      if (measureText && !labelTouchedRef.current) {
        setLabelWidth(
          fitNameColumnWidth({
            items: machines.map((m) => ({ id: m.id, name: showBoardName ? `${m.boardName}・${m.label}` : m.label, parentId: null })),
            // 樣機名稱是 text-sm、font-medium。
            measure: (text) => measureText(text, 14, "500"),
            indentPerLevel: 0,
            chrome: MACHINE_LABEL_CHROME,
            min: DEFAULT_LABEL_WIDTH,
            max: autoFitCap(scroller.clientWidth || 1000, DEFAULT_LABEL_WIDTH),
          })
        );
      }
      setLabelReady(true);
    })();
    return () => {
      cancelled = true;
    };
    // 只在第一次畫出來時量一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!labelReady || !el || todayOffsetPx === null) return;
    el.scrollLeft = Math.max(0, labelWidth + todayOffsetPx - el.clientWidth / 2);
    // 只在樣機欄的寬度定下來之後,捲到今天附近一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labelReady]);

  function startLabelResize(e: React.PointerEvent) {
    e.preventDefault();
    labelTouchedRef.current = true;
    const startX = e.clientX;
    const startWidth = labelWidth;
    function onMove(ev: PointerEvent) {
      setLabelWidth(Math.min(MAX_LABEL_WIDTH, Math.max(MIN_LABEL_WIDTH, startWidth + (ev.clientX - startX))));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const resizeHandle = (
    <div
      data-proto-label-resize
      onPointerDown={startLabelResize}
      title="拖曳調整樣機欄的寬度"
      className="absolute right-0 top-0 z-30 h-full w-1.5 cursor-col-resize hover:bg-blue-400"
      style={{ touchAction: "none" }}
    />
  );

  const monthGroups: { label: string; count: number }[] = [];
  for (const week of weeks) {
    const last = monthGroups[monthGroups.length - 1];
    if (last && last.label === week.monthLabel) last.count += 1;
    else monthGroups.push({ label: week.monthLabel, count: 1 });
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section data-proto-usage>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-100">{title}</h2>
      </div>
      <div ref={scrollRef} className="max-h-[70vh] overflow-auto">
        <div className="relative" style={{ width: labelWidth + timelineWidth }}>
          {todayOffsetPx !== null && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-red-400"
              style={{ left: labelWidth + todayOffsetPx }}
              title="今天"
            />
          )}
          <div className="sticky top-0 z-10 mb-2 bg-white pb-2 dark:bg-neutral-900">
            <div className="rounded-md border border-neutral-200 dark:border-neutral-700">
              <div className="flex border-b border-neutral-100 bg-neutral-50 text-[10px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
                <div
                  style={{ width: labelWidth }}
                  className="sticky left-0 z-20 shrink-0 border-r border-neutral-100 bg-neutral-50 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  樣機
                  {resizeHandle}
                </div>
                <div className="flex">
                  {monthGroups.map((g, i) => (
                    <div
                      key={`${g.label}-${i}`}
                      style={{ width: g.count * WEEK_WIDTH }}
                      className="shrink-0 truncate border-r border-neutral-100 px-1 py-1 dark:border-neutral-700"
                    >
                      {g.label}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex bg-neutral-50 text-[9px] text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
                <div
                  style={{ width: labelWidth }}
                  className="sticky left-0 z-20 shrink-0 border-r border-neutral-100 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
                >
                  {resizeHandle}
                </div>
                <div className="flex">
                  {weeks.map((w, i) => (
                    <div
                      key={i}
                      style={{ width: WEEK_WIDTH }}
                      className={`shrink-0 truncate text-center ${w.isMonthStart ? "border-l border-neutral-300 dark:border-neutral-600" : ""}`}
                    >
                      {w.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            {machines.map((machine) => {
              const tasks = tasksByMachine[machine.id] ?? [];
              const weekly = weeklyLoadByMachine[machine.id] ?? [];
              const isOpen = expanded.has(machine.id);
              const text = showBoardName ? `${machine.boardName}・${machine.label}` : machine.label;
              return (
                <div
                  key={machine.id}
                  data-proto-machine={machine.id}
                  className="rounded-md border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <button
                    type="button"
                    onClick={() => toggle(machine.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
                  >
                    <div
                      style={{ width: labelWidth }}
                      className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-neutral-100 bg-white px-2 py-2 dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100" title={text}>
                        {text}
                      </span>
                      <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">{tasks.length}</span>
                    </div>
                    <div className="flex">
                      {weeks.map((w, i) => (
                        <div
                          key={i}
                          title={`${w.label}: ${weekly[i] ?? 0}%`}
                          className={w.isMonthStart ? "border-l border-neutral-200 dark:border-neutral-700" : ""}
                          style={{
                            width: WEEK_WIDTH,
                            height: 20,
                            backgroundColor: machineLoadColor(weekly[i] ?? 0, colors),
                            opacity: (weekly[i] ?? 0) > 0 ? 1 : 0.25,
                          }}
                        />
                      ))}
                    </div>
                  </button>

                  {isOpen && (
                    <div className="border-t border-neutral-100 bg-neutral-50/50 pb-1 dark:border-neutral-700 dark:bg-neutral-800/50">
                      {groupTasksByBoardAndGroup(tasks).flatMap((b) =>
                        b.groups.flatMap((g) => [
                          <div
                            key={`group-${b.boardId}-${g.groupId}`}
                            style={{ width: labelWidth }}
                            className="sticky left-0 z-10 truncate bg-neutral-50/95 px-2 pb-0.5 pt-1.5 text-[10px] text-neutral-400 dark:bg-neutral-800/95 dark:text-neutral-500"
                            title={g.groupName}
                          >
                            {g.groupName || "(未分組)"}
                          </div>,
                          ...g.rows.map((t) => {
                            const hasRange = !!(t.startDate && t.endDate);
                            const startIdx = hasRange ? weekIndexForDate(t.startDate!, weeks) : 0;
                            const endIdx = hasRange ? weekIndexForDate(t.endDate!, weeks) : 0;
                            return (
                              <div key={`${t.boardId}-${t.itemId}`} data-proto-task={t.itemId} className="flex items-center">
                                <div
                                  style={{ width: labelWidth }}
                                  className="sticky left-0 z-10 shrink-0 truncate border-r border-neutral-100 bg-white py-1 pl-6 pr-2 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400"
                                  title={t.itemName}
                                >
                                  <Link href={`/boards/${t.boardId}?highlight=${t.itemId}`} className="hover:text-blue-600">
                                    {t.wbsCode && <span className="mr-1.5 tabular-nums text-neutral-400 dark:text-neutral-500">{t.wbsCode}</span>}
                                    {t.itemName}
                                  </Link>
                                </div>
                                <div className="relative flex items-center" style={{ width: timelineWidth, height: 18 }}>
                                  <UsageBar task={t} machineId={machine.id} weeks={weeks} colors={colors} startIdx={startIdx} endIdx={endIdx} machineCountOfItem={machinesPerItem.get(t.itemId) ?? 1} />
                                </div>
                              </div>
                            );
                          }),
                        ])
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {idle.length > 0 && (
        <details data-proto-idle className="mt-3 rounded-md border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-700">
          <summary className="cursor-pointer select-none font-medium text-neutral-700 dark:text-neutral-200">閒置的樣機({idle.length} 台,目前沒有工作項在用)</summary>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-neutral-600 dark:text-neutral-300">
            {idle.map((m) => (
              <li key={m.id} data-proto-idle-machine={m.id}>
                {showBoardName ? `${m.boardName}・${m.label}` : m.label}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
