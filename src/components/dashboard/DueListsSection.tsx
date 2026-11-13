"use client";

import { useState } from "react";
import { Minus, Plus, Maximize2, Minimize2 } from "lucide-react";
import { groupByBoardAndGroup } from "@/lib/boardGrouping";
import type { DueItemEntry } from "@/lib/dashboard";
import { loadItemDetailContext, type ItemDetailContext } from "@/lib/actions/itemSchedule";
import { ItemDetailModal } from "@/components/board/ItemDetailModal";
import { useDialogs } from "@/components/ui/DialogProvider";
import type { UserOption } from "@/types/board";
import { shortWithWeekday } from "@/lib/weekdayLabel";
import type { UserRole } from "@prisma/client";
import { actionErrorMessage } from "@/lib/userError";

const STORAGE_KEY = "dashboard-due-lists-view";

const ZOOM_STEPS = [60, 70, 80, 90, 100, 110, 125, 150];
const HEIGHTS = [320, 480, 640, 900];

type StoredView = { zoom: number; height: number };

function loadStoredView(): StoredView | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredView) : null;
  } catch {
    return null;
  }
}

function formatDate(date: Date) {
  return shortWithWeekday(`${date.getUTCMonth() + 1}/${date.getUTCDate()}`, date.toISOString().slice(0, 10));
}

/**
 * 逾期 / 本週完成 / 未來 7 天 / 未來 30 天,四段各自獨立、按時間排序
 * (computeDashboardDueLists 保證每一筆只會落在其中一類)。
 *
 * 四份清單加起來可能有兩百多筆,預設的字級一次只看得到十來條。縮放用的是
 * CSS `zoom` 而不是 transform:scale —— zoom 會讓版面跟著重排,縮小就真的
 * 多塞得下幾條;scale 只是把同樣大小的東西畫小,旁邊留一片空白。
 *
 * 縮放與高度記在瀏覽器裡,因為那是「這台機器這個螢幕」的偏好,不是專案
 * 設定 —— 同一個人換一台筆電看,合適的大小本來就不一樣。
 *
 * 點項目名稱直接跳出項目卡片彈窗(跟看板裡點項目同一個元件),不用跳轉到
 * 那個看板的表格畫面——關掉彈窗畫面留在儀表板。彈窗狀態放在這一層,四份
 * 清單共用同一個,不用各開各的。
 */
export function DueListsSection({
  overdue,
  completedThisWeek,
  upcoming7,
  upcoming30,
  allUsers,
  currentUserId,
  userRole,
}: {
  overdue: DueItemEntry[];
  completedThisWeek: DueItemEntry[];
  upcoming7: DueItemEntry[];
  upcoming30: DueItemEntry[];
  allUsers: UserOption[];
  currentUserId: string;
  userRole: UserRole;
}) {
  const { notify } = useDialogs();
  const [zoom, setZoom] = useState(() => {
    const stored = loadStoredView()?.zoom;
    return stored && ZOOM_STEPS.includes(stored) ? stored : 100;
  });
  const [height, setHeight] = useState(() => loadStoredView()?.height || 480);
  const [expanded, setExpanded] = useState(false);
  const [itemDetail, setItemDetail] = useState<ItemDetailContext | null>(null);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);

  async function openItemDetail(itemId: string) {
    setOpeningItemId(itemId);
    try {
      const context = await loadItemDetailContext(itemId);
      if (!context) {
        await notify("找不到這個項目,或者沒有存取權限");
        return;
      }
      setItemDetail(context);
    } catch (err) {
      await notify(actionErrorMessage(err, "載入失敗"));
    } finally {
      setOpeningItemId(null);
    }
  }

  function persist(next: Partial<StoredView>) {
    const value = { zoom, height, ...next };
    if (next.zoom !== undefined) setZoom(next.zoom);
    if (next.height !== undefined) setHeight(next.height);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // 無痕視窗或封鎖了站台資料 —— 這次能用就好,只是記不住。
    }
  }

  function step(direction: -1 | 1) {
    const index = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))];
    if (next !== zoom) persist({ zoom: next });
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-100">
          待辦事項到期清單
        </h2>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={zoom === ZOOM_STEPS[0]}
            aria-label="縮小"
            title="縮小"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            onClick={() => persist({ zoom: 100 })}
            title="回到 100%"
            className="w-12 rounded px-1 py-0.5 text-center text-xs tabular-nums text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            {zoom}%
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            aria-label="放大"
            title="放大"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 disabled:opacity-30 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            <Plus size={13} />
          </button>

          <span className="mx-1 h-4 w-px bg-neutral-200 dark:bg-neutral-700" />

          <select
            value={height}
            onChange={(e) => persist({ height: Number(e.target.value) })}
            title="清單高度"
            className="rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs text-neutral-600 outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-300"
          >
            {HEIGHTS.map((h) => (
              <option key={h} value={h}>
                {h} px
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "收合" : "展開全部"}
            title={expanded ? "收合成固定高度" : "展開全部,不限制高度"}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DueList
          title={`逾期(${overdue.length})`}
          titleClass="text-red-600"
          dateClass="text-red-600"
          empty="沒有逾期項目"
          entries={overdue}
          zoom={zoom}
          height={expanded ? null : height}
          openingItemId={openingItemId}
          onOpenItem={openItemDetail}
        />
        <DueList
          title={`本週完成(${completedThisWeek.length})`}
          titleClass="text-green-600"
          dateClass="text-green-600"
          empty="本週沒有完成項目"
          entries={completedThisWeek}
          zoom={zoom}
          height={expanded ? null : height}
          openingItemId={openingItemId}
          onOpenItem={openItemDetail}
        />
        <DueList
          title={`未來 7 天(${upcoming7.length})`}
          titleClass="text-neutral-500 dark:text-neutral-400"
          dateClass="text-neutral-500 dark:text-neutral-400"
          empty="未來 7 天沒有到期項目"
          entries={upcoming7}
          zoom={zoom}
          height={expanded ? null : height}
          openingItemId={openingItemId}
          onOpenItem={openItemDetail}
        />
        <DueList
          title={`未來 30 天(${upcoming30.length})`}
          titleClass="text-neutral-500 dark:text-neutral-400"
          dateClass="text-neutral-500 dark:text-neutral-400"
          empty="未來 30 天沒有到期項目"
          entries={upcoming30}
          zoom={zoom}
          height={expanded ? null : height}
          openingItemId={openingItemId}
          onOpenItem={openItemDetail}
        />
      </div>

      <ItemDetailModal
        boardId={itemDetail?.boardId ?? ""}
        item={itemDetail?.item ?? null}
        columns={itemDetail?.columns ?? []}
        users={allUsers}
        progressColumnId={itemDetail?.progressColumnId ?? null}
        ganttStartColumnId={itemDetail?.ganttStartColumnId}
        ganttDurationColumnId={itemDetail?.ganttDurationColumnId}
        ganttEndColumnId={itemDetail?.ganttEndColumnId}
        predColumnId={itemDetail?.predColumnId}
        linkColumnId={itemDetail?.linkColumnId}
        groupItems={itemDetail?.groupItems}
        userRole={userRole}
        currentUserId={currentUserId}
        open={itemDetail !== null}
        onOpenChange={(open) => !open && setItemDetail(null)}
        initialTab="card"
      />
    </section>
  );
}

/**
 * 一份清單,照「看板 → 分組」收起來。
 *
 * 兩百多條名稱平鋪的時候,看不出哪幾條是同一個專案的同一個階段 —— 而那正是
 * 決定「先處理哪一塊」需要的。日期順序不變,分組只是把同一塊的收在一起。
 */
function DueList({
  title,
  titleClass,
  dateClass,
  empty,
  entries,
  zoom,
  height,
  openingItemId,
  onOpenItem,
}: {
  title: string;
  titleClass: string;
  dateClass: string;
  empty: string;
  entries: DueItemEntry[];
  zoom: number;
  /** null = 展開,不限制高度。 */
  height: number | null;
  openingItemId: string | null;
  onOpenItem: (itemId: string) => void;
}) {
  const boards = groupByBoardAndGroup(entries);

  return (
    <div className="rounded-md border border-neutral-200 bg-white p-4 dark:border-neutral-700 dark:bg-neutral-900">
      <p className={`mb-2 text-xs font-medium ${titleClass}`}>{title}</p>
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-400 dark:text-neutral-500">{empty}</p>
      ) : (
        <div
          // zoom 會重排版面,所以縮小是真的多塞得下幾條,不是把同樣的東西畫小。
          style={{ zoom: `${zoom}%`, maxHeight: height === null ? undefined : height }}
          className={height === null ? "" : "overflow-y-auto"}
        >
          <div className="space-y-3">
            {boards.map((board) => (
              <div key={board.boardId}>
                <p className="mb-1 flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  <span className="min-w-0 truncate">{board.boardName}</span>
                  <span className="shrink-0 font-normal text-neutral-400 dark:text-neutral-500">
                    {board.count}
                  </span>
                </p>
                {board.groups.map((group) => (
                  <div key={group.groupId} className="mb-1.5">
                    <p className="truncate pl-1.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                      {group.groupName || "(未分組)"}
                    </p>
                    <ul className="space-y-1">
                      {group.rows.map((e) => (
                        <li
                          key={`${e.boardId}-${e.itemId}`}
                          className="flex items-center justify-between gap-2 pl-3 text-sm"
                        >
                          <button
                            type="button"
                            disabled={openingItemId === e.itemId}
                            onClick={() => onOpenItem(e.itemId)}
                            title={e.itemName}
                            className="min-w-0 truncate text-left text-neutral-700 hover:text-blue-600 hover:underline disabled:opacity-60 dark:text-neutral-100"
                          >
                            {e.wbsCode && (
                              <span className="mr-1.5 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
                                {e.wbsCode}
                              </span>
                            )}
                            {e.itemName}
                          </button>
                          <span className={`shrink-0 text-xs ${dateClass}`}>{formatDate(e.end)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
