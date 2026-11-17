"use client";

import type { NotificationType } from "@prisma/client";
import type { Holiday } from "@prisma/client";
import type { OrgUnit } from "@/lib/orgUnits";
import type { OrgNodeLite } from "@/lib/orgTree";
import { EmailNotificationsCard, HolidayCard, NotificationTypesCard } from "./SystemSettingsForm";
import { TimeCategoryCard } from "./TimeCategoryCard";
import { OrgUnitCard } from "./OrgUnitCard";

/**
 * ISSUE TRACKER 的系統設定頁裡「兩個系統共用」的卡片:這些設定本來就只有一份(Email 通知、公司假日、工時類別、組織單位),
 * 在哪個系統改都是改同一份。只有系統管理員看得到。
 */
export function IssueSharedSettingsCards({
  emailNotificationsEnabled,
  enabledNotificationTypes,
  holidays,
  orgUnits,
  orgNodes,
}: {
  emailNotificationsEnabled: boolean;
  enabledNotificationTypes: NotificationType[];
  holidays: Holiday[];
  orgUnits: OrgUnit[];
  orgNodes: OrgNodeLite[];
}) {
  return (
    <div className="space-y-4" data-testid="issue-shared-settings">
      <EmailNotificationsCard initial={emailNotificationsEnabled} />
      <NotificationTypesCard initial={enabledNotificationTypes} />
      <HolidayCard holidays={holidays} />
      <TimeCategoryCard />
      <OrgUnitCard units={orgUnits} nodes={orgNodes} />
    </div>
  );
}
