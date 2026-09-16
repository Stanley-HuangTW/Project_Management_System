"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import type { OrgUnit } from "@/lib/orgUnits";
import {
  createOrgUnit,
  renameOrgUnit,
  deleteOrgUnit,
  moveOrgUnit,
} from "@/lib/actions/orgUnit";

/**
 * 公司組織單位。
 *
 * 人力表的欄位、人力名額的單位、每個人的所屬單位都讀這一份。本來寫死在
 * schema 裡,公司多一個 FAE 就得改程式重上版 —— 那不是設定該有的樣子。
 */
export function OrgUnitCard({ units }: { units: OrgUnit[] }) {
  const { notify, prompt, confirm } = useDialogs();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /** 伺服器才知道能不能改,所以結果一律由它回答,這裡只負責顯示。 */
  async function run(action: () => Promise<{ error?: string }>) {
    try {
      const result = await action();
      if (result.error) {
        await notify(result.error, { title: "無法完成" });
        return false;
      }
      // 動作那邊 revalidate 過了,這裡要求重畫,新的清單才會流到兩張卡片上。
      startTransition(() => router.refresh());
      return true;
    } catch (error) {
      await notify(isStaleBuildError(error) ? STALE_BUILD_MESSAGE : "操作失敗,請稍後再試", {
        title: "無法完成",
      });
      return false;
    }
  }

  async function add() {
    const code = await prompt("單位代號?例如 FAE、NPI", { title: "新增組織單位" });
    if (code === null || !code.trim()) return;
    const label = await prompt("顯示名稱?例如 FAE 技術支援", {
      title: "新增組織單位",
      defaultValue: code.trim().toUpperCase(),
    });
    if (label === null) return;
    await run(() => createOrgUnit(code, label));
  }

  async function rename(unit: OrgUnit) {
    const label = await prompt("顯示名稱?", {
      title: `修改 ${unit.code}`,
      defaultValue: unit.label,
    });
    if (label === null || !label.trim()) return;
    await run(() => renameOrgUnit(unit.code, label));
  }

  async function remove(unit: OrgUnit) {
    const ok = await confirm(`刪除組織單位「${unit.label}」?`, {
      title: "刪除組織單位",
      confirmLabel: "刪除",
      danger: true,
    });
    if (ok) await run(() => deleteOrgUnit(unit.code));
  }

  const iconButton =
    "rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-200";

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">公司組織單位</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        人力表的欄位、人力名額的單位、每個人的所屬單位都是這一份,順序就是表格欄位的順序。
        已經有人月、標準月薪或名額掛著的單位刪不掉,得先把那些改到別的單位。
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
            <th className="pb-1 font-normal">代號</th>
            <th className="pb-1 font-normal">顯示名稱</th>
            <th className="pb-1 text-right font-normal">順序</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, index) => (
            <tr key={unit.code} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="py-1.5 font-mono text-xs text-neutral-700 dark:text-neutral-200">
                {unit.code}
              </td>
              <td className="py-1.5">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => rename(unit)}
                  title="改名稱"
                  className="rounded px-1 py-0.5 text-left text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                >
                  {unit.label}
                </button>
              </td>
              <td className="py-1.5">
                <div className="flex items-center justify-end gap-0.5">
                  <button
                    type="button"
                    disabled={isPending || index === 0}
                    onClick={() => run(() => moveOrgUnit(unit.code, "up"))}
                    title="往上"
                    className={iconButton}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending || index === units.length - 1}
                    onClick={() => run(() => moveOrgUnit(unit.code, "down"))}
                    title="往下"
                    className={iconButton}
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => remove(unit)}
                    title={`刪除 ${unit.code}`}
                    className="rounded p-1 text-neutral-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-950/40"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button
        type="button"
        disabled={isPending}
        onClick={add}
        className="mt-3 inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-100 dark:hover:bg-neutral-800"
      >
        <Plus size={12} />
        新增單位
      </button>
    </div>
  );
}
