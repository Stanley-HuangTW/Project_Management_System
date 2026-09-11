"use client";

import { useCallback, useMemo, useState } from "react";
import { Table2, LayoutGrid, GanttChartSquare, BarChart3, ShieldAlert, DoorOpen, FileDiff } from "lucide-react";
import type { BoardWithData, UserOption } from "@/types/board";
import type { Holiday, UserRole } from "@prisma/client";
import { canManageBoard, canManageStructure } from "@/lib/permissions";
import { BoardTable } from "./BoardTable";
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
import { BoardGates } from "./BoardGates";
import { BoardChanges } from "./BoardChanges";
import {
  useRegisterBoardAdminActions,
  type BoardAdminAction,
} from "./BoardAdminActions";
import { ExportGanttModal } from "./ExportGanttModal";

export function BoardView({
  board,
  users,
  userRole,
  currentUserId,
  highlightItemId,
  holidays,
}: {
  board: BoardWithData;
  users: UserOption[];
  userRole: UserRole;
  currentUserId: string;
  highlightItemId?: string | null;
  holidays: Holiday[];
}) {
  const [view, setView] = useState<"table" | "kanban" | "gantt" | "report" | "risks" | "gates" | "changes">("table");
  const [ganttNavigateHighlight, setGanttNavigateHighlight] = useState<string | null>(null);
  function goToItemInTable(itemId: string) {
    setGanttNavigateHighlight(itemId);
    setView("table");
  }
  // A ?highlight= link (notifications, overdue tasks, workload detail) can
  // be clicked from any tab — jump to the table view so BoardTable actually
  // mounts and opens the item's card, instead of silently updating the URL
  // behind whichever tab (e.g. 報表) happens to be showing.
  const [prevHighlightItemId, setPrevHighlightItemId] = useState(highlightItemId);
  if (highlightItemId !== prevHighlightItemId) {
    setPrevHighlightItemId(highlightItemId);
    if (highlightItemId) setView("table");
  }
  // Once the Gantt has been opened it stays mounted, so switching to the table
  // and back keeps its zoom, display scale, filters, collapsed rows, column
  // width and scroll position instead of resetting to the default view.
  const [ganttMounted, setGanttMounted] = useState(false);
  if (view === "gantt" && !ganttMounted) setGanttMounted(true);

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [resourceMappingOpen, setResourceMappingOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const statusColumns = board.columns.filter((c) => c.type === "STATUS");
  const [kanbanColumnId, setKanbanColumnId] = useState(
    statusColumns[0]?.id ?? ""
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
    return list;
  }, [userRole]);
  const openAdminAction = useCallback((action: BoardAdminAction) => {
    if (action === "import") setImportOpen(true);
    else if (action === "export") setExportOpen(true);
    else if (action === "resources") setResourceMappingOpen(true);
    else if (action === "trash") setTrashOpen(true);
    else if (action === "templates") setTemplatesOpen(true);
    else setAutomationOpen(true);
  }, []);
  useRegisterBoardAdminActions(board.id, adminActions, openAdminAction);

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
          </div>
        </div>
      </div>

      <div className={`flex-1 p-3 sm:p-6 ${view === "table" ? "overflow-hidden" : "overflow-auto"}`}>
        {view === "table" && (
          <BoardTable
            board={board}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
            onAddColumn={() => setAddColumnOpen(true)}
            highlightItemId={ganttNavigateHighlight ?? highlightItemId}
            holidays={holidays}
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
            holidays={holidays}
          />
        )}
        {ganttMounted && (
          <BoardGantt
            board={board}
            users={users}
            userRole={userRole}
            currentUserId={currentUserId}
            holidays={holidays}
            onNavigateToItem={goToItemInTable}
            active={view === "gantt"}
          />
        )}
        {view === "risks" && (
          <BoardRisks board={board} users={users} currentUserId={currentUserId} />
        )}
        {view === "changes" && <BoardChanges board={board} userRole={userRole} />}
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
            holidays={holidays}
          />
        )}
      </div>

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

    </div>
  );
}
