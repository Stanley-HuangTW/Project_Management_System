"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { describeEvent, describeRiskEvent, eventTargetField, eventTargetTab, formatEventTime, type ItemDetailTab } from "@/lib/itemEvents";
import type { UpdateFeedRow } from "@/lib/updateFeed";
import { EventBadge } from "@/components/board/EventBadge";
import { ItemDetailModal } from "@/components/board/ItemDetailModal";
import { loadItemDetailContext, type ItemDetailContext } from "@/lib/actions/itemSchedule";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { UserOption } from "@/types/board";

const selectClass =
  "rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-700 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100";

/**
 * 更新記錄頁:一筆一筆列出,格式跟通知列表一樣(類型標籤、看板 › 分組、WBS 與項目名稱、改了什麼、誰・什麼時候)。
 * 工作項的更新、風險與議題的新增 / 指派 / 變更都在這裡。預設只看「與我有關」的(我做的、指派給我的、我負責或審核的),
 * 可以切到「全部」,再依看板、人、類型篩選;點一筆就地打開那個工作項的詳細資訊(停在對應的分頁、標出改的欄位),
 * 不離開這一頁;風險與議題沒有工作項詳細資訊,跳到那個看板的風險分頁。
 */
export function UpdateFeed({
  rows,
  users,
  currentUserId,
  userRole,
}: {
  rows: UpdateFeedRow[];
  users: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const router = useRouter();
  const { notify } = useDialogs();
  // 工作項的更新:就地打開項目詳細資訊(對應的分頁、欄位),不離開這一頁、不跳到看板表格。
  const [detail, setDetail] = useState<{ context: ItemDetailContext; tab: ItemDetailTab; field: string | null } | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [board, setBoard] = useState("");
  const [actor, setActor] = useState("");
  const [type, setType] = useState("");

  const mineCount = useMemo(() => rows.filter((r) => r.mine).length, [rows]);
  const scoped = useMemo(() => (scope === "mine" ? rows.filter((r) => r.mine) : rows), [rows, scope]);
  const shown = useMemo(
    () => scoped.map((row) => ({ row, view: row.risk ? describeRiskEvent(row.summary) : describeEvent(row) })),
    [scoped]
  );
  const boards = useMemo(() => [...new Map(scoped.map((r) => [r.boardId, r.boardName])).entries()], [scoped]);
  const actors = useMemo(() => [...new Set(scoped.map((r) => r.actorName).filter((n): n is string => !!n))].sort(), [scoped]);
  const types = useMemo(() => [...new Set(shown.map((s) => s.view.label))], [shown]);

  const filtered = shown.filter(
    ({ row, view }) => (!board || row.boardId === board) && (!actor || row.actorName === actor) && (!type || view.label === type)
  );

  async function open(row: UpdateFeedRow) {
    // 風險 / 議題沒有工作項詳細資訊:直接開那個看板的風險分頁。
    if (row.risk) {
      router.push(`/boards/${row.boardId}?view=risks&risk=${row.risk.id}`);
      return;
    }
    setOpeningId(row.id);
    try {
      const context = await loadItemDetailContext(row.itemId);
      if (!context) {
        await notify("找不到這個項目,或者沒有存取權限");
        return;
      }
      setDetail({ context, tab: eventTargetTab(row.kind), field: eventTargetField(row.kind, row.summary) });
    } catch (err) {
      await notify(err instanceof Error ? err.message : "載入失敗");
    } finally {
      setOpeningId(null);
    }
  }

  const tab = (key: "mine" | "all", label: string, count: number) => (
    <button
      type="button"
      onClick={() => {
        setScope(key);
        setBoard("");
        setActor("");
        setType("");
      }}
      aria-pressed={scope === key}
      className={`rounded-full border px-2.5 py-0.5 text-xs ${
        scope === key
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {label} {count}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tab("mine", "與我有關", mineCount)}
        {tab("all", "全部", rows.length)}
        <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />
        <select value={board} onChange={(e) => setBoard(e.target.value)} className={selectClass} aria-label="看板">
          <option value="">全部看板</option>
          {boards.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select value={actor} onChange={(e) => setActor(e.target.value)} className={selectClass} aria-label="人">
          <option value="">所有人</option>
          {actors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={selectClass} aria-label="類型">
          <option value="">全部類型</option>
          {types.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{filtered.length} 筆</span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 py-10 text-center text-sm text-neutral-400 dark:border-neutral-700 dark:text-neutral-500">
          {scope === "mine" && rows.length > 0 && mineCount === 0
            ? "目前沒有跟你有關的更新。要看整個看板上發生的事,請按上面的「全部」。"
            : "沒有符合的更新記錄。"}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-700 dark:bg-neutral-900">
          {filtered.map(({ row, view }) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => void open(row)}
                disabled={openingId === row.id}
                data-update-row={row.id}
                className="flex w-full flex-col gap-1 px-4 py-2.5 text-left hover:bg-neutral-50 disabled:opacity-60 dark:hover:bg-neutral-800"
              >
                <span className="flex items-center gap-1.5">
                  <EventBadge label={view.label} tone={view.tone} />
                  <span className="min-w-0 truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                    {row.boardName}
                    <span className="mx-1">›</span>
                    {row.groupName}
                  </span>
                </span>
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {row.wbsCode && <span className="mr-1.5 font-normal tabular-nums text-neutral-400 dark:text-neutral-500">{row.wbsCode}</span>}
                  {row.itemName}
                </span>
                <span className="break-words text-xs text-neutral-600 dark:text-neutral-300">{view.message}</span>
                <span className="text-[11px] text-neutral-400 dark:text-neutral-500">
                  {row.actorName ?? "系統"}・{formatEventTime(row.at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ItemDetailModal
        boardId={detail?.context.boardId ?? ""}
        item={detail?.context.item ?? null}
        columns={detail?.context.columns ?? []}
        users={users}
        progressColumnId={detail?.context.progressColumnId ?? null}
        ganttStartColumnId={detail?.context.ganttStartColumnId}
        ganttDurationColumnId={detail?.context.ganttDurationColumnId}
        ganttEndColumnId={detail?.context.ganttEndColumnId}
        predColumnId={detail?.context.predColumnId}
        linkColumnId={detail?.context.linkColumnId}
        groupItems={detail?.context.groupItems}
        userRole={userRole}
        currentUserId={currentUserId}
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        initialTab={detail?.tab ?? "updates"}
        highlightField={detail?.field ?? null}
      />
    </div>
  );
}
