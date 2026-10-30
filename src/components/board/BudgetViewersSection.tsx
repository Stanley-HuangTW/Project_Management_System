"use client";

import { useEffect, useState } from "react";
import { UserSelect } from "@/components/ui/UserSelect";
import {
  addBoardBudgetViewer,
  listBoardBudgetViewers,
  removeBoardBudgetViewer,
  type BudgetViewerInfo,
} from "@/lib/actions/budgetAccess";
import type { UserOption } from "@/types/board";
import { actionErrorMessage } from "@/lib/userError";

/**
 * 看板分享設定裡「可以看預算金額的人」:看得到看板不等於看得到預算。管理者、看板擁有者、
 * 這塊看板上的 Team Leader / PMD / PM DM,以及系統設定裡指定組織的主管本來就看得到;
 * 其他人要看預算,在這裡指名。
 */
export function BudgetViewersSection({ boardId, users }: { boardId: string; users: UserOption[] }) {
  const [info, setInfo] = useState<BudgetViewerInfo | null>(null);
  const [addUserId, setAddUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listBoardBudgetViewers(boardId);
        if (!cancelled) setInfo(result);
      } catch (err) {
        if (!cancelled) setError(actionErrorMessage(err, "讀取失敗"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  async function change(work: () => Promise<{ error?: string }>, failure: string) {
    setError(null);
    try {
      const result = await work();
      if (result.error) {
        setError(result.error);
        return;
      }
      setInfo(await listBoardBudgetViewers(boardId));
      setAddUserId("");
    } catch (err) {
      setError(actionErrorMessage(err, failure));
    }
  }

  const named = new Set((info?.viewers ?? []).map((v) => v.userId));
  const candidates = users.filter((u) => !u.isResource && !named.has(u.id));

  return (
    <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-700" data-budget-viewers>
      <p className="mb-1 text-sm font-medium text-neutral-900 dark:text-neutral-100">可以看預算金額的人</p>
      <p className="mb-2 text-xs text-neutral-500 dark:text-neutral-400">
        看得到看板<b>不等於</b>看得到預算(階段預算、NRE 報價單、樣機 BOM、人力規劃彙總、成本與 EVM、預算警示)。
        {info && (
          <>
            {" "}本來就看得到的:管理者、擁有者{info.inherent.owner ? `(${info.inherent.owner})` : ""}
            {info.inherent.roles.map((r) => `、${r.role}(${r.names.join("、")})`).join("")},以及系統設定裡指定組織的主管。
            其他人要看,在下面指名。
          </>
        )}
      </p>
      {error && <div className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <div className="mb-2 flex items-center gap-2">
        <UserSelect
          users={candidates}
          value={addUserId}
          onChange={setAddUserId}
          placeholder="選擇要指名的人"
          className="flex-1 rounded-md border border-neutral-300 px-2 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900"
        />
        <button
          type="button"
          disabled={!addUserId}
          onClick={() => change(() => addBoardBudgetViewer(boardId, addUserId), "新增失敗")}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          指名
        </button>
      </div>

      {info === null ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">載入中...</p>
      ) : info.viewers.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">還沒有另外指名的人。</p>
      ) : (
        <ul className="space-y-1">
          {info.viewers.map((v) => (
            <li
              key={v.userId}
              data-budget-viewer={v.userId}
              className="flex items-center justify-between rounded-md border border-neutral-200 px-2 py-1.5 text-sm dark:border-neutral-700"
            >
              <span className="text-neutral-800 dark:text-neutral-100">{v.name}</span>
              <button
                type="button"
                onClick={() => change(() => removeBoardBudgetViewer(boardId, v.userId), "移除失敗")}
                className="text-neutral-400 hover:text-red-600 dark:text-neutral-500"
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
