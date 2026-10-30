"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { OrgUnit } from "@/lib/orgUnits";
import type { OrgNodeLite } from "@/lib/orgTree";
import { OrgUnitNodesPicker } from "./OrgUnitNodesPicker";
import {
  createOrgUnit,
  renameOrgUnit,
  deleteOrgUnit,
  moveOrgUnit,
} from "@/lib/actions/orgUnit";
import { setOrgUnitNodes } from "@/lib/actions/orgChart";
import { knownErrorMessage } from "@/lib/userError";

/**
 * 公司組織單位。
 *
 * 人力表的欄位、人力名額的單位、每個人的所屬單位都讀這一份。本來寫死在
 * schema 裡,公司多一個 FAE 就得改程式重上版 —— 那不是設定該有的樣子。
 */
export function OrgUnitCard({ units, nodes }: { units: OrgUnit[]; nodes: OrgNodeLite[] }) {
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
      await notify(knownErrorMessage(error, "操作失敗,請稍後再試"), {
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
    <div className="max-w-3xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">公司組織單位</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        人力表的欄位、人力名額的單位、每個人的所屬單位都是這一份,順序就是表格欄位的順序。
        已經有人月、標準月薪或名額掛著的單位刪不掉,得先把那些改到別的單位。
      </p>
      <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-950/40 dark:text-blue-200">
        這裡的「單位」是算人力用的(EE、ME…)。「對應組織架構圖部門」把單位對應到
        <Link href="/org-chart" className="mx-1 font-medium underline">組織架構圖</Link>
        的部門,可以複選;一個部門也可以同時對應好幾個單位(例如品質管理部 = QA + FAE)。
        使用者管理裡選了那個部門(或它底下沒有自己對應的子部門)的人,對應只有一個單位就自動帶入;有好幾個單位就由你在使用者管理選。
        誰是誰的直屬、二階、三階主管,也在組織架構圖設定。
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 dark:text-neutral-400">
            <th className="pb-1 font-normal">代號</th>
            <th className="pb-1 font-normal">顯示名稱</th>
            <th className="pb-1 font-normal">對應組織架構圖部門</th>
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
              <td className="py-1.5 pr-2" data-unit-nodes={unit.code}>
                {(() => {
                  const mapped = nodes.filter((n) => n.unitCodes?.includes(unit.code));
                  const mappedIds = mapped.map((n) => n.id);
                  return (
                    <div className="flex flex-wrap items-center gap-1">
                      {mapped.map((n) => (
                        <span
                          key={n.id}
                          className="inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
                        >
                          {n.name}
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() =>
                              run(() =>
                                setOrgUnitNodes(
                                  unit.code,
                                  mappedIds.filter((id) => id !== n.id)
                                )
                              )
                            }
                            title={`取消「${n.name}」對應 ${unit.code}`}
                            aria-label={`取消「${n.name}」對應 ${unit.code}`}
                            className="rounded text-blue-400 hover:text-red-600 disabled:opacity-50"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ))}
                      <OrgUnitNodesPicker
                        unitCode={unit.code}
                        unitName={unit.label}
                        nodes={nodes}
                        selectedIds={mappedIds}
                        disabled={isPending}
                        onApply={async (ids) => {
                          await run(() => setOrgUnitNodes(unit.code, ids));
                        }}
                      />
                    </div>
                  );
                })()}
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
