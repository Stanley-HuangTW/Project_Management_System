import Link from "next/link";
import type { DashboardTab } from "@/lib/dashboardTabs";

/**
 * 儀表板上方的分頁列:「全部」永遠在最前面(看到所有區塊),後面是這個人自己建的子類。
 * 用連結切換(?tab=),在伺服器端只畫選到的那一類——不用把每個區塊都送到瀏覽器再藏起來。
 * 沒建任何子類就不畫這一列。
 */
export function DashboardTabsBar({ tabs, activeId }: { tabs: DashboardTab[]; activeId: string | null }) {
  if (tabs.length === 0) return null;
  const items = [{ id: null as string | null, name: "全部", href: "/dashboard" }, ...tabs.map((t) => ({ id: t.id as string | null, name: t.name, href: `/dashboard?tab=${t.id}` }))];
  return (
    <nav aria-label="儀表板分頁" data-dashboard-tabs className="flex flex-wrap gap-1 border-b border-neutral-200 dark:border-neutral-700">
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <Link
            key={item.id ?? "all"}
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-dashboard-tab={item.id ?? "all"}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              active
                ? "border-blue-600 font-medium text-blue-600 dark:text-blue-400"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100"
            }`}
          >
            {item.name}
          </Link>
        );
      })}
    </nav>
  );
}
