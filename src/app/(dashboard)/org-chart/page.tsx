import { requireSession } from "@/lib/session";
import { getOrgChart } from "@/lib/actions/orgChart";
import { OrgChartView } from "@/components/org/OrgChartView";

/** 組織架構圖:所有人都看得到(查誰是誰的幾階主管),只有管理者能改。 */
export default async function OrgChartPage() {
  const session = await requireSession();
  const data = await getOrgChart();
  return <OrgChartView data={data} canEdit={session.role === "ADMIN"} />;
}
