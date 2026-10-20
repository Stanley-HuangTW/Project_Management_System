"use client";

import { useState, useTransition } from "react";
import { CalendarOff, Settings } from "lucide-react";
import type { GanttDurationMode, Holiday, NotificationType } from "@prisma/client";
import {
  setEmailNotificationsEnabled,
  setGanttDurationMode,
  setHoursPerDay,
  setOwnerDefaultAllocationPct,
  setLevelColors,
  setGanttStatusColors,
  setPredLampColors,
  setEnabledNotificationTypes,
} from "@/lib/actions/systemSettings";
import { ALL_NOTIFICATION_TYPES, NOTIFICATION_TYPE_LABELS } from "@/lib/notificationTypes";
import { HolidaySettingsModal } from "@/components/dashboard/HolidaySettingsModal";
import { DisciplineRateCard } from "./DisciplineRateCard";
import { OrgUnitCard } from "./OrgUnitCard";
import { ApprovalLevelsCard } from "./ApprovalLevelsCard";
import { DmScopeCard } from "./DmScopeCard";
import type { DmScopeSettings } from "@/lib/dmScope";
import type { OrgUnit } from "@/lib/orgUnits";
import type { OrgNodeLite } from "@/lib/orgTree";
import { WorkloadThresholdModal } from "@/components/dashboard/WorkloadThresholdModal";
import type { WorkloadThresholdSettings } from "@/lib/workload";
import type { UserOption } from "@/types/board";
import { GanttColumnMappingCard, type GanttMappingBoard } from "./GanttColumnMappingCard";
import { ReportSettingsCard, type ReportSettingsBoardWithName } from "./ReportSettingsCard";
import { BaselineCard, type BaselineBoard } from "./BaselineCard";
import { ProgramCard, type ProgramBoard } from "./ProgramCard";
import { ProgramReportSubscriptionCard } from "./ProgramReportSubscriptionCard";
import { WeeklyReportScheduleCard } from "./WeeklyReportScheduleCard";
import { BackupSettingsCard } from "./BackupSettingsCard";
import { TimeCategoryCard } from "./TimeCategoryCard";
import type { BackupScheduleInput } from "@/lib/actions/backup";
import { ExchangeRateCard } from "./ExchangeRateCard";
import type { ProgramRow } from "@/lib/actions/program";
import type { ProgramReportSubscriptionRow } from "@/lib/actions/programReportSubscription";
import { BoardSharingCard, type SharingBoard } from "./BoardSharingCard";
import { IntegrationCard } from "./IntegrationCard";
import { MantisIntegrationCard } from "./MantisIntegrationCard";
import { StatusColorCard, type StatusColorBoard } from "./StatusColorCard";
import { DefaultColumnsCard, type DefaultColumnsBoard } from "./DefaultColumnsCard";
import type { DefaultColumn } from "@/lib/defaultColumns";

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

/** 決定這套系統要啟用哪些通知類型——關掉的話,不管使用者個人設定怎麼
 *  選,那個類型的通知(站內與 email)都不會產生。 */
function NotificationTypesCard({ initial }: { initial: NotificationType[] }) {
  const [enabled, setEnabled] = useState<Set<NotificationType>>(new Set(initial));
  const [isPending, startTransition] = useTransition();

  function toggle(type: NotificationType) {
    const next = new Set(enabled);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setEnabled(next);
    startTransition(async () => {
      await setEnabledNotificationTypes(Array.from(next));
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900">
      <div className="px-4 py-3">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">通知類型</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          關掉的類型,全公司都不會再收到——不管每個人自己的通知設定怎麼選。
        </p>
      </div>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-700 border-t border-neutral-100 dark:border-neutral-700">
        {ALL_NOTIFICATION_TYPES.map((type) => (
          <li key={type} className="flex items-center justify-between gap-4 px-4 py-2">
            <span className="text-sm text-neutral-700 dark:text-neutral-100">
              {NOTIFICATION_TYPE_LABELS[type]}
            </span>
            <input
              type="checkbox"
              checked={enabled.has(type)}
              disabled={isPending}
              onChange={() => toggle(type)}
              className="h-4 w-4 accent-blue-600 disabled:opacity-50"
            />
          </li>
        ))}
      </ul>
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

/** 每日工時 — the factor that turns a plan ("50% for 10 days") into hours,
 *  and hours into money. One number, company-wide. */
function HoursPerDayCard({ initial }: { initial: number }) {
  const [hours, setHours] = useState(String(initial));
  const [isPending, startTransition] = useTransition();

  function save() {
    const value = Number(hours);
    if (!Number.isFinite(value) || value < 1 || value > 24) {
      setHours(String(initial));
      return;
    }
    startTransition(async () => {
      await setHoursPerDay(value);
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">每日工時</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        一個工作天算幾小時。把「配置 50%、做 10 天」換算成工時,再乘上成員時薪就是計畫人力成本
        ——成本報表與工時登記都以這個數字為準。
      </p>
      <input
        type="number"
        min={1}
        max={24}
        value={hours}
        disabled={isPending}
        onChange={(e) => setHours(e.target.value)}
        onBlur={save}
        className="w-24 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
      />
      <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">小時</span>
    </div>
  );
}

function OwnerDefaultAllocationCard({ initial }: { initial: number }) {
  const [pct, setPct] = useState(String(initial));
  const [isPending, startTransition] = useTransition();

  function save() {
    const value = Number(pct);
    if (pct.trim() === "" || !Number.isFinite(value) || value < 0 || value > 100) {
      setPct(String(initial));
      return;
    }
    startTransition(async () => {
      await setOwnerDefaultAllocationPct(value);
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">負責人預設工作量</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        工作項只在「負責人」欄位掛了人、沒有另外做「人員分配」時,那位負責人算幾 % 的工作量(儀表板的成員工作量、
        過度配置與甘特圖的每日負載都用這個數字)。要精確一點,在負責人旁邊直接填「工作量 %」,或到「人員分配」設定。
        填 0 代表負責人欄位完全不計入工作量。
      </p>
      <input
        type="number"
        min={0}
        max={100}
        value={pct}
        disabled={isPending}
        onChange={(e) => setPct(e.target.value)}
        onBlur={save}
        className="w-24 rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500 disabled:opacity-50"
      />
      <span className="ml-2 text-sm text-neutral-500 dark:text-neutral-400">%</span>
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
  orgUnits,
  orgNodes,
  dmScopes,
  emailNotificationsEnabled,
  enabledNotificationTypes,
  ganttDurationMode,
  hoursPerDay,
  workingDaysPerMonth,
  ownerDefaultAllocationPct,
  approvalLevels,
  levelColors,
  ganttStatusColors,
  predLampColors,
  holidays,
  workloadThreshold,
  ganttMappingBoards,
  baselineBoards,
  programs,
  programBoards,
  programReportSubscriptions,
  weeklyReportSchedule,
  backupSchedule,
  reportSettingsBoards,
  statusColorBoards,
  defaultColumnsBoards,
  defaultColumns,
  defaultColumnsConfigured,
  sharingBoards,
  users,
}: {
  isAdmin: boolean;
  orgUnits: OrgUnit[];
  /** 組織架構圖的部門(含對應的人力單位),公司組織單位那張卡用。 */
  orgNodes: OrgNodeLite[];
  dmScopes: DmScopeSettings;
  emailNotificationsEnabled: boolean;
  enabledNotificationTypes: NotificationType[];
  ganttDurationMode: GanttDurationMode;
  hoursPerDay: number;
  workingDaysPerMonth: number;
  ownerDefaultAllocationPct: number;
  approvalLevels: { leave: number; timesheet: number };
  levelColors: string[];
  ganttStatusColors: { overdue: string; completed: string; inProgress: string };
  predLampColors: { ready: string; waiting: string; blocked: string };
  holidays: Holiday[];
  workloadThreshold: WorkloadThresholdSettings;
  ganttMappingBoards: GanttMappingBoard[];
  baselineBoards: BaselineBoard[];
  programs: ProgramRow[];
  programBoards: ProgramBoard[];
  programReportSubscriptions: ProgramReportSubscriptionRow[];
  weeklyReportSchedule: {
    enabled: boolean;
    dow: number;
    hour: number;
    minute: number;
    rangeStartDow: number;
    rangeEndDow: number;
    reminderHours: number;
  };
  backupSchedule: BackupScheduleInput;
  reportSettingsBoards: ReportSettingsBoardWithName[];
  statusColorBoards: StatusColorBoard[];
  defaultColumnsBoards: DefaultColumnsBoard[];
  defaultColumns: DefaultColumn[];
  defaultColumnsConfigured: boolean;
  sharingBoards: SharingBoard[];
  users: UserOption[];
}) {
  return (
    <div className="space-y-4">
      {isAdmin && (
        <>
          <EmailNotificationsCard initial={emailNotificationsEnabled} />
          <NotificationTypesCard initial={enabledNotificationTypes} />
          <GanttModeCard initial={ganttDurationMode} />
          <HoursPerDayCard initial={hoursPerDay} />
          <OwnerDefaultAllocationCard initial={ownerDefaultAllocationPct} />
          <TimeCategoryCard />
          <OrgUnitCard units={orgUnits} nodes={orgNodes} />
          <ApprovalLevelsCard initial={approvalLevels} />
          <DmScopeCard initial={dmScopes} />
          <DisciplineRateCard
            units={orgUnits}
            workingDaysPerMonth={workingDaysPerMonth}
            hoursPerDay={hoursPerDay}
          />
          <ExchangeRateCard />
          <HolidayCard holidays={holidays} />
          <LevelColorCard initial={levelColors} />
          <GanttStatusColorCard initial={ganttStatusColors} />
          <StatusColorCard boards={statusColorBoards} />
          <PredLampColorCard initial={predLampColors} />
          <WorkloadThresholdCard threshold={workloadThreshold} />
          <BaselineCard boards={baselineBoards} />
          <ProgramCard programs={programs} boards={programBoards} />
          <WeeklyReportScheduleCard initial={weeklyReportSchedule} />
          <BackupSettingsCard initial={backupSchedule} />
          <ProgramReportSubscriptionCard subscriptions={programReportSubscriptions} users={users} />
          <GanttColumnMappingCard boards={ganttMappingBoards} />
          <DefaultColumnsCard
            boards={defaultColumnsBoards}
            initialColumns={defaultColumns}
            initialConfigured={defaultColumnsConfigured}
          />
          <ReportSettingsCard boards={reportSettingsBoards} />
          <IntegrationCard boards={sharingBoards.map((b) => ({ id: b.id, name: b.name }))} />
          <MantisIntegrationCard />
        </>
      )}
      <BoardSharingCard boards={sharingBoards} users={users} />
    </div>
  );
}
