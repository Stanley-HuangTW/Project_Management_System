"use client";

import { useRouter } from "next/navigation";
import { PercentInput } from "@/components/ui/PercentInput";
import { useDialogs } from "@/components/ui/DialogProvider";
import { upsertAssignment } from "@/lib/actions/assignment";
import { isStaleBuildError, STALE_BUILD_MESSAGE } from "@/lib/staleBuild";
import type { ItemData, UserOption } from "@/types/board";
import { useOwnerDefaultPct } from "./OwnerDefaultPctContext";

/**
 * 負責人旁邊選填的「工作量 %」。不填,這位負責人就照系統設定的預設比例算;填了,等於把他加進
 * 這個工作項的「人員分配」並設定那個百分比(百分比只存在人員分配裡,工作量只有一套算法)。
 * 清空不會刪除人員分配,要移除請到「人員分配」。
 */
export function OwnerAllocationInput({
  boardId,
  item,
  ownerId,
  users,
  canEdit,
}: {
  boardId: string;
  item: Pick<ItemData, "id" | "assignments">;
  ownerId: string | null;
  users: UserOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const defaultPct = useOwnerDefaultPct();
  const owner = ownerId ? users.find((u) => u.id === ownerId) : undefined;
  // 負責人可以是 Resource(治具、廠商),它們沒有工作量這回事。
  if (!owner || owner.isResource) return null;

  const current = item.assignments.find((a) => a.userId === owner.id)?.allocationPct ?? null;

  async function save(pct: number) {
    try {
      await upsertAssignment(boardId, item.id, owner!.id, pct);
      router.refresh();
    } catch (err) {
      await notify(
        isStaleBuildError(err) ? STALE_BUILD_MESSAGE : err instanceof Error ? err.message : "無法儲存工作量",
        { title: isStaleBuildError(err) ? "需要重新整理" : "無法設定工作量" }
      );
    }
  }

  return (
    <label
      className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400"
      title={`選填。不填就用系統設定的預設比例${defaultPct === null ? "" : `(${defaultPct}%)`};填了會同步加進「人員分配」。`}
    >
      工作量
      <PercentInput
        value={current}
        delayMs={500}
        disabled={!canEdit}
        placeholder={defaultPct === null ? "預設" : String(defaultPct)}
        onChange={save}
        className="w-14 rounded-md border border-neutral-300 bg-white px-1.5 py-1 text-right text-sm outline-none placeholder:text-neutral-400 focus:border-blue-500 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900"
      />
      %
    </label>
  );
}
