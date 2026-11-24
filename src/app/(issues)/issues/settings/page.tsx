import { redirect } from "next/navigation";
import { requireIssueSession } from "@/lib/issueServer";
import { getSystemSettings } from "@/lib/actions/systemSettings";
import { listHolidays } from "@/lib/holidays";
import { loadOrgUnits } from "@/lib/orgUnitsServer";
import { loadOrgNodes } from "@/lib/orgNodesServer";
import { IssueSettingsCard } from "@/components/settings/IssueSettingsCard";
import { IssueSharedSettingsCards } from "@/components/settings/IssueSharedSettingsCards";
import { IssueMantisCard } from "@/components/settings/IssueMantisCard";
import { getIssueMantisConnection } from "@/lib/actions/issueMantis";

/**
 * ISSUE TRACKER 的系統設定:ISSUE TRACKER 專屬的設定(ISSUE TRACKER 的管理者可改),
 * 加上兩個系統共用的設定(只有系統管理員)。專案管理專屬的(甘特圖、週報、BOM、預算、Mantis…)不在這裡。
 */
export default async function IssueSettingsPage() {
  const { session, role } = await requireIssueSession();
  if (role !== "MANAGER") redirect("/issues");
  const isAdmin = session.role === "ADMIN";
  const settings = await getSystemSettings();
  const mantis = isAdmin ? await getIssueMantisConnection() : null;
  const [holidays, orgUnits, orgNodes] = isAdmin ? await Promise.all([listHolidays(), loadOrgUnits(), loadOrgNodes()]) : [[], [], []];

  return (
    <div className="p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">ISSUE TRACKER 系統設定</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        案件相關的設定。{isAdmin ? "下半部是兩個系統共用的設定,在這裡改跟在專案管理系統改是同一份。" : "共用的設定(Email、假日、工時類別、組織單位)只有系統管理員可以改。"}
      </p>
      <div className="space-y-4">
        <IssueSettingsCard dayMode={settings.issueDayMode} emailNotify={settings.issueEmailNotify} />
        {isAdmin && (
          <>
            <h2 className="pt-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200">Mantis</h2>
            <IssueMantisCard initial={mantis} />
            <h2 className="pt-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200">兩個系統共用的設定</h2>
            <IssueSharedSettingsCards
              emailNotificationsEnabled={settings.emailNotificationsEnabled}
              enabledNotificationTypes={settings.enabledNotificationTypes}
              holidays={holidays}
              orgUnits={orgUnits}
              orgNodes={orgNodes}
            />
          </>
        )}
      </div>
    </div>
  );
}
