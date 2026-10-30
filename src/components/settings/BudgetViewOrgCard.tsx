"use client";

import { useMemo, useState, useTransition } from "react";
import { useDialogs } from "@/components/ui/DialogProvider";
import { setBudgetViewOrgNodes } from "@/lib/actions/budgetAccess";
import { flattenOrgForest, type OrgNodeLite } from "@/lib/orgTree";
import { actionErrorMessage } from "@/lib/userError";

/**
 * 預算可見範圍:看得到看板不等於看得到預算金額。管理者、看板擁有者、專案負責角色(Team Leader、PMD、PM DM)
 * 與看板指名的人本來就看得到;這裡再挑組織——被勾的組織的主管,對所有看板都看得到預算金額(例如勾「研發處」
 * 或最上層的公司,讓處長、負責人不用一塊一塊看板去指名)。
 */
export function BudgetViewOrgCard({
  nodes,
  initial,
  users,
}: {
  nodes: OrgNodeLite[];
  initial: string[];
  users: { id: string; name: string }[];
}) {
  const { notify } = useDialogs();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const tree = useMemo(() => flattenOrgForest(nodes), [nodes]);
  const nameOf = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const dirty = draft.length !== saved.length || draft.some((id) => !saved.includes(id));

  function toggle(id: string) {
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function save() {
    startTransition(async () => {
      try {
        const result = await setBudgetViewOrgNodes(draft);
        if (result.error) {
          await notify(result.error, { title: "預算可見範圍" });
          return;
        }
        setSaved(draft);
      } catch (err) {
        await notify(actionErrorMessage(err, "無法儲存"), { title: "預算可見範圍" });
      }
    });
  }

  return (
    <div className="max-w-xl rounded-lg border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-700 dark:bg-neutral-900">
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">預算可見範圍</p>
      <p className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
        看得到看板<b>不等於</b>看得到預算金額(階段預算、NRE 報價單、樣機 BOM、人力規劃彙總、成本與 EVM、預算警示)。
        預算只給:管理者、看板擁有者、看板上的 <b>Team Leader、PMD、PM DM</b>、各看板「看板分享設定」裡指名的人,
        以及下面勾選的組織的<b>主管</b>(對所有看板有效)。其他人——包含只是被加進成員名單的人、各職能 DM、QA——看不到金額。
      </p>

      {tree.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">組織架構圖還沒有部門。</p>
      ) : (
        <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-700">
          {tree.map(({ node, depth }) => (
            <li key={node.id} style={{ paddingLeft: `${(depth - 1) * 16}px` }}>
              <label className="flex items-center gap-2 py-0.5 text-sm text-neutral-800 dark:text-neutral-100">
                <input type="checkbox" checked={draft.includes(node.id)} disabled={isPending} onChange={() => toggle(node.id)} />
                {node.name}
                <span className="text-xs text-neutral-400 dark:text-neutral-500">
                  {node.headId ? `主管:${nameOf.get(node.headId) ?? "—"}` : "還沒有主管"}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={!dirty || isPending}
          onClick={save}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isPending ? "儲存中..." : "儲存"}
        </button>
        {dirty && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setDraft(saved)}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            取消
          </button>
        )}
      </div>
    </div>
  );
}
