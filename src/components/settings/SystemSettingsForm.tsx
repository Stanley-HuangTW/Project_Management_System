"use client";

import { useState, useTransition } from "react";
import { CalendarOff, Settings } from "lucide-react";
import type { GanttDurationMode, Holiday } from "@prisma/client";
import {
  setEmailNotificationsEnabled,
  setGanttDurationMode,
  setLevelColors,
  setGanttStatusColors,
  setPredLampColors,
} from "@/lib/actions/systemSettings";
import { HolidaySettingsModal } from "@/components/dashboard/HolidaySettingsModal";
import { WorkloadThresholdModal } from "@/components/dashboard/WorkloadThresholdModal";
import type { WorkloadThresholdSettings } from "@/lib/workload";
import type { UserOption } from "@/types/board";
import { GanttColumnMappingCard, type GanttMappingBoard } from "./GanttColumnMappingCard";
import { ReportSettingsCard, type ReportSettingsBoardWithName } from "./ReportSettingsCard";
import { BaselineCard, type BaselineBoard } from "./BaselineCard";
import { BoardSharingCard, type SharingBoard } from "./BoardSharingCard";
import { IntegrationCard } from "./IntegrationCard";
import { StatusColorCard, type StatusColorBoard } from "./StatusColorCard";

const MAX_LEVELS = 6;

function EmailNotificationsCard({ initial }: { initial: boolean }) {
  const [enabled, setEnabled] = useState(initial);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      await setEmailNotificationsEnabled(next);
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">Email 通知</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            開啟後,系統會在指派工作項目、觸發自動化規則時寄送 Email 通知給相關使用者。
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Email 通知"
          onClick={toggle}
          disabled={isPending}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            enabled ? "bg-blue-600" : "bg-neutral-300"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white dark:bg-neutral-900 shadow transition-transform ${
              enabled ? "translate-x-[1.375rem]" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
      <p className="border-t border-neutral-100 dark:border-neutral-700 px-4 py-2 text-xs text-neutral-400 dark:text-neutral-500">
        目前狀態:{enabled ? "已開啟,將寄送 Email 通知" : "已關閉,不會寄送任何 Email 通知"}
      </p>
    </div>
  );
}

function GanttModeCard({ initial }: { initial: GanttDurationMode }) {
  const [mode, setMode] = useState<GanttDurationMode>(initial);
  const [isPending, startTransition] = useTransition();

  function handleChange(next: GanttDurationMode) {
    setMode(next);
    startTransition(async () => {
      await setGanttDurationMode(next);
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">甘特圖計算方式</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        套用到所有看板的甘特圖:填寫開始日期+天數時,結束日期要以日曆天還是工作天計算。
      </p>
      <select
        value={mode}
        onChange={(e) => handleChange(e.target.value as GanttDurationMode)}
        disabled={isPending}
        className="rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
      >
        <option value="CALENDAR">日曆天</option>
        <option value="BUSINESS">工作天</option>
      </select>
    </div>
  );
}

function HolidayCard({ holidays }: { holidays: Holiday[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">國定假日</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            全公司共用一份清單,甘特圖切到「工作天」計算方式時,這些日期跟週六日一樣不計入天數。目前已設定 {holidays.length} 個假日。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <CalendarOff size={13} /> 管理國定假日
        </button>
      </div>
      <HolidaySettingsModal holidays={holidays} open={open} onOpenChange={setOpen} />
    </div>
  );
}

function LevelColorCard({ initial }: { initial: string[] }) {
  const [colors, setColors] = useState<string[]>(() => {
    const next = [...initial];
    while (next.length < MAX_LEVELS) next.push("");
    return next.slice(0, MAX_LEVELS);
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateColor(index: number, color: string) {
    setSaved(false);
    setColors((prev) => prev.map((c, i) => (i === index ? color : c)));
  }

  function clearColor(index: number) {
    setSaved(false);
    setColors((prev) => prev.map((c, i) => (i === index ? "" : c)));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setLevelColors(colors);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">階層顏色</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        套用到所有看板的表格:依項目的巢狀階層(Lvl 1~{MAX_LEVELS})設定整列背景色,未設定的階層維持預設(無底色)。
      </p>
      <div className="mb-3 space-y-2">
        {colors.map((color, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-sm text-neutral-700 dark:text-neutral-100">Lv {i + 1}</span>
            <input
              type="color"
              value={color || "#ffffff"}
              onChange={(e) => updateColor(i, e.target.value)}
              className="h-8 w-14 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-400 dark:text-neutral-500">{color || "未設定"}</span>
            {color && (
              <button
                type="button"
                onClick={() => clearColor(i)}
                className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-600"
              >
                清除
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "儲存中..." : "儲存"}
        </button>
        {saved && !saving && <span className="text-xs text-green-600">已儲存</span>}
      </div>
    </div>
  );
}

function GanttStatusColorCard({
  initial,
}: {
  initial: { overdue: string; completed: string; inProgress: string };
}) {
  const [colors, setColors] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateColor(key: keyof typeof colors, value: string) {
    setSaved(false);
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setGanttStatusColors(colors);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const fields: { key: keyof typeof colors; label: string }[] = [
    { key: "overdue", label: "逾期" },
    { key: "completed", label: "完成" },
    { key: "inProgress", label: "實作中" },
  ];

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">甘特圖項目名稱顏色</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        套用到所有看板的甘特圖:依項目狀態為項目名稱上色。優先順序為完成 &gt; 逾期 &gt; 實作中;尚未處理(未開始且未逾期)不特別上色,維持預設文字顏色。
      </p>
      <div className="mb-3 space-y-2">
        {fields.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-sm text-neutral-700 dark:text-neutral-100">{label}</span>
            <input
              type="color"
              value={colors[key]}
              onChange={(e) => updateColor(key, e.target.value)}
              className="h-8 w-14 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-400 dark:text-neutral-500">{colors[key]}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "儲存中..." : "儲存"}
        </button>
        {saved && !saving && <span className="text-xs text-green-600">已儲存</span>}
      </div>
    </div>
  );
}

function PredLampColorCard({
  initial,
}: {
  initial: { ready: string; waiting: string; blocked: string };
}) {
  const [colors, setColors] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function updateColor(key: keyof typeof colors, value: string) {
    setSaved(false);
    setColors((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setPredLampColors(colors);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const fields: { key: keyof typeof colors; label: string; hint: string }[] = [
    { key: "ready", label: "可開始", hint: "前置已完成,此項目可以開始執行" },
    { key: "waiting", label: "等待中", hint: "前置進行中或尚未開始,要等它完成" },
    { key: "blocked", label: "被阻擋", hint: "前置已逾期,此項目被延後執行" },
  ];

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">Pred 燈號顏色</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        套用到所有看板:有設前置依賴的項目,會在 Pred 欄位旁顯示一個燈號,顏色依「前置項目自己的狀態」決定。沒設前置的項目不顯示燈號。
      </p>
      <div className="mb-3 space-y-2">
        {fields.map(({ key, label, hint }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="flex w-20 shrink-0 items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-100">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: colors[key] }}
              />
              {label}
            </span>
            <input
              type="color"
              value={colors[key]}
              onChange={(e) => updateColor(key, e.target.value)}
              className="h-8 w-14 shrink-0 cursor-pointer rounded border border-neutral-300 dark:border-neutral-600"
            />
            <span className="min-w-0 flex-1 truncate text-xs text-neutral-400 dark:text-neutral-500">{hint}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "儲存中..." : "儲存"}
        </button>
        {saved && !saving && <span className="text-xs text-green-600">已儲存</span>}
      </div>
    </div>
  );
}

function WorkloadThresholdCard({ threshold }: { threshold: WorkloadThresholdSettings }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">工作量顏色門檻</p>
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            套用到儀表板的「成員工作量總覽」與「成員工作量明細」,依負載百分比設定要顯示的顏色門檻。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <Settings size={13} /> 顏色門檻設定
        </button>
      </div>
      <WorkloadThresholdModal threshold={threshold} open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function SystemSettingsForm({
  isAdmin,
  emailNotificationsEnabled,
  ganttDurationMode,
  levelColors,
  ganttStatusColors,
  predLampColors,
  holidays,
  workloadThreshold,
  ganttMappingBoards,
  baselineBoards,
  reportSettingsBoards,
  statusColorBoards,
  sharingBoards,
  users,
}: {
  isAdmin: boolean;
  emailNotificationsEnabled: boolean;
  ganttDurationMode: GanttDurationMode;
  levelColors: string[];
  ganttStatusColors: { overdue: string; completed: string; inProgress: string };
  predLampColors: { ready: string; waiting: string; blocked: string };
  holidays: Holiday[];
  workloadThreshold: WorkloadThresholdSettings;
  ganttMappingBoards: GanttMappingBoard[];
  baselineBoards: BaselineBoard[];
  reportSettingsBoards: ReportSettingsBoardWithName[];
  statusColorBoards: StatusColorBoard[];
  sharingBoards: SharingBoard[];
  users: UserOption[];
}) {
  return (
    <div className="space-y-4">
      {isAdmin && (
        <>
          <EmailNotificationsCard initial={emailNotificationsEnabled} />
          <GanttModeCard initial={ganttDurationMode} />
          <HolidayCard holidays={holidays} />
          <LevelColorCard initial={levelColors} />
          <GanttStatusColorCard initial={ganttStatusColors} />
          <StatusColorCard boards={statusColorBoards} />
          <PredLampColorCard initial={predLampColors} />
          <WorkloadThresholdCard threshold={workloadThreshold} />
          <BaselineCard boards={baselineBoards} />
          <GanttColumnMappingCard boards={ganttMappingBoards} />
          <ReportSettingsCard boards={reportSettingsBoards} />
          <IntegrationCard boards={sharingBoards.map((b) => ({ id: b.id, name: b.name }))} />
        </>
      )}
      <BoardSharingCard boards={sharingBoards} users={users} />
    </div>
  );
}
