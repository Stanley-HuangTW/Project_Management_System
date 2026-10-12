"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GroupDiscipline } from "@prisma/client";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import { setDmScope } from "@/lib/actions/dmScope";
import { NO_DM_LIMITS, type DmScopeFlags, type DmScopeSettings } from "@/lib/dmScope";

const ROWS: { discipline: GroupDiscipline; label: string }[] = [
  { discipline: "SW", label: "SW DM(軟體)" },
  { discipline: "HW", label: "HW DM(硬體、EE 電機)" },
  { discipline: "ME", label: "ME DM(機構)" },
  { discipline: "QA", label: "QA(品保)" },
  { discipline: "PM", label: "PM DM(專案)" },
];

const COLUMNS: { key: keyof DmScopeFlags; label: string; hint: string }[] = [
  { key: "limitItems", label: "工作項", hint: "只看得到指派給自己與同職能組員的工作項(加上它們的上層項目)" },
  { key: "limitLabour", label: "人力表與人力規劃彙總", hint: "只看得到同職能單位的名額、人月與欄位" },
  { key: "limitBudget", label: "預算金額", hint: "看不到階段預算、NRE 報價單、樣機 BOM 的金額" },
];

/**
 * 各職能的 DM 可以看到的範圍。
 *
 * 預設都不勾 = 跟以前一樣,DM 看得到整塊看板;勾了之後,那個職能的 DM 只看得到跟自己職能相關的內容。
 * 管理者、看板建立者、Team Leader、PMD 不受影響。每個勾選當下就存。
 */
export function DmScopeCard({ initial }: { initial: DmScopeSettings }) {
  const { notify } = useDialogs();
  const router = useRouter();
  const [settings, setSettings] = useState<DmScopeSettings>(initial);
  const [isPending, startTransition] = useTransition();

  function toggle(discipline: GroupDiscipline, key: keyof DmScopeFlags) {
    const current = settings[discipline] ?? NO_DM_LIMITS;
    const next = { ...current, [key]: !current[key] };
    setSettings((prev) => ({ ...prev, [discipline]: next }));
    startTransition(async () => {
      try {
        const result = await setDmScope(discipline, next);
        if (result.error) {
          setSettings((prev) => ({ ...prev, [discipline]: current }));
          await notify(result.error, { title: "無法儲存" });
          return;
        }
        router.refresh();
      } catch (err) {
        setSettings((prev) => ({ ...prev, [discipline]: current }));
        await notify(isStaleBuildError(err) ? STALE_BUILD_MESSAGE : "儲存失敗,請稍後再試", { title: "無法儲存" });
      }
    });
  }

  return (
    <div className="max-w-2xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">DM 的可見範圍</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        預設都不勾:DM 跟以前一樣看得到整塊看板。勾了之後,那個職能的 DM(在「分組角色設定」指定的)只看得到跟自己職能相關的內容。
        管理者、看板建立者、Team Leader、PMD 不受影響;同時是好幾個職能的 DM,每個職能都勾了才限制。
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
            <th className="pb-1 font-normal">職能</th>
            {COLUMNS.map((c) => (
              <th key={c.key} title={c.hint} className="pb-1 text-center font-normal">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.discipline} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="py-1.5 text-neutral-700 dark:text-neutral-200">{row.label}</td>
              {COLUMNS.map((c) => (
                <td key={c.key} className="py-1.5 text-center">
                  <input
                    type="checkbox"
                    checked={settings[row.discipline]?.[c.key] === true}
                    disabled={isPending}
                    onChange={() => toggle(row.discipline, c.key)}
                    aria-label={`${row.label}只看本職能的${c.label}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 space-y-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
        {COLUMNS.map((c) => (
          <li key={c.key}>
            <b className="font-medium">{c.label}</b>:{c.hint}。
          </li>
        ))}
        <li>沒有指派任何人的工作項不算本職能相關,被限制的 DM 看不到(自己建立的除外)。</li>
      </ul>
    </div>
  );
}
