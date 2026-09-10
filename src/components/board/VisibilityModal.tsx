"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Globe } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { UserOption } from "@/types/board";
import {
  getItemVisibility,
  setItemVisibility,
  getGroupVisibility,
  setGroupVisibility,
  type VisibilitySetting,
} from "@/lib/actions/visibility";

/**
 * 可見範圍 for a 分組 or a 工作項.
 *
 * A team leader plans in the shared board but does not want other
 * departments reading their rows. PRIVATE hides it from everyone except the
 * people named here — plus whoever the work is assigned to, since you cannot
 * do a task you cannot see.
 */
export function VisibilityModal({
  target,
  users,
  open,
  onOpenChange,
}: {
  target: { kind: "item" | "group"; id: string; name: string } | null;
  users: UserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  const [setting, setSetting] = useState<VisibilitySetting | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [isPrivate, setIsPrivate] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    let cancelled = false;
    (async () => {
      const result =
        target.kind === "item" ? await getItemVisibility(target.id) : await getGroupVisibility(target.id);
      if (!cancelled) {
        setSetting(result);
        setSelected(result?.viewerIds ?? []);
        setIsPrivate(result?.visibility === "PRIVATE");
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, target]);

  async function save() {
    if (!target) return;
    setBusy(true);
    try {
      const visibility = isPrivate ? "PRIVATE" : "PUBLIC";
      const result =
        target.kind === "item"
          ? await setItemVisibility(target.id, visibility, selected)
          : await setGroupVisibility(target.id, visibility, selected);
      if (result.error) {
        await notify(result.error, { title: "無法設定可見範圍" });
        return;
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const label = target?.kind === "group" ? "分組" : "工作項";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`可見範圍 — ${target?.name ?? ""}`}
      size="md"
    >
      {loading ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
              <input
                type="radio"
                checked={!isPrivate}
                disabled={!setting?.canManage || busy}
                onChange={() => setIsPrivate(false)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  <Globe size={14} /> 公開
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                  看得到這個看板的人都看得到這個{label}。
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 p-3">
              <input
                type="radio"
                checked={isPrivate}
                disabled={!setting?.canManage || busy}
                onChange={() => setIsPrivate(true)}
                className="mt-0.5"
              />
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                  <Lock size={14} /> 私人
                </span>
                <span className="mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400">
                  只有下面勾選的人、建立者、被指派到這個工作的人,以及管理者看得到。
                  {target?.kind === "group" && "分組裡的所有工作項都會一起隱藏。"}
                  {target?.kind === "item" && "底下的子項目也會一起隱藏。"}
                </span>
              </span>
            </label>
          </div>

          {isPrivate && (
            <div>
              <p className="mb-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                指定看得到的人({selected.length} 人)
              </p>
              <div className="max-h-56 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-700 p-1">
                {users
                  .filter((u) => !u.isResource)
                  .map((user) => (
                    <label
                      key={user.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(user.id)}
                        disabled={!setting?.canManage || busy}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, user.id]
                              : selected.filter((id) => id !== user.id)
                          )
                        }
                      />
                      <span className="text-neutral-700 dark:text-neutral-100">{user.name}</span>
                    </label>
                  ))}
              </div>
            </div>
          )}

          {!setting?.canManage && (
            <p className="rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              只有建立者{setting?.ownerName ? `(${setting.ownerName})` : ""}或管理者可以改這個設定
              ——看得到不等於可以決定誰看得到。
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!setting?.canManage || busy}
              onClick={save}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              儲存
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
