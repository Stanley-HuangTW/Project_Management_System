"use client";

import { deleteItem, previewItemDeletion, type DeletionImpact } from "@/lib/actions/item";
import { useDialogs } from "@/components/ui/DialogProvider";

const MAX_LISTED = 12;

function listDependents(impact: DeletionImpact): string[] {
  const shown = impact.dependents.slice(0, MAX_LISTED);
  const lines = shown.map(
    (d) => `・${d.wbsCode} ${d.name}${d.start ? `(${d.start}~${d.end})` : ""}`
  );
  if (impact.dependents.length > shown.length) {
    lines.push(`・…另外還有 ${impact.dependents.length - shown.length} 項`);
  }
  return lines;
}

/**
 * Deleting an item that others use as their Pred silently rewrites their
 * schedule, so this asks first: either the chain closes up (they inherit this
 * item's own predecessor) or they are cut loose and told which ones now need
 * a start(set) or a Pred/Link/Lag of their own.
 */
export function useDeleteItem() {
  const { confirm, choose, notify } = useDialogs();

  return async function requestDelete(boardId: string, itemId: string) {
    const impact = await previewItemDeletion(itemId);
    if (!impact) return;

    if (impact.dependents.length === 0) {
      const ok = await confirm(`確定要刪除「${impact.name}」嗎?此操作無法復原。`, {
        title: "刪除項目",
        confirmLabel: "刪除",
        danger: true,
      });
      if (ok) await deleteItem(boardId, itemId);
      return;
    }

    const header = [
      `以下 ${impact.dependents.length} 個工作項以「${impact.name}」為前置依賴:`,
      ...listDependents(impact),
      "",
    ];

    // Only offer the inherit option when there is actually something to
    // inherit — otherwise it would just be a second way to clear the field.
    const choice = impact.inherit
      ? await choose(
          [
            ...header,
            `「${impact.name}」自己的前置是「${impact.inherit.wbsCode} ${impact.inherit.name}」。`,
            "要讓上面這些工作項改為參照它嗎?",
          ].join("\n"),
          {
            title: "刪除項目",
            choices: [
              { key: "inherit", label: `改為參照「${impact.inherit.wbsCode} ${impact.inherit.name}」並刪除` },
              { key: "detach", label: "不參照,清空它們的前置並刪除", danger: true },
            ],
          }
        )
      : (await confirm(
            [...header, `刪除後它們會失去前置依賴,時間停在目前算出的值。`].join("\n"),
            { title: "刪除項目", confirmLabel: "清空它們的前置並刪除", danger: true }
          ))
        ? "detach"
        : null;

    if (!choice) return;

    await deleteItem(boardId, itemId, choice === "inherit");

    if (choice === "detach") {
      await notify(
        [
          `「${impact.name}」已刪除,以下工作項已失去前置依賴,請確認要改設固定的 start(set),還是重新指定 Pred / Link / Lag:`,
          ...listDependents(impact),
        ].join("\n"),
        { title: "請確認這些工作項的時程" }
      );
    }
  };
}
