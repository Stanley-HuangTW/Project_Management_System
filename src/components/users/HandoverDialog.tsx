"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import { executeHandover, previewHandover, type HandoverPreview } from "@/lib/actions/handover";

const ROLE_LABELS: Record<string, string> = {
  TEAM_LEADER: "Team Leader",
  SW_DM: "SW DM",
  HW_DM: "HW DM",
  ME_DM: "ME DM",
  QA: "QA",
  PMM: "PMM",
  PMD: "PMD",
  PM_DM: "PM DM",
};

const selectClass =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-blue-500";

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const rowClass = "flex items-start gap-2 rounded px-1 py-1 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800";
const headingClass = "mb-1 flex items-center justify-between text-sm font-medium text-neutral-800 dark:text-neutral-100";
const linkButtonClass = "text-xs font-normal text-blue-600 hover:underline dark:text-blue-300";

/** 一個分類的清單:標題、全選 / 全不選、一列一個勾選框。放在元件外面,重新畫的時候勾選框才不會被換掉。 */
function Section({
  title,
  ids,
  selected,
  onChange,
  children,
  label,
}: {
  title: string;
  ids: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  children: React.ReactNode;
  label: string;
}) {
  if (ids.length === 0) return null;
  return (
    <section data-handover-section={label} className="mb-4">
      <p className={headingClass}>
        <span>
          {title}({selected.size} / {ids.length})
        </span>
        <span className="flex gap-3">
          <button type="button" onClick={() => onChange(new Set(ids))} className={linkButtonClass}>
            全選
          </button>
          <button type="button" onClick={() => onChange(new Set())} className={linkButtonClass}>
            全不選
          </button>
        </span>
      </p>
      <div className="max-h-56 overflow-auto rounded-md border border-neutral-200 p-1 dark:border-neutral-700">{children}</div>
    </section>
  );
}

/**
 * 工作交接:把一個人名下還沒做完的工作交給另一個人(只有管理者看得到這一頁)。
 * 選好轉出者與接手者就列出會動到哪些——工作項、風險與問題、人力名額、分組角色——預設全部勾起來,
 * 可以逐筆取消,按「確認轉移」才真的轉。上面的元件只在要用的時候才畫出來,所以每次打開都是乾淨的。
 */
export function HandoverDialog({
  people,
  initialFromId,
  onClose,
}: {
  people: { id: string; name: string }[];
  initialFromId: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { confirm, notify } = useDialogs();
  const [fromId, setFromId] = useState(initialFromId ?? "");
  const [toId, setToId] = useState("");
  const [loaded, setLoaded] = useState<{ key: string; data: HandoverPreview } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemIds, setItemIds] = useState<Set<string>>(new Set());
  const [riskIds, setRiskIds] = useState<Set<string>>(new Set());
  const [slotIds, setSlotIds] = useState<Set<string>>(new Set());
  const [roleIds, setRoleIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!fromId || !toId || fromId === toId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const result = await previewHandover(fromId, toId).catch(() => ({ error: "無法讀取交接清單,請稍後再試。", preview: undefined }));
      if (cancelled) return;
      setLoading(false);
      if (result.error || !result.preview) {
        setLoaded(null);
        setError(result.error ?? "無法讀取交接清單。");
        return;
      }
      const data = result.preview;
      setLoaded({ key: `${fromId}:${toId}`, data });
      setItemIds(new Set(data.items.map((i) => i.itemId)));
      setRiskIds(new Set(data.risks.map((r) => r.riskId)));
      setSlotIds(new Set(data.slots.map((s) => s.slotId)));
      setRoleIds(new Set(data.roles.map((r) => r.roleId)));
    })();
    return () => {
      cancelled = true;
    };
  }, [fromId, toId]);

  const preview = loaded && loaded.key === `${fromId}:${toId}` ? loaded.data : null;
  const total = itemIds.size + riskIds.size + slotIds.size + roleIds.size;
  const nothingToMove =
    !!preview && preview.items.length + preview.risks.length + preview.slots.length + preview.roles.length === 0;

  async function submit() {
    if (!preview) return;
    const ok = await confirm(
      `把「${preview.fromName}」的 ${total} 項(工作項 ${itemIds.size}、風險與問題 ${riskIds.size}、人力名額 ${slotIds.size}、分組角色 ${roleIds.size})交給「${preview.toName}」?`,
      { title: "確認工作交接", confirmLabel: "確認轉移" }
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const result = await executeHandover({
      fromId,
      toId,
      itemIds: [...itemIds],
      riskIds: [...riskIds],
      slotIds: [...slotIds],
      roleIds: [...roleIds],
    }).catch(() => ({ error: "交接失敗,請重新整理後再試一次。", moved: undefined }));
    setBusy(false);
    if (result.error || !result.moved) {
      setError(result.error ?? "交接失敗。");
      return;
    }
    const m = result.moved;
    await notify(
      `已完成交接:工作項 ${m.items}、風險與問題 ${m.risks}、人力名額 ${m.slots}、分組角色 ${m.roles}。`,
      { title: "工作交接" }
    );
    router.refresh();
    onClose();
  }

  return (
    <Modal open onOpenChange={(o) => !o && onClose()} title="工作交接" size="xl">
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        把轉出者名下<b>還沒完成</b>的工作交給接手的人:工作項的人員分配與人員欄位(負責人等)、進行中的風險與問題、人力名額、分組角色。
        已完成的工作項、已結案的風險、過去月份的人力名額,留在原來的人名下當紀錄。確認前可以逐筆取消勾選。
      </p>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          轉出者(誰要把工作交出去)
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={`${selectClass} mt-1`} aria-label="轉出者">
            <option value="">選一個人…</option>
            {people.filter((p) => p.id !== toId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-neutral-500 dark:text-neutral-400">
          接手者(交給誰)
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={`${selectClass} mt-1`} aria-label="接手者">
            <option value="">選一個人…</option>
            {people.filter((p) => p.id !== fromId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && <p className="text-sm text-neutral-400 dark:text-neutral-500">讀取交接清單…</p>}
      {nothingToMove && (
        <p data-handover-empty className="text-sm text-neutral-500 dark:text-neutral-400">
          「{preview.fromName}」目前沒有需要交接的東西(沒有還沒完成的工作項、進行中的風險與問題、人力名額與分組角色)。
        </p>
      )}

      {preview && !nothingToMove && (
        <>
          <Section
            label="items"
            title="工作項"
            ids={preview.items.map((i) => i.itemId)}
            selected={itemIds}
            onChange={setItemIds}
          >
            {preview.items.map((item) => (
              <label key={item.itemId} className={rowClass}>
                <input type="checkbox" className="mt-0.5" checked={itemIds.has(item.itemId)} onChange={() => setItemIds(toggled(itemIds, item.itemId))} />
                <span className="min-w-0 flex-1">
                  <span className="text-neutral-800 dark:text-neutral-100">{item.itemName}</span>
                  <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">
                    {item.boardName} / {item.groupName}
                  </span>
                  <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                    {[
                      item.allocationPct !== null ? `人員分配 ${item.allocationPct}%` : null,
                      ...item.personColumns.map((name) => `「${name}」欄`),
                    ]
                      .filter(Boolean)
                      .join("、")}
                    {item.allocationPct !== null && item.targetAllocationPct !== null && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400">
                        (接手者已有 {item.targetAllocationPct}%,合計 {Math.min(100, item.allocationPct + item.targetAllocationPct)}%)
                      </span>
                    )}
                  </span>
                </span>
              </label>
            ))}
          </Section>

          <Section label="risks" title="風險與問題" ids={preview.risks.map((r) => r.riskId)} selected={riskIds} onChange={setRiskIds}>
            {preview.risks.map((risk) => (
              <label key={risk.riskId} className={rowClass}>
                <input type="checkbox" className="mt-0.5" checked={riskIds.has(risk.riskId)} onChange={() => setRiskIds(toggled(riskIds, risk.riskId))} />
                <span className="min-w-0 flex-1">
                  <span className="text-neutral-800 dark:text-neutral-100">{risk.title}</span>
                  <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">
                    {risk.kind === "ISSUE" ? "問題" : "風險"}・{risk.boardName}
                  </span>
                  <span className="block text-[11px] text-neutral-500 dark:text-neutral-400">
                    {[risk.asOwner ? "負責人" : null, risk.asReviewer ? "審核人(還沒同意的)" : null].filter(Boolean).join("、")}
                  </span>
                </span>
              </label>
            ))}
          </Section>

          <Section label="slots" title="人力名額" ids={preview.slots.map((s) => s.slotId)} selected={slotIds} onChange={setSlotIds}>
            {preview.slots.map((slot) => (
              <label key={slot.slotId} className={rowClass}>
                <input type="checkbox" className="mt-0.5" checked={slotIds.has(slot.slotId)} onChange={() => setSlotIds(toggled(slotIds, slot.slotId))} />
                <span className="min-w-0 flex-1 text-neutral-800 dark:text-neutral-100">
                  {slot.label}
                  {slot.func && <span className="ml-1 text-neutral-500 dark:text-neutral-400">{slot.func}</span>}
                  <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">{slot.boardName}</span>
                </span>
              </label>
            ))}
          </Section>

          <Section label="roles" title="分組角色" ids={preview.roles.map((r) => r.roleId)} selected={roleIds} onChange={setRoleIds}>
            {preview.roles.map((role) => (
              <label key={role.roleId} className={rowClass}>
                <input type="checkbox" className="mt-0.5" checked={roleIds.has(role.roleId)} onChange={() => setRoleIds(toggled(roleIds, role.roleId))} />
                <span className="min-w-0 flex-1 text-neutral-800 dark:text-neutral-100">
                  {ROLE_LABELS[role.role] ?? role.role}
                  <span className="ml-1.5 text-neutral-400 dark:text-neutral-500">
                    {role.groupName}・{role.boardName}
                  </span>
                </span>
              </label>
            ))}
          </Section>
        </>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <span data-handover-summary className="text-xs text-neutral-500 dark:text-neutral-400">
          {preview && !nothingToMove
            ? `將轉移:工作項 ${itemIds.size}、風險與問題 ${riskIds.size}、人力名額 ${slotIds.size}、分組角色 ${roleIds.size}`
            : ""}
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || !preview || total === 0}
            onClick={() => void submit()}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy ? "轉移中…" : "確認轉移"}
          </button>
        </span>
      </div>
    </Modal>
  );
}
