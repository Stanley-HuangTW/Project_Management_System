"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { GroupData } from "@/types/board";
import {
  listProjectTemplates,
  createTemplateFromGroup,
  applyProjectTemplate,
  deleteProjectTemplate,
  type ProjectTemplateSummary,
} from "@/lib/actions/projectTemplate";
import { localeDateWithWeekday, withWeekday } from "@/lib/weekdayLabel";
import { DateWeekdayHint } from "@/components/ui/DateWeekdayHint";

const today = () => new Date().toISOString().slice(0, 10);

/**
 * 專案範本: POC → EVT → PVT keeps coming back with the same shape, so a
 * group that already ran can be kept and poured into the next one.
 */
export function ProjectTemplateModal({
  groups,
  open,
  onOpenChange,
}: {
  groups: GroupData[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { notify, confirm } = useDialogs();
  const [templates, setTemplates] = useState<ProjectTemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const [sourceGroupId, setSourceGroupId] = useState(groups[0]?.id ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [templateId, setTemplateId] = useState("");
  const [targetGroupId, setTargetGroupId] = useState(groups[0]?.id ?? "");
  const [startDate, setStartDate] = useState(today);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const rows = await listProjectTemplates();
      if (!cancelled) setTemplates(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function reload() {
    setTemplates(await listProjectTemplates());
  }

  async function handleCapture() {
    setBusy(true);
    try {
      const result = await createTemplateFromGroup(sourceGroupId, name, description);
      if (result.error) {
        await notify(result.error, { title: "無法建立範本" });
        return;
      }
      await reload();
      setName("");
      setDescription("");
      await notify(`已存成範本,共 ${result.itemCount} 個工作項。`, { title: "範本已建立" });
    } finally {
      setBusy(false);
    }
  }

  async function handleApply() {
    const template = templates.find((t) => t.id === templateId);
    const group = groups.find((g) => g.id === targetGroupId);
    if (!template || !group) return;
    const ok = await confirm(
      `將範本「${template.name}」的 ${template.itemCount} 個工作項建立到分組「${group.name}」,` +
        `起始日期 ${withWeekday(startDate)}?後續日期會依範本裡的天數與前置關係自動算出。`,
      { title: "套用範本", confirmLabel: "建立" }
    );
    if (!ok) return;

    setBusy(true);
    try {
      const result = await applyProjectTemplate(templateId, targetGroupId, startDate);
      if (result.error) {
        await notify(result.error, { title: "無法套用範本" });
        return;
      }
      router.refresh();
      onOpenChange(false);
      await notify(`已建立 ${result.created} 個工作項。`, { title: "範本已套用" });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(template: ProjectTemplateSummary) {
    const ok = await confirm(`刪除範本「${template.name}」?已經用它建立的工作項不受影響。`, {
      title: "刪除範本",
      confirmLabel: "刪除",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await deleteProjectTemplate(template.id);
      if (result.error) {
        await notify(result.error, { title: "無法刪除範本" });
        return;
      }
      if (templateId === template.id) setTemplateId("");
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const fieldClass =
    "rounded-md border border-neutral-300 dark:border-neutral-600 dark:bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-blue-500 disabled:opacity-50";

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="專案範本" size="lg">
      <section className="mb-6">
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">套用範本</h3>
        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          範本只帶結構:名稱、階層、Type/Lvl、天數與前置關係。負責人、狀態、% 完成與日期都不會複製,
          日期改由起始日期加上範本裡的天數與前置關係算出。
        </p>

        {templates.length === 0 ? (
          <p className="py-3 text-sm text-neutral-400 dark:text-neutral-500">還沒有範本,先從下面存一個。</p>
        ) : (
          <>
            <ul className="mb-3 divide-y divide-neutral-100 dark:divide-neutral-700">
              {templates.map((template) => (
                <li key={template.id} className="flex items-center gap-3 py-2">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input
                      type="radio"
                      name="template"
                      checked={templateId === template.id}
                      onChange={() => setTemplateId(template.id)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-neutral-800 dark:text-neutral-100">
                        {template.name}
                        <span className="ml-2 text-xs text-neutral-400 dark:text-neutral-500">
                          {template.itemCount} 個工作項
                        </span>
                      </span>
                      <span className="block truncate text-xs text-neutral-400 dark:text-neutral-500">
                        {template.description ? `${template.description}・` : ""}
                        {template.createdBy ? `${template.createdBy}・` : ""}
                        {localeDateWithWeekday(template.createdAt)}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleDelete(template)}
                    className="shrink-0 rounded px-1 py-0.5 text-neutral-400 dark:text-neutral-500 hover:text-red-600 disabled:opacity-50"
                    aria-label="刪除範本"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-neutral-500 dark:text-neutral-400">建立到分組</span>
              <select
                value={targetGroupId}
                disabled={busy}
                onChange={(e) => setTargetGroupId(e.target.value)}
                className={fieldClass}
              >
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              <span className="text-sm text-neutral-500 dark:text-neutral-400">起始日期</span>
              <input
                type="date"
                value={startDate}
                disabled={busy}
                onChange={(e) => setStartDate(e.target.value)}
                className={fieldClass}
              />
              <DateWeekdayHint value={startDate} />
              <button
                type="button"
                disabled={busy || !templateId || !targetGroupId}
                onClick={handleApply}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                套用
              </button>
            </div>
          </>
        )}
      </section>

      <section className="border-t border-neutral-100 dark:border-neutral-700 pt-4">
        <h3 className="mb-1 text-sm font-medium text-neutral-800 dark:text-neutral-100">從分組存成範本</h3>
        <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
          把一個已經排好的分組存起來,下個專案直接拿來用。範本是全站共用的,不限這個看板。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sourceGroupId}
            disabled={busy}
            onChange={(e) => setSourceGroupId(e.target.value)}
            className={fieldClass}
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <input
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="範本名稱,例如 POC 標準流程"
            className={`${fieldClass} w-48`}
          />
          <input
            value={description}
            disabled={busy}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="說明(選填)"
            className={`${fieldClass} w-48`}
          />
          <button
            type="button"
            disabled={busy || !sourceGroupId || !name.trim()}
            onClick={handleCapture}
            className="rounded-md border border-neutral-300 dark:border-neutral-600 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
          >
            存成範本
          </button>
        </div>
      </section>
    </Modal>
  );
}
