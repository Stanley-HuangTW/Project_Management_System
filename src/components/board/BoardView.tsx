"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Table2, LayoutGrid, GanttChartSquare, BarChart3, ShieldAlert, Bug, DoorOpen, FileDiff, Wallet } from "lucide-react";
import type { BoardWithData, UserOption, ExternalPredecessor } from "@/types/board";
import type { Holiday, UserRole } from "@prisma/client";
import { canManageBoard, canManageStructure } from "@/lib/permissions";
import { resolveStatusColumn } from "@/lib/dashboard";
import { EditHistoryProvider } from "./EditHistoryProvider";
import { OwnerDefaultPctProvider } from "./OwnerDefaultPctContext";
import { ItemProtoUnitsProvider } from "./ItemProtoUnitsContext";
import { useHelpHint } from "@/components/help/helpHint";
import { BoardTable } from "./BoardTable";
import type { ItemEventSummary } from "@/lib/itemEvents";
import { BoardKanban } from "./BoardKanban";
import { BoardGantt } from "./BoardGantt";
import { BoardReport } from "./BoardReport";
import { AddColumnDialog } from "./AddColumnDialog";
import { ImportWizard } from "./ImportWizard";
import { ResourceMappingModal } from "./ResourceMappingModal";
import { AutomationRulesModal } from "./AutomationRulesModal";
import { TrashModal } from "./TrashModal";
import { ProjectTemplateModal } from "./ProjectTemplateModal";
import { BoardRisks } from "./BoardRisks";
import { BoardMantisIssues } from "./BoardMantisIssues";
import { BoardGates } from "./BoardGates";
import { BoardChanges } from "./BoardChanges";
import { BoardBudget } from "@/components/budget/BoardBudget";
import {
  useRegisterBoardAdminActions,
  type BoardAdminAction,
} from "./BoardAdminActions";
import { ExportGanttModal } from "./ExportGanttModal";
import { GroupRolesModal } from "./GroupRolesModal";
import type { ProtoUnitsData } from "./ItemProtoUnitsContext";
import type { BoardMemory } from "@/lib/uiPrefs";
import { useBoardMemorySaver } from "./useBoardMemory";

export function BoardView({
  board,
  users,
  userRole,
  currentUserId,
  highlightItemId,
  highlightNonce,
  highlightTab,
  initialView,
  openRiskId,
  openAction,
  holidays,
  ownerDefaultPct,
  externalPreds,
  hasMantis,
  eventSummaries,
  protoUnits,
  deputyTeam = [],
  memory = null,
}: {
  /** 這個人上次在這塊看板停在哪個分頁、表格與甘特圖捲到哪裡……(帳號上存的),一打開就回到那裡。網址指定了分頁就以網址為主。 */
  memory?: BoardMemory | null;
  board: BoardWithData;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  /** 這個人(副主管)負責的部門的人——「我的團隊」除了自己的下轄,還要加上他們。 */
  deputyTeam?: string[];
  highlightItemId?: string | null;
  /** 隨每次點擊都不同的值(時間戳記)——同一個項目被連點兩次,highlightItemId
   *  本身不會變,得靠這個才分得出「又點了一次」跟「沒事」。 */
  highlightNonce?: string | null;
  /** 打開 highlight 那個項目時停在哪一個分頁(updates / card / links / checklist……);沒給就是「更新」。 */
  highlightTab?: string | null;
  /** ?view=risks 這種連結來的(儀表板的風險與議題清單):一打開就停在那個分頁,沒給或不認得就是表格。 */
  initialView?: string | null;
  /** ?risk=… 這種連結來的(儀表板、對話、通知):風險分頁一打開就直接開那一筆。 */
  openRiskId?: string | null;
  /** ?openAction=import 這種連結來的——側邊欄點了「更多操作」時這塊看板
   *  還沒打開,沒辦法直接呼叫 openAdminAction,先導航過來、掛載後自己開。 */
  openAction?: string | null;
  holidays: Holiday[];
  /** 只掛在負責人欄位、沒有人員分配的工作項,算幾 % 的工作量(系統設定)。 */
  ownerDefaultPct: number;
  /** 已經被指到的外部前置,甘特圖用來畫那一列。 */
  externalPreds: ExternalPredecessor[];
  /** 這個看板有連到 MantisBT:多一個「問題」分頁。 */
  hasMantis: boolean;
  /** 表格最右邊「進行中時間、完成時間、更新記錄」三欄的資料(只含看得到的項目)。 */
  eventSummaries?: Record<string, ItemEventSummary>;
  /** 表格「使用樣機」欄的資料:看板可選的樣機,與每個工作項用到哪幾台。 */
  protoUnits?: ProtoUnitsData;
}) {
  const [view, setView] = useState<"table" | "kanban" | "gantt" | "report" | "risks" | "issues" | "gates" | "changes" | "budget">(
    () => {
      if (initialView === "risks" || initialView === "gates" || initialView === "changes" || initialView === "gantt" || (initialView === "issues" && hasMantis)) return initialView;
      // 網址沒指定分頁(也沒有 highlight 連結)就回到這個人上次停的分頁。
      const last = memory?.view;
      if (!highlightItemId && !openRiskId && !openAction && last && last !== "issues" && ["table", "kanban", "gantt", "report", "risks", "gates", "changes", "budget"].includes(last)) {
        return last as "table" | "kanban" | "gantt" | "report" | "risks" | "gates" | "changes" | "budget";
      }
      return "table";
    }
  );
  // 記住這個人在這塊看板上的畫面(分頁、捲動位置、甘特圖的刻度……),下次打開回到那裡。
  const remember = useBoardMemorySaver(board.id, memory);
  // 表格與甘特圖各自記捲動位置;其他分頁(看板、報表、風險、閘門、變更、預算……)共用外面這個捲動區,
  // 這裡依分頁記:切過去時回到上次捲到的地方(內容是非同步載入的,所以每 0.1 秒試一次,最多 2 秒)。
  const wrapRef = useRef<HTMLDivElement>(null);
  const scrollMemo = useRef<Record<string, { top: number; left: number }>>({ ...(memory?.scroll ?? {}) });
  const restoringRef = useRef(false);
  useEffect(() => {
    if (view === "table" || view === "gantt") return;
    const el = wrapRef.current;
    if (!el) return;
    const target = scrollMemo.current[view];
    el.scrollTop = 0;
    el.scrollLeft = 0;
    if (!target || (target.top === 0 && target.left === 0)) return;
    restoringRef.current = true;
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      el.scrollTop = target.top;
      el.scrollLeft = target.left;
      if ((Math.abs(el.scrollTop - target.top) <= 2 && Math.abs(el.scrollLeft - target.left) <= 2) || tries >= 20) {
        clearInterval(id);
        restoringRef.current = false;
      }
    }, 100);
    return () => {
      clearInterval(id);
      restoringRef.current = false;
    };
  }, [view]);
  const viewSeenRef = useRef(view);
  useEffect(() => {
    if (viewSeenRef.current === view) return;
    viewSeenRef.current = view;
    remember({ view });
  }, [view, remember]);
  // 看板欄的「本週完成」以實際切成完成的時間為準。
  const completedAtByItem = useMemo(
    () => Object.fromEntries(Object.entries(eventSummaries ?? {}).flatMap(([id, s]) => (s.completedAt ? [[id, s.completedAt]] : []))),
    [eventSummaries]
  );
  // A ?highlight= link (notifications, overdue tasks, workload detail) can
  // be clicked from any tab — jump to the table view so BoardTable actually
  // mounts and opens the item's card, instead of silently updating the URL
  // behind whichever tab (e.g. 報表) happens to be showing.
  const highlightKey = highlightItemId ? `${highlightItemId}#${highlightNonce ?? ""}` : null;
  const [prevHighlightKey, setPrevHighlightKey] = useState(highlightKey);
  if (highlightKey !== prevHighlightKey) {
    setPrevHighlightKey(highlightKey);
    // 網址帶 view=gantt(例如儀表板的樣機使用時程點工作項)就留在甘特圖,由甘特圖捲到那一列標出來。
    if (highlightItemId) setView(initialView === "gantt" ? "gantt" : "table");
  }
  // Once the Gantt has been opened it stays mounted, so switching to the table
  // and back keeps its zoom, display scale, filters, collapsed rows, column
  // width and scroll position instead of resetting to the default view.
  const [ganttMounted, setGanttMounted] = useState(false);
  if (view === "gantt" && !ganttMounted) setGanttMounted(true);
  // 右下角的「?」要開手冊的哪一章,看這個看板現在在哪個分頁(切分頁不會改網址)。
  useHelpHint(`board:${view}`);

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resourceMappingOpen, setResourceMappingOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);

  const statusColumns = board.columns.filter((c) => c.type === "STATUS");
  // 看板檢視預設依名為「Status」的欄位分組(沒有就用第一個狀態欄位)。
  const [kanbanColumnId, setKanbanColumnId] = useState(
    resolveStatusColumn(board)?.id ?? ""
  );
  const progressColumn = board.columns.find(
    (c) => c.id === board.progressColumnId
  );

  // 匯入/匯出/Resource 對應/自動化 are occasional board-admin tasks, so they
  // hang off the board's "…" in the sidebar instead of taking up room in the
  // header next to the views the user switches between all day. The modals
  // stay here, where the board's columns/groups/items already are.
  const adminActions = useMemo<BoardAdminAction[]>(() => {
    const list: BoardAdminAction[] = [];
    if (canManageBoard(userRole)) list.push("import", "export", "resources");
    if (canManageStructure(userRole)) list.push("automation", "templates", "trash");
    // 看板角色:管理者與看板擁有者。
    if (userRole === "ADMIN" || board.ownerId === currentUserId) list.push("roles");
    return list;
  }, [userRole, board.ownerId, currentUserId]);
  const openAdminAction = useCallback((action: BoardAdminAction) => {
    if (action === "import") setImportOpen(true);
    else if (action === "export") setExportOpen(true);
    else if (action === "resources") setResourceMappingOpen(true);
    else if (action === "trash") setTrashOpen(true);
    else if (action === "templates") setTemplatesOpen(true);
    else if (action === "roles") setRolesOpen(true);
    else setAutomationOpen(true);
  }, []);
  useRegisterBoardAdminActions(board.id, adminActions, openAdminAction);

  const router = useRouter();
  // 側邊欄在別的頁面點「更多操作」時,這塊看板還沒掛載、還沒 register,
  // 只能先導航到這裡、帶著要開的動作,掛載完再由這裡自己打開——跟上面
  // highlightItemId 同一個做法:比對 prop 有沒有變,渲染當下直接處理。
  // prevOpenAction 的初始值故意跟 openAction 錯開(而不是拿 openAction 自己
  // 當初始值)——不然「打開這塊看板時 openAction 就已經有值」這個最常見的
  // 情況,第一次 render 就會判斷成「沒有變」,動作永遠不會被打開。
  const [prevOpenAction, setPrevOpenAction] = useState<string | null>(null);
  if ((openAction ?? null) !== prevOpenAction) {
    setPrevOpenAction(openAction ?? null);
    if (openAction && adminActions.includes(openAction as BoardAdminAction)) {
      openAdminAction(openAction as BoardAdminAction);
    }
  }
  // 網址上的查詢參數只是拿來觸發一次性的動作,開完就拿掉,不然重新整理這頁
  // 又會再彈一次。
  useEffect(() => {
    if (openAction) router.replace(`/boards/${board.id}`);
  }, [openAction, router, board.id]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-3 sm:px-6 sm:py-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{board.name}</h1>
            {board.visibility === "RESTRICTED" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                限制存取
              </span>
            )}
          </div>
          {progressColumn && (
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              進度欄位:{progressColumn.name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-700">
            <button
              type="button"
              onClick={() => setView("table")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "table"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <Table2 size={14} /> <span className="hidden sm:inline">表格</span>
            </button>
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "kanban"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <LayoutGrid size={14} /> <span className="hidden sm:inline">看板</span>
            </button>
            <button
              type="button"
              onClick={() => setView("gantt")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "gantt"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <GanttChartSquare size={14} /> <span className="hidden sm:inline">甘特圖</span>
            </button>
            <button
              type="button"
              onClick={() => setView("report")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "report"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <BarChart3 size={14} /> <span className="hidden sm:inline">報表</span>
            </button>
            <button
              type="button"
              onClick={() => setView("risks")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "risks"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <ShieldAlert size={14} /> <span className="hidden sm:inline">風險</span>
            </button>
            {hasMantis && (
              <button
                type="button"
                onClick={() => setView("issues")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                  view === "issues"
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                    : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                }`}
              >
                <Bug size={14} /> <span className="hidden sm:inline">問題</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setView("gates")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "gates"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <DoorOpen size={14} /> <span className="hidden sm:inline">閘門</span>
            </button>
            <button
              type="button"
              onClick={() => setView("changes")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "changes"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <FileDiff size={14} /> <span className="hidden sm:inline">變更</span>
            </button>
            <button
              type="button"
              onClick={() => setView("budget")}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${
                view === "budget"
                  ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900"
                  : "bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              }`}
            >
              <Wallet size={14} /> <span className="hidden sm:inline">預算</span>
            </button>
          </div>
        </div>
      </div>

      <OwnerDefaultPctProvider value={ownerDefaultPct}>
      <ItemProtoUnitsProvider data={protoUnits ?? null}>
      <EditHistoryProvider key={board.id} board={board}>
      <div
        ref={wrapRef}
        onScroll={(e) => {
          if (view === "table" || view === "gantt" || restoringRef.current) return;
          const pos = { top: Math.round(e.currentTarget.scrollTop), left: Math.round(e.currentTarget.scrollLeft) };
          scrollMemo.current[view] = pos;
          remember({ scroll: { [view]: pos } });
        }}
        className={`flex-1 p-3 sm:p-6 ${view === "table" ? "overflow-hidden" : "overflow-auto"}`}
      >
        {view === "table" && (
          <BoardTable
            board={board}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
            onAddColumn={() => setAddColumnOpen(true)}
            highlightItemId={highlightItemId}
            highlightNonce={highlightNonce}
            highlightTab={highlightTab}
            holidays={holidays}
            eventSummaries={eventSummaries}
            protoUnits={protoUnits}
            initialTop={memory?.tableTop}
            onTop={(top) => remember({ tableTop: top })}
            initialLeft={memory?.tableLeft}
            onLeft={(left) => remember({ tableLeft: left })}
          />
        )}
        {view === "kanban" && (
          <BoardKanban
            board={board}
            statusColumns={statusColumns}
            columnId={kanbanColumnId || statusColumns[0]?.id || ""}
            onChangeColumn={setKanbanColumnId}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
            deputyTeam={deputyTeam}
            holidays={holidays}
            completedAtByItem={completedAtByItem}
          />
        )}
        {ganttMounted && (
          <BoardGantt
            board={board}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
            holidays={holidays}
            active={view === "gantt"}
            highlightItemId={highlightItemId}
            highlightNonce={highlightNonce}
            externalPreds={externalPreds}
            completedAtByItem={completedAtByItem}
            ownerDefaultPct={ownerDefaultPct}
            memory={memory?.gantt}
            onMemory={remember}
          />
        )}
        {view === "risks" && (
          <BoardRisks key={openRiskId ?? "none"} board={board} users={users} currentUserId={currentUserId} openRiskId={openRiskId ?? null} />
        )}
        {view === "issues" && hasMantis && (
          <BoardMantisIssues boardId={board.id} users={users} isAdmin={userRole === "ADMIN"} />
        )}
        {view === "changes" && <BoardChanges board={board} userRole={userRole} />}
        {view === "budget" && <BoardBudget board={board} />}
        {view === "gates" && (
          <BoardGates
            board={board}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
          />
        )}
        {view === "report" && (
          <BoardReport
            board={board}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
            deputyTeam={deputyTeam}
            holidays={holidays}
          />
        )}
      </div>
      </EditHistoryProvider>
      </ItemProtoUnitsProvider>
      </OwnerDefaultPctProvider>

      {canManageStructure(userRole) && (
        <AddColumnDialog
          boardId={board.id}
          open={addColumnOpen}
          onOpenChange={setAddColumnOpen}
        />
      )}

      {canManageBoard(userRole) && (
        <ExportGanttModal
          board={board}
          open={exportOpen}
          onOpenChange={setExportOpen}
        />
      )}

      {canManageBoard(userRole) && (
        <ImportWizard
          boardId={board.id}
          columns={board.columns}
          groups={board.groups}
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      )}

      {canManageBoard(userRole) && (
        <ResourceMappingModal
          boardId={board.id}
          columns={board.columns}
          users={users}
          open={resourceMappingOpen}
          onOpenChange={setResourceMappingOpen}
        />
      )}

      {canManageStructure(userRole) && (
        <AutomationRulesModal
          boardId={board.id}
          columns={board.columns}
          groups={board.groups}
          users={users}
          open={automationOpen}
          onOpenChange={setAutomationOpen}
        />
      )}

      {canManageStructure(userRole) && (
        <TrashModal boardId={board.id} open={trashOpen} onOpenChange={setTrashOpen} />
      )}

      {canManageStructure(userRole) && (
        <ProjectTemplateModal groups={board.groups} open={templatesOpen} onOpenChange={setTemplatesOpen} />
      )}

      {(userRole === "ADMIN" || board.ownerId === currentUserId) && (
        <GroupRolesModal
          mode="board"
          boardId={board.id}
          group={{
            id: board.id,
            name: board.name,
            roleAssignments: board.roleAssignments,
            roleOverrides: [],
            members: board.disciplineMembers,
            memberOverrides: [],
            resourceMembers: board.resourceMembers,
            resourceOverride: false,
          }}
          users={users}
          open={rolesOpen}
          onOpenChange={setRolesOpen}
        />
      )}

    </div>
  );
}
