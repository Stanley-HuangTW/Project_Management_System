import { requireSession } from "@/lib/session";
import { loadUpdateFeed } from "@/lib/updateFeed";
import { UpdateFeed } from "@/components/updates/UpdateFeed";

export default async function UpdatesPage() {
  const session = await requireSession();
  const rows = await loadUpdateFeed(session);

  return (
    <div className="p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">更新記錄</h1>
      <p className="mb-4 text-xs text-neutral-500 dark:text-neutral-400">
        你看得到的所有看板上,所有人對工作項的更新與變化,新的在前,最多 200 筆。跟通知不同:通知只有跟你有關的,這裡是整個看板上發生的事。
        點一筆跳到那個工作項:留言跳「更新」分頁,狀態與欄位修改跳「項目卡片」。
      </p>
      <UpdateFeed rows={rows} />
    </div>
  );
}
