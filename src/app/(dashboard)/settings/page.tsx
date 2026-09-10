import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { listHolidays } from "@/lib/holidays";
import { getWorkloadThreshold } from "@/lib/actions/workloadThreshold";
import { SystemSettingsForm } from "@/components/settings/SystemSettingsForm";

export default async function SettingsPage() {
  const session = await requireSession();
  const isAdmin = session.role === "ADMIN";

  // Non-admins still reach this page for 看板分享設定 alone (they can only
  // manage sharing for boards they own — see requireBoardOwnerOrAdmin) —
  // every other section below is admin-only and gated inside the form.
  const [settings, holidays, workloadThreshold, boards, users] = await Promise.all([
    getSystemSettings(),
    listHolidays(),
    getWorkloadThreshold(),
    prisma.board.findMany({
      select: {
        id: true,
        name: true,
        ownerId: true,
        visibility: true,
        columns: true,
        ganttStartColumnId: true,
        ganttDurationColumnId: true,
        ganttEndColumnId: true,
        predColumnId: true,
        linkColumnId: true,
        lagColumnId: true,
        typeColumnId: true,
        manualStartColumnId: true,
        manualDurationColumnId: true,
        reportStatusColumnId: true,
        reportNotStartedOptionIds: true,
        reportPlannedOptionIds: true,
        reportPausedOptionIds: true,
        reportStuckOptionIds: true,
        reportDoneOptionIds: true,
        baselineCapturedAt: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, supervisorId: true, avatarUrl: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const sharingBoards = isAdmin ? boards : boards.filter((b) => b.ownerId === session.userId);

  return (
    <div className="p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">系統設定</h1>
      <SystemSettingsForm
        isAdmin={isAdmin}
        emailNotificationsEnabled={settings.emailNotificationsEnabled}
        ganttDurationMode={settings.ganttDurationMode}
        hoursPerDay={settings.hoursPerDay}
        levelColors={settings.levelColors}
        ganttStatusColors={{
          overdue: settings.ganttOverdueColor,
          completed: settings.ganttCompletedColor,
          inProgress: settings.ganttInProgressColor,
        }}
        predLampColors={{
          ready: settings.predReadyColor,
          waiting: settings.predWaitingColor,
          blocked: settings.predBlockedColor,
        }}
        holidays={holidays}
        workloadThreshold={workloadThreshold}
        ganttMappingBoards={boards}
        baselineBoards={boards}
        reportSettingsBoards={boards}
        statusColorBoards={sharingBoards.map((b) => ({
          id: b.id,
          name: b.name,
          columns: b.columns.map((c) => ({ id: c.id, name: c.name, type: c.type, options: c.options })),
        }))}
        sharingBoards={sharingBoards}
        users={users}
      />
    </div>
  );
}
